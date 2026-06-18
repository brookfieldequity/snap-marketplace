// PTO (paid time off) helpers — shared by the schedule-request approval flow
// and the roster profile-card PTO counter. See pto-builder-spec.
//
// PTO is represented on the calendar as source='PTO' RosterAvailability rows
// (available=false), the same rows the admin PTO marking writes. The counter
// numbers ("granted", "used so far") are DERIVED from those rows — never stored
// — so there is a single source of truth that the schedule builder also reads.

const prisma = require('../config/db');

// Default annual PTO-day allotment when a roster card has no explicit override
// (ptoDaysAnnual is null). Admin can override per provider on the card.
const DEFAULT_PTO_DAYS_ANNUAL = 20;

// PTO counts in weekdays (Mon–Fri); a granted "week" = 5 weekdays. Weekend days
// inside a PTO range don't consume allotment.
function isWeekday(date) {
  const dow = new Date(date).getUTCDay(); // 0 = Sun … 6 = Sat
  return dow >= 1 && dow <= 5;
}

// Number of weekdays in the inclusive UTC date range [start, end].
function countWeekdays(start, end) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let n = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
    if (isWeekday(d)) n += 1;
  }
  return n;
}

// Effective eligibility for a roster entry. Explicit ptoEligible wins; otherwise
// derive from employment — W-2 (is1099 === false) OR full-time counts as
// eligible, matching the locked spec ("all full-time/W-2; per-diems only when
// flagged"). Per-diems/locums/1099 default to ineligible until admin flags them.
function isPtoEligible(entry) {
  if (entry == null) return false;
  if (typeof entry.ptoEligible === 'boolean') return entry.ptoEligible;
  return entry.is1099 === false
    || entry.isFullTime === true
    || entry.employmentCategory === 'FULL_TIME';
}

// Effective annual allotment (override or default).
function annualAllotment(entry) {
  return entry && entry.ptoDaysAnnual != null ? entry.ptoDaysAnnual : DEFAULT_PTO_DAYS_ANNUAL;
}

// UTC [start, end) bounds for a calendar year.
function yearBounds(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

// Compute the PTO counter for a set of roster entries in one year, in a single
// query. Returns a Map rosterEntryId -> { annual, granted, used } where:
//   granted = weekday PTO days booked this year (source='PTO', available=false)
//   used    = the subset of those whose date is on or before `asOf` (today)
async function summarizeYear({ facilityId, entries, year, asOf }) {
  const { start, end } = yearBounds(year);
  const ids = entries.map((e) => e.id);
  const summary = new Map(
    entries.map((e) => [e.id, { annual: annualAllotment(e), granted: 0, used: 0 }])
  );
  if (ids.length === 0) return summary;

  const rows = await prisma.rosterAvailability.findMany({
    where: {
      facilityId,
      rosterEntryId: { in: ids },
      source: 'PTO',
      available: false,
      date: { gte: start, lt: end },
    },
    select: { rosterEntryId: true, date: true },
  });

  const cutoff = asOf ? new Date(asOf) : null;
  for (const r of rows) {
    if (!isWeekday(r.date)) continue; // weekends don't consume allotment
    const s = summary.get(r.rosterEntryId);
    if (!s) continue;
    s.granted += 1;
    if (cutoff && new Date(r.date) <= cutoff) s.used += 1;
  }
  return summary;
}

module.exports = {
  DEFAULT_PTO_DAYS_ANNUAL,
  isWeekday,
  countWeekdays,
  isPtoEligible,
  annualAllotment,
  summarizeYear,
};
