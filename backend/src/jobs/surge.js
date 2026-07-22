const prisma = require('../config/db');

// Rolling window for "current" shift viewers (M2 fix). Demand = DISTINCT
// providers who viewed the shift within this window, not a lifetime counter —
// one provider (or the facility itself) refreshing repeatedly can no longer
// inflate the surge rate. 60 minutes: wide enough to smooth across two 30-min
// surge runs, short enough that the 5/10/20 thresholds mean genuinely
// concurrent interest. Shared with routes/shifts.js (view recording).
const VIEWER_WINDOW_MS = 60 * 60 * 1000;

// Surge pricing: runs every 30 minutes
// Increases rate based on: hours-to-shift and distinct-viewer count
async function runSurgePricing() {
  try {
    const windowStart = new Date(Date.now() - VIEWER_WINDOW_MS);

    // Opportunistic cleanup: rows older than the window count nowhere, so
    // deleting them here (every 30 min) keeps the table small — no extra cron.
    await prisma.shiftViewer.deleteMany({ where: { viewedAt: { lt: windowStart } } });

    const shifts = await prisma.shift.findMany({
      where: { status: 'LIVE', surgeEnabled: true },
    });
    if (shifts.length === 0) return;

    // Distinct viewers per shift within the window.
    const viewerRows = await prisma.shiftViewer.groupBy({
      by: ['shiftId', 'providerId'],
      where: { shiftId: { in: shifts.map((s) => s.id) }, viewedAt: { gte: windowStart } },
    });
    const viewerCounts = new Map();
    for (const row of viewerRows) {
      viewerCounts.set(row.shiftId, (viewerCounts.get(row.shiftId) || 0) + 1);
    }

    for (const shift of shifts) {
      const now = new Date();
      const hoursToShift = (new Date(shift.date) - now) / 3600000;
      const viewers = viewerCounts.get(shift.id) || 0;

      let multiplier = 1.0;

      // Time-based surge: increases as shift approaches
      if (hoursToShift <= 4) multiplier += 0.30;
      else if (hoursToShift <= 12) multiplier += 0.20;
      else if (hoursToShift <= 24) multiplier += 0.10;
      else if (hoursToShift <= 48) multiplier += 0.05;

      // Demand-based surge: more viewers = higher rate
      if (viewers >= 20) multiplier += 0.15;
      else if (viewers >= 10) multiplier += 0.08;
      else if (viewers >= 5) multiplier += 0.04;

      multiplier = Math.min(multiplier, 1.5); // cap at 1.5x

      const newRate = Math.round(shift.baseRate * multiplier * 100) / 100;

      const data = {};
      if (Math.abs(newRate - shift.currentRate) > 0.01) {
        data.currentRate = newRate;
        data.surgeMultiplier = multiplier;
      }
      // Keep the displayed counter in sync so viewer counts DECAY as the
      // window rolls forward (apps keep reading shift.currentViewers as-is).
      if (viewers !== shift.currentViewers) data.currentViewers = viewers;

      if (Object.keys(data).length > 0) {
        await prisma.shift.update({ where: { id: shift.id }, data });
      }
    }
  } catch (err) {
    console.error('Surge pricing job error:', err.message);
  }
}

// Expire shifts past their expiry time
async function expireOldShifts() {
  try {
    await prisma.shift.updateMany({
      where: { status: 'LIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
  } catch (err) {
    console.error('Expire shifts job error:', err.message);
  }
}

// Open preferred-only shifts to all providers when window ends
async function openPreferredShifts() {
  try {
    await prisma.shift.updateMany({
      where: {
        status: 'LIVE',
        preferredAccessOnly: true,
        preferredWindowEnds: { lt: new Date() },
      },
      data: { preferredAccessOnly: false },
    });
  } catch (err) {
    console.error('Open preferred shifts job error:', err.message);
  }
}

const { notifySurgeExpiring } = require('../services/notifications');

module.exports = { runSurgePricing, expireOldShifts, openPreferredShifts, notifySurgeExpiring, VIEWER_WINDOW_MS };
