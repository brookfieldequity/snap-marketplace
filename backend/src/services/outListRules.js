// Out-List Builder — rule engine for one-click release-order generation.
//
// Given an already-built (and usually published) schedule for a week or month,
// compute every day's "out order" (1 = leaves first … last = closes the
// facility) from an admin-configured rule set. The rules are bidirectional and
// cross-site, so the whole window is solved at once rather than walking forward
// blindly — e.g. "Robelen is at Kenmore (a late site) Wednesday, so he
// shouldn't close anywhere Tuesday OR Thursday."
//
// Rules supported (all admin toggles):
//   • lateSiteNoCloseAdjacent — working a "late site" makes that a late day, so
//     the provider can't be the closer on either ADJACENT day (the day before
//     or after), and is nudged toward first-out on those days.
//   • closerFirstOutNextDay — whoever closes a site on day D is pushed toward
//     first-out the next day and can't close again that next day.
//   • noBackToBackClosing — nobody closes two days in a row.
//
// Base order (before fairness rules) is role-based: CRNA rooms break first,
// then solo-MD rooms, and the supervising anesthesiologist closes.

const SUPERVISOR_ROOM_BASE = 900;

const DEFAULT_RULES = {
  lateSites: [],
  lateSiteNoCloseAdjacent: true,
  closerFirstOutNextDay: true,
  noBackToBackClosing: true,
};

// Coerce arbitrary stored/posted JSON into a safe, fully-populated rule set.
function normalizeRules(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    lateSites: Array.isArray(r.lateSites)
      ? [...new Set(r.lateSites.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()))]
      : [],
    lateSiteNoCloseAdjacent: r.lateSiteNoCloseAdjacent !== false,
    closerFirstOutNextDay: r.closerFirstOutNextDay !== false,
    noBackToBackClosing: r.noBackToBackClosing !== false,
  };
}

function basePriority(a) {
  if (a.role === 'SUPERVISING_MD' || a.roomNumber >= SUPERVISOR_ROOM_BASE) return 3; // closes
  if (a.role === 'SOLO_MD_ROOM') return 2;
  if (a.role === 'CRNA_ROOM') return 1; // leaves first
  return 1.5; // legacy / role-agnostic room
}

function dateKey(d) {
  return (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
}

// Shift a YYYY-MM-DD key by n days, staying date-only (noon avoids TZ slips).
function addDays(key, n) {
  const d = new Date(key + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute release ranks for every staffed assignment in a window.
 *
 * @param {object[]} daysInWindow  ScheduleDay rows to rank, each with
 *   `assignments` (rosterId-staffed only) including `rosterEntry`.
 * @param {object[]} contextDays   daysInWindow PLUS the day immediately before
 *   and after, so adjacency rules see late sites just outside the window.
 * @param {object}   rules         raw rule blob (normalized internally).
 * @param {Set<string>} seedClosers rosterIds who closed the day before the
 *   window start (keeps weekly runs continuous). Optional.
 * @returns {{ ranks: Map<string,number>, closersByDate: Object, warnings: string[] }}
 */
function computeOutLists({ daysInWindow, contextDays, rules, seedClosers }) {
  const R = normalizeRules(rules);
  const lateSet = new Set(R.lateSites.map((s) => s.toLowerCase()));

  // provider → set of date keys they work a late site
  const lateDays = new Map();
  for (const day of contextDays || daysInWindow) {
    if (!lateSet.has((day.location || '').toLowerCase())) continue;
    const dk = dateKey(day.date);
    for (const a of day.assignments) {
      if (!a.rosterId) continue;
      if (!lateDays.has(a.rosterId)) lateDays.set(a.rosterId, new Set());
      lateDays.get(a.rosterId).add(dk);
    }
  }
  const worksLateOn = (rosterId, dk) => lateDays.has(rosterId) && lateDays.get(rosterId).has(dk);

  const dateKeys = [...new Set(daysInWindow.map((d) => dateKey(d.date)))].sort();
  const ranks = new Map();
  const closersByDate = {};
  const warnings = [];
  let closedYesterday = new Set(seedClosers || []);

  for (const dk of dateKeys) {
    const sites = daysInWindow.filter((d) => dateKey(d.date) === dk);
    const prevDk = addDays(dk, -1);
    const nextDk = addDays(dk, 1);
    const closedToday = new Set();

    for (const site of sites) {
      const staffed = site.assignments.filter((a) => a.rosterId);
      if (staffed.length === 0) continue;

      const meta = staffed.map((a) => {
        const adjacentLate =
          R.lateSiteNoCloseAdjacent && (worksLateOn(a.rosterId, prevDk) || worksLateOn(a.rosterId, nextDk));
        const closedPrev = closedYesterday.has(a.rosterId);
        const rollover = R.closerFirstOutNextDay && closedPrev;
        const backToBack = R.noBackToBackClosing && closedPrev;
        return {
          a,
          base: basePriority(a),
          // Hard: may NOT be the closer today.
          noClose: adjacentLate || rollover || backToBack,
          // Soft: nudge toward the very front of the out order.
          firstOutBias: adjacentLate || rollover,
        };
      });

      // Closer = highest base priority among those allowed to close.
      const eligible = meta.filter((m) => !m.noClose);
      let closer;
      if (eligible.length > 0) {
        closer = eligible.sort((x, y) => y.base - x.base || x.a.roomNumber - y.a.roomNumber)[0];
      } else {
        closer = [...meta].sort((x, y) => y.base - x.base || x.a.roomNumber - y.a.roomNumber)[0];
        warnings.push(
          `${site.location} ${dk}: every staffed provider was rule-constrained from closing — left ${
            closer.a.rosterEntry?.providerName || 'someone'
          } as closer. Review manually.`
        );
      }

      // Everyone else ordered earliest-out first; closer pinned last.
      const others = meta
        .filter((m) => m !== closer)
        .sort((x, y) => {
          const ex = x.base + (x.firstOutBias ? -100 : 0);
          const ey = y.base + (y.firstOutBias ? -100 : 0);
          return ex - ey || x.a.roomNumber - y.a.roomNumber;
        });

      [...others.map((m) => m.a), closer.a].forEach((a, i) => ranks.set(a.id, i + 1));
      if (closer.a.rosterId) closedToday.add(closer.a.rosterId);
    }

    closersByDate[dk] = [...closedToday];
    closedYesterday = closedToday;
  }

  return { ranks, closersByDate, warnings };
}

// Given a single day's already-ranked assignments, return the closer's
// rosterIds (max outRank per site). Used to seed weekly runs from the
// previously-built day just before the window.
function closersFromRankedDay(dayList) {
  const out = new Set();
  for (const day of dayList) {
    let top = null;
    for (const a of day.assignments) {
      if (a.rosterId == null || a.outRank == null) continue;
      if (!top || a.outRank > top.outRank) top = a;
    }
    if (top) out.add(top.rosterId);
  }
  return out;
}

module.exports = {
  DEFAULT_RULES,
  normalizeRules,
  computeOutLists,
  closersFromRankedDay,
  dateKey,
  addDays,
};
