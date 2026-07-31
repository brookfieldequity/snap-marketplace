/**
 * Allocation gauges + target-drift suggestions (Wave 5 learning, 2026-07-31).
 *
 * The roster card's ProviderLocation.shiftSharePct is the TARGET; real
 * placements are the ACTUAL. This service renders both sides of the locked
 * feedback loop: "Card = target; reality votes to amend it."
 *
 *   - gauges: for the month on screen, each provider-with-targets' live
 *     actuals-vs-target site mix (e.g. Kenmore 58% vs 60% target). Every
 *     placement — machine or manual cross-site move — shifts it immediately,
 *     because it's computed straight off ScheduleAssignment.
 *   - suggestions: persistent drift over a trailing 3-month window →
 *     suggest amending the card target. Suggestion only — one click applies
 *     it, nothing changes on its own (house ethos).
 *
 * Ghost/proposed slots never count: actuals mean real placements.
 */

const prisma = require('../config/db');

const isoMonth = (y, m) => ({ start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) });

// Drift thresholds: ≥10-point gap sustained over the window, with enough
// worked days that the percentage means something.
const DRIFT_POINTS = 10;
const MIN_WINDOW_DAYS = 8;
const WINDOW_MONTHS = 3;

/** Real (non-ghost) day counts per rosterId × location within a range. */
async function countPlacements(facilityId, start, end) {
  const rows = await prisma.scheduleAssignment.findMany({
    where: {
      facilityId,
      ghost: false,
      rosterId: { not: null },
      role: { not: 'NON_CLINICAL' },
      scheduleDay: { date: { gte: start, lt: end } },
    },
    select: { rosterId: true, scheduleDay: { select: { date: true, location: true } } },
  });
  // One provider on one date at one location = one "day" (supervisor +
  // room double-rows collapse; a true cross-site double-book counts per site,
  // which is exactly what the share math should see).
  const daySet = new Set();
  const byRosterLoc = new Map(); // `${rosterId}::${location}` → days
  const totals = new Map(); // rosterId → days
  for (const r of rows) {
    const dISO = new Date(r.scheduleDay.date).toISOString().slice(0, 10);
    const uniq = `${r.rosterId}::${r.scheduleDay.location}::${dISO}`;
    if (daySet.has(uniq)) continue;
    daySet.add(uniq);
    const key = `${r.rosterId}::${r.scheduleDay.location}`;
    byRosterLoc.set(key, (byRosterLoc.get(key) || 0) + 1);
    totals.set(r.rosterId, (totals.get(r.rosterId) || 0) + 1);
  }
  return { byRosterLoc, totals };
}

async function computeAllocation(facilityId, year, month) {
  const targets = await prisma.providerLocation.findMany({
    where: { shiftSharePct: { not: null }, rosterEntry: { facilityId } },
    select: {
      rosterEntryId: true,
      facilityName: true,
      shiftSharePct: true,
      rosterEntry: { select: { providerName: true, providerType: true, employmentCategory: true } },
    },
  });
  if (targets.length === 0) return { providers: [], suggestions: [] };

  const { start, end } = isoMonth(year, month);
  const windowStart = new Date(Date.UTC(year, month - WINDOW_MONTHS, 1));

  const [monthCounts, windowCounts] = await Promise.all([
    countPlacements(facilityId, start, end),
    countPlacements(facilityId, windowStart, end),
  ]);

  const byRoster = new Map();
  for (const t of targets) {
    if (!byRoster.has(t.rosterEntryId)) {
      byRoster.set(t.rosterEntryId, {
        rosterId: t.rosterEntryId,
        providerName: t.rosterEntry?.providerName || 'Provider',
        providerType: t.rosterEntry?.providerType || null,
        employmentCategory: t.rosterEntry?.employmentCategory || null,
        monthDays: monthCounts.totals.get(t.rosterEntryId) || 0,
        windowDays: windowCounts.totals.get(t.rosterEntryId) || 0,
        targets: [],
      });
    }
    const p = byRoster.get(t.rosterEntryId);
    const mDays = monthCounts.byRosterLoc.get(`${t.rosterEntryId}::${t.facilityName}`) || 0;
    const wDays = windowCounts.byRosterLoc.get(`${t.rosterEntryId}::${t.facilityName}`) || 0;
    p.targets.push({
      location: t.facilityName,
      targetPct: t.shiftSharePct,
      monthDays: mDays,
      monthActualPct: null, // filled below once monthDays is known
      windowDays: wDays,
    });
  }

  const providers = [];
  const suggestions = [];
  for (const p of byRoster.values()) {
    for (const t of p.targets) {
      t.monthActualPct = p.monthDays > 0 ? Math.round((t.monthDays / p.monthDays) * 100) : null;
      t.windowActualPct = p.windowDays > 0 ? Math.round((t.windowDays / p.windowDays) * 100) : null;
      // Drift: sustained window gap ≥ threshold with enough worked days.
      if (
        p.windowDays >= MIN_WINDOW_DAYS
        && t.windowActualPct != null
        && Math.abs(t.windowActualPct - t.targetPct) >= DRIFT_POINTS
      ) {
        const suggestPct = Math.max(0, Math.min(100, Math.round(t.windowActualPct / 5) * 5));
        if (suggestPct !== t.targetPct) {
          suggestions.push({
            rosterId: p.rosterId,
            providerName: p.providerName,
            location: t.location,
            targetPct: t.targetPct,
            observedPct: t.windowActualPct,
            suggestPct,
            windowMonths: WINDOW_MONTHS,
            windowDays: p.windowDays,
          });
        }
      }
    }
    // Sort a provider's sites by target descending (home site first).
    p.targets.sort((a, b) => b.targetPct - a.targetPct);
    providers.push(p);
  }
  providers.sort((a, b) => a.providerName.localeCompare(b.providerName));
  suggestions.sort((a, b) => Math.abs(b.observedPct - b.targetPct) - Math.abs(a.observedPct - a.targetPct));

  return { providers, suggestions };
}

module.exports = { computeAllocation };
