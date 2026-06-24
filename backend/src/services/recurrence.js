// Recurrence expander — turns a posting pattern into concrete shift dates.
//
// This is the one primitive shared by "post a series" (marketplace). It does
// NOT touch the internal scheduler's CoverageTemplate model (that's a different
// domain: locations, rooms, supervision ratios). Keep this pure + side-effect
// free so both a preview and the create endpoint can call it.
//
// Dates are produced as UTC-midnight Date objects (`new Date("YYYY-MM-DD")`),
// matching how single-shift posting stores `shift.date` — so a series and a
// one-off land on the same calendar day.

const MAX_OCCURRENCES = 90; // hard cap so one request can't create a runaway batch

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

// pattern:
//   { mode: 'WEEKLY', startDate, endDate, daysOfWeek: [0..6] }  (0 = Sunday)
//   { mode: 'DATES',  dates: ['YYYY-MM-DD', ...] }
// Returns: sorted, de-duped, today-or-future Date[] (capped at MAX_OCCURRENCES).
function expandPattern(pattern = {}) {
  const { mode, startDate, endDate, daysOfWeek, dates } = pattern;
  const cutoff = todayYmd();
  const seen = new Set();
  const out = [];

  const add = (ymd) => {
    if (!ISO_DATE.test(ymd)) return;
    if (ymd < cutoff) return;           // ISO strings compare lexicographically
    if (seen.has(ymd)) return;
    seen.add(ymd);
    out.push(new Date(ymd));            // UTC midnight
  };

  if (mode === 'DATES') {
    for (const d of Array.isArray(dates) ? dates : []) add(String(d));
  } else {
    // WEEKLY (default)
    const dow = new Set((Array.isArray(daysOfWeek) ? daysOfWeek : []).map(Number));
    if (!ISO_DATE.test(startDate || '') || !ISO_DATE.test(endDate || '') || dow.size === 0) {
      return [];
    }
    let cur = new Date(startDate);
    const end = new Date(endDate);
    let guard = 0;
    // guard caps the walk at ~1 year so a reversed/huge range can't spin.
    while (cur <= end && guard++ < 400) {
      if (dow.has(cur.getUTCDay())) add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  return out.sort((a, b) => a - b).slice(0, MAX_OCCURRENCES);
}

module.exports = { expandPattern, MAX_OCCURRENCES };
