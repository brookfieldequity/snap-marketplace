/**
 * Automation event tracking.
 *
 * Every time SNAP automates something that would otherwise have taken a
 * coordinator (or SNAP team member) manual time, log one AutomationEvent
 * row. The "Cost Savings" widget on the marketplace credentialing portal,
 * the SNAP Shifts dashboard, and the SNAP admin aggregate page all read
 * from this single table with different filters.
 *
 * Minutes-saved is FIXED per event type (see MINUTES_BY_TYPE below). Keeps
 * totals predictable and avoids per-event guessing. $50/hour conversion
 * happens at read time so we can retune later without migrating the data.
 *
 * Call sites are fire-and-forget — never fail the parent operation just
 * because logging failed. The helper logs the error and returns null.
 */

const prisma = require('../config/db');

// Time-savings per event type. Numbers locked with user 2026-06-03 based on
// realistic manual-process estimates for each automation. See docs/.. for
// rationale (or commit message of the rollout PR).
const MINUTES_BY_TYPE = {
  ROSTER_UPLOAD: 180,              // 3 hours — manual roster data entry
  COVERAGE_TEMPLATE_GENERATE: 120, // 2 hours — typing rooms for a whole month
  SCHEDULE_BUILD_RUN: 240,         // 4 hours — manual room-by-room assignment
  SIGNATURE_REQUEST_SENT: 45,      // 0.75 hr — print/mail/wait/sign/scan/file
  PASSPORT_GRANT_REQUEST: 30,      // 0.5 hr — back-and-forth to get credentials
};

const HOURLY_RATE_USD = 50;

/**
 * Fire-and-forget logger. Never throws.
 *
 * @param {object} args
 * @param {string|null} args.facilityId  // null for SNAP-level events
 * @param {keyof typeof MINUTES_BY_TYPE} args.type
 * @param {object} [args.metadata]       // optional context (e.g., row count)
 */
async function logAutomationEvent({ facilityId, type, metadata = null }) {
  try {
    const minutesSaved = MINUTES_BY_TYPE[type];
    if (typeof minutesSaved !== 'number') {
      console.warn(`[automationEvents] unknown type: ${type}`);
      return null;
    }
    return await prisma.automationEvent.create({
      data: {
        facilityId: facilityId || null,
        type,
        minutesSaved,
        metadata,
      },
    });
  } catch (err) {
    console.error('[automationEvents] log failed:', err.message);
    return null;
  }
}

// ── Period helpers ───────────────────────────────────────────────────────────
// "This week" starts Sunday 00:00 local. "This month" starts the 1st 00:00.
// Using server-local time is fine for v1; if facilities span time zones and
// the rollover-precision matters, switch to per-facility-tz later.

function startOfWeek(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Aggregate savings for the three widget periods.
 *
 * @param {object} args
 * @param {string|null} [args.facilityId]  // null = SNAP-wide aggregate
 * @returns {{ thisWeek, thisMonth, total }}  // each: { eventCount, minutesSaved, hoursSaved, dollarsSaved }
 */
async function getSavings({ facilityId = null } = {}) {
  const baseWhere = facilityId ? { facilityId } : {};
  const now = new Date();

  const [thisWeek, thisMonth, total] = await Promise.all([
    prisma.automationEvent.aggregate({
      where: { ...baseWhere, eventAt: { gte: startOfWeek(now) } },
      _sum: { minutesSaved: true },
      _count: true,
    }),
    prisma.automationEvent.aggregate({
      where: { ...baseWhere, eventAt: { gte: startOfMonth(now) } },
      _sum: { minutesSaved: true },
      _count: true,
    }),
    prisma.automationEvent.aggregate({
      where: baseWhere,
      _sum: { minutesSaved: true },
      _count: true,
    }),
  ]);

  const shape = (agg) => {
    const minutes = agg._sum.minutesSaved || 0;
    const hours = minutes / 60;
    return {
      eventCount: agg._count,
      minutesSaved: minutes,
      hoursSaved: Math.round(hours * 10) / 10,            // one decimal
      dollarsSaved: Math.round(hours * HOURLY_RATE_USD),  // whole dollars
    };
  };

  return {
    thisWeek: shape(thisWeek),
    thisMonth: shape(thisMonth),
    total: shape(total),
  };
}

module.exports = {
  logAutomationEvent,
  getSavings,
  MINUTES_BY_TYPE,
  HOURLY_RATE_USD,
};
