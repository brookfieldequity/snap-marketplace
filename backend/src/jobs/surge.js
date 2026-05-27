const prisma = require('../config/db');

// Surge pricing: runs every 30 minutes
// Increases rate based on: hours-to-shift and viewer count
async function runSurgePricing() {
  try {
    const shifts = await prisma.shift.findMany({
      where: { status: 'LIVE', surgeEnabled: true },
    });

    for (const shift of shifts) {
      const now = new Date();
      const hoursToShift = (new Date(shift.date) - now) / 3600000;
      const viewers = shift.currentViewers;

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

      if (Math.abs(newRate - shift.currentRate) > 0.01) {
        await prisma.shift.update({
          where: { id: shift.id },
          data: { currentRate: newRate, surgeMultiplier: multiplier },
        });
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

module.exports = { runSurgePricing, expireOldShifts, openPreferredShifts, notifySurgeExpiring };
