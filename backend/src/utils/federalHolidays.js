/**
 * US federal holiday calendar.
 *
 * Pure functions only — no IO, no DB. Used by:
 *   - GET /api/facilities/:id/holidays (computes effective list)
 *   - POST /api/schedule/generate     (skips holiday dates when materializing)
 *
 * The federal list rarely changes, but when Congress adds one (e.g. Juneteenth
 * in 2021), we add it here and ship a release.
 *
 * Observance handling: we return the *rule date*, not the federal-government
 * observed-on-the-nearest-weekday version. Practices generally schedule
 * based on the real calendar date; if a holiday falls on a weekend they
 * usually wouldn't have rooms anyway. If a customer eventually asks for
 * observed dates, add it as an option here.
 */

// Holiday rule definitions. Each returns { label, date } for a given year, or
// null if not applicable for that year.
const HOLIDAYS = [
  fixedDate("New Year's Day", 1, 1),
  nthWeekdayOfMonth('MLK Day', 1 /* January */, 1 /* Monday */, 3 /* third */),
  nthWeekdayOfMonth("Presidents' Day", 2, 1, 3),
  lastWeekdayOfMonth('Memorial Day', 5, 1),
  fixedDate('Juneteenth', 6, 19),
  fixedDate('Independence Day', 7, 4),
  nthWeekdayOfMonth('Labor Day', 9, 1, 1),
  nthWeekdayOfMonth('Columbus / Indigenous Peoples’ Day', 10, 1, 2),
  fixedDate('Veterans Day', 11, 11),
  nthWeekdayOfMonth('Thanksgiving', 11, 4 /* Thursday */, 4 /* fourth */),
  fixedDate('Christmas', 12, 25),
];

/**
 * Get all federal holidays for a given year.
 * @returns {Array<{ label: string, date: Date }>} — date is at UTC midnight
 */
function getFederalHolidaysForYear(year) {
  return HOLIDAYS.map((rule) => rule(year)).filter(Boolean);
}

/**
 * Get federal holidays that fall in a given calendar month.
 * @param {number} year   four-digit year
 * @param {number} month  1-12 (NOT 0-indexed — passed straight from URLs)
 */
function getFederalHolidaysForMonth(year, month) {
  return getFederalHolidaysForYear(year).filter(
    (h) => h.date.getUTCMonth() + 1 === month
  );
}

/**
 * True if the given Date is on a federal holiday in its year.
 */
function isFederalHoliday(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  return getFederalHolidaysForYear(y).some(
    (h) =>
      h.date.getUTCFullYear() === y &&
      h.date.getUTCMonth() === m &&
      h.date.getUTCDate() === d
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Holiday rule builders
// ────────────────────────────────────────────────────────────────────────────

function fixedDate(label, month, day) {
  // month is 1-based to match human conventions; convert internally
  return (year) => ({ label, date: utcDate(year, month - 1, day) });
}

/**
 * "The Nth weekday of month X" — e.g. 3rd Monday in January for MLK Day.
 *
 * @param month        1-12 (Jan = 1)
 * @param weekday      0=Sunday … 6=Saturday
 * @param n            1, 2, 3, 4, or 5 (5 means 5th if it exists)
 */
function nthWeekdayOfMonth(label, month, weekday, n) {
  return (year) => {
    const firstOfMonth = utcDate(year, month - 1, 1);
    const firstWeekday = firstOfMonth.getUTCDay();
    // Offset from day 1 to first occurrence of the desired weekday.
    const offset = (weekday - firstWeekday + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    const candidate = utcDate(year, month - 1, day);
    // Verify we didn't roll past the end of the month (5th-occurrence case).
    if (candidate.getUTCMonth() !== month - 1) return null;
    return { label, date: candidate };
  };
}

/**
 * "The LAST weekday of month X" — e.g. last Monday in May for Memorial Day.
 */
function lastWeekdayOfMonth(label, month, weekday) {
  return (year) => {
    // Start from the last day of the month and walk back to the target weekday.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last day of target month
    const lastDate = utcDate(year, month - 1, lastDay);
    const lastWeekday = lastDate.getUTCDay();
    const offset = (lastWeekday - weekday + 7) % 7;
    return { label, date: utcDate(year, month - 1, lastDay - offset) };
  };
}

function utcDate(year, monthZeroBased, day) {
  return new Date(Date.UTC(year, monthZeroBased, day));
}

module.exports = {
  getFederalHolidaysForYear,
  getFederalHolidaysForMonth,
  isFederalHoliday,
};
