/**
 * Site-share suggestions from StaffIQ schedule history (2026-08-06).
 *
 * One engine, two modes per roster entry:
 *   - CHECKER (entry already has any shiftSharePct set): compare card targets
 *     against the trailing 3 months of uploaded-schedule reality. A deliberate
 *     0% is a decision, not an omission — never questioned. Gap ≥ 10 points
 *     (same threshold as the Wave-5 drift engine) → discrepancy row.
 *   - COLD-START (no shares set anywhere on the entry): suggest a full split
 *     from ALL uploaded history, rounded to 5s, summing to 100.
 *
 * Reads SchedulingRecord — the StaffIQ uploads, where the full multi-month
 * history lives, already name-matched to roster entries (matchedRosterId) —
 * NOT ScheduleAssignment: materialized schedule months are a subset.
 *
 * The trailing window anchors to the NEWEST record date, not today: uploads
 * are historical files, so "recent" means recent within the data.
 *
 * Site names: upload strings ("Kenmore") rarely equal the coverage-template
 * vocabulary ("Atrius Kenmore"). Every observed location is canonicalized by
 * normalized-substring match against (1) the entry's own card sites, then
 * (2) the template vocabulary. Names that match neither are reported but
 * marked not applicable — the roster edit form drops non-template site rows,
 * so applying them would create rows that silently vanish on the next edit.
 *
 * Suggestion only — nothing writes without an explicit apply (house ethos).
 */

const prisma = require('../config/db');

const DIFF_POINTS = 10;
const CHECKER_WINDOW_MONTHS = 3;
const MIN_CHECKER_DAYS = 8;
const MIN_COLDSTART_DAYS = 10;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (a, b) => {
  const na = norm(a); const nb = norm(b);
  return !!(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
};

// Round each site to a multiple of 5 and force the set to sum to 100 by
// absorbing the rounding drift into the largest bucket.
function roundSplitTo100(split) {
  const out = split.map((s) => ({ ...s, pct: Math.round((s.rawPct || 0) / 5) * 5 })).filter((s) => s.pct > 0);
  if (out.length === 0) return out;
  const sum = out.reduce((acc, s) => acc + s.pct, 0);
  out.sort((a, b) => b.pct - a.pct);
  out[0].pct = Math.max(5, Math.min(100, out[0].pct + (100 - sum)));
  return out;
}

async function computeSiteShareSuggestions(facilityId) {
  const [entries, tmplDays, records] = await Promise.all([
    prisma.internalRosterEntry.findMany({
      where: { facilityId, archivedAt: null },
      select: {
        id: true, providerName: true, providerType: true, employmentCategory: true,
        locations: { select: { facilityName: true, shiftSharePct: true } },
      },
    }),
    prisma.coverageTemplateDay.findMany({
      where: { template: { facilityId } },
      select: { location: true },
      distinct: ['location'],
    }),
    prisma.schedulingRecord.findMany({
      where: { facilityId, matchedRosterId: { not: null }, shiftDate: { not: null }, facilityLocation: { not: null } },
      select: { matchedRosterId: true, shiftDate: true, facilityLocation: true },
    }),
  ]);

  const vocabulary = [...new Set(tmplDays.map((t) => (t.location || '').trim()).filter(Boolean))];
  const entryById = new Map(entries.map((e) => [e.id, e]));

  if (records.length === 0) {
    return { dataRange: null, checker: [], coldStart: [], insufficient: [], vocabulary };
  }

  let minDate = records[0].shiftDate; let maxDate = records[0].shiftDate;
  for (const r of records) {
    if (r.shiftDate < minDate) minDate = r.shiftDate;
    if (r.shiftDate > maxDate) maxDate = r.shiftDate;
  }
  const windowStart = new Date(Date.UTC(
    maxDate.getUTCFullYear(), maxDate.getUTCMonth() - CHECKER_WINDOW_MONTHS, maxDate.getUTCDate(),
  ));

  // Canonicalize each observed location per entry: card site name wins, then
  // template vocabulary, else the raw upload name (reported, not applicable).
  // Cache per (entryId, rawName) — the same raw string repeats thousands of times.
  const canonCache = new Map();
  const canonFor = (entryId, raw) => {
    const key = `${entryId}::${raw}`;
    if (canonCache.has(key)) return canonCache.get(key);
    const entry = entryById.get(entryId);
    let result = null;
    for (const loc of entry?.locations || []) {
      if (matches(loc.facilityName, raw)) { result = { name: loc.facilityName, applicable: true }; break; }
    }
    if (!result) {
      for (const v of vocabulary) {
        if (matches(v, raw)) { result = { name: v, applicable: true }; break; }
      }
    }
    if (!result) result = { name: String(raw).trim(), applicable: false };
    canonCache.set(key, result);
    return result;
  };

  // One provider at one site on one date = one day, counted once (call rows,
  // double entries, and split assignments collapse — share math sees days).
  const seen = new Set();
  const full = new Map(); // entryId → Map(canonName → days)
  const win = new Map();
  const fullTotals = new Map(); // entryId → days
  const winTotals = new Map();
  const applicability = new Map(); // `${entryId}::${canonName}` → boolean

  for (const r of records) {
    if (!entryById.has(r.matchedRosterId)) continue;
    const canon = canonFor(r.matchedRosterId, r.facilityLocation);
    const dISO = r.shiftDate.toISOString().slice(0, 10);
    const uniq = `${r.matchedRosterId}::${norm(canon.name)}::${dISO}`;
    if (seen.has(uniq)) continue;
    seen.add(uniq);
    applicability.set(`${r.matchedRosterId}::${canon.name}`, canon.applicable);

    if (!full.has(r.matchedRosterId)) full.set(r.matchedRosterId, new Map());
    const fm = full.get(r.matchedRosterId);
    fm.set(canon.name, (fm.get(canon.name) || 0) + 1);
    fullTotals.set(r.matchedRosterId, (fullTotals.get(r.matchedRosterId) || 0) + 1);

    if (r.shiftDate >= windowStart) {
      if (!win.has(r.matchedRosterId)) win.set(r.matchedRosterId, new Map());
      const wm = win.get(r.matchedRosterId);
      wm.set(canon.name, (wm.get(canon.name) || 0) + 1);
      winTotals.set(r.matchedRosterId, (winTotals.get(r.matchedRosterId) || 0) + 1);
    }
  }

  const checker = [];
  const coldStart = [];
  const insufficient = [];

  for (const e of entries) {
    const hasTargets = (e.locations || []).some((l) => l.shiftSharePct != null);
    const fullDays = fullTotals.get(e.id) || 0;
    const winDays = winTotals.get(e.id) || 0;
    const base = { rosterId: e.id, providerName: e.providerName, providerType: e.providerType, employmentCategory: e.employmentCategory };

    if (fullDays === 0) continue; // no history at all — nothing to say

    if (hasTargets) {
      if (winDays < MIN_CHECKER_DAYS) {
        insufficient.push({ ...base, mode: 'checker', days: winDays, reason: `Only ${winDays} scheduled day${winDays === 1 ? '' : 's'} in the last ${CHECKER_WINDOW_MONTHS} months — too few to verify the card` });
        continue;
      }
      const wm = win.get(e.id) || new Map();
      const matchesOut = [];
      const discrepancies = [];
      const unset = [];
      const cardNorms = new Set((e.locations || []).map((l) => norm(l.facilityName)));

      for (const loc of e.locations || []) {
        const days = wm.get(loc.facilityName) || 0;
        const observedPct = Math.round((days / winDays) * 100);
        if (loc.shiftSharePct == null) {
          // Checked-but-blank on an otherwise-set card: offer a fill.
          if (observedPct > 0) unset.push({ site: loc.facilityName, observedPct, suggestPct: Math.round(observedPct / 5) * 5, days });
          continue;
        }
        if (loc.shiftSharePct === 0) {
          // Deliberate zero — respected silently, listed as honoring intent.
          matchesOut.push({ site: loc.facilityName, targetPct: 0, observedPct, zeroRespected: true });
          continue;
        }
        if (Math.abs(observedPct - loc.shiftSharePct) >= DIFF_POINTS) {
          discrepancies.push({
            site: loc.facilityName, targetPct: loc.shiftSharePct, observedPct,
            suggestPct: Math.max(0, Math.min(100, Math.round(observedPct / 5) * 5)), days,
          });
        } else {
          matchesOut.push({ site: loc.facilityName, targetPct: loc.shiftSharePct, observedPct });
        }
      }

      // History at sites the card doesn't list at all.
      const newSites = [];
      for (const [name, days] of wm.entries()) {
        if (cardNorms.has(norm(name))) continue;
        const observedPct = Math.round((days / winDays) * 100);
        if (observedPct >= 5) {
          newSites.push({ site: name, observedPct, suggestPct: Math.round(observedPct / 5) * 5, days, applicable: applicability.get(`${e.id}::${name}`) !== false });
        }
      }

      checker.push({ ...base, windowDays: winDays, windowMonths: CHECKER_WINDOW_MONTHS, matches: matchesOut, discrepancies, unset, newSites });
    } else {
      if (fullDays < MIN_COLDSTART_DAYS) {
        insufficient.push({ ...base, mode: 'coldStart', days: fullDays, reason: `Only ${fullDays} scheduled day${fullDays === 1 ? '' : 's'} on record — set shares manually or leave blank` });
        continue;
      }
      const fm = full.get(e.id) || new Map();
      const cardNorms = new Set((e.locations || []).map((l) => norm(l.facilityName)));
      const rawSplit = [...fm.entries()].map(([name, days]) => ({
        site: name, days, rawPct: (days / fullDays) * 100,
        newSite: !cardNorms.has(norm(name)),
        applicable: applicability.get(`${e.id}::${name}`) !== false,
      }));
      const split = roundSplitTo100(rawSplit);
      if (split.length > 0) coldStart.push({ ...base, totalDays: fullDays, split });
    }
  }

  checker.sort((a, b) => (b.discrepancies.length + b.unset.length) - (a.discrepancies.length + a.unset.length) || a.providerName.localeCompare(b.providerName));
  coldStart.sort((a, b) => b.totalDays - a.totalDays);
  insufficient.sort((a, b) => a.providerName.localeCompare(b.providerName));

  return {
    dataRange: {
      start: minDate.toISOString().slice(0, 10),
      end: maxDate.toISOString().slice(0, 10),
      records: records.length,
      windowStart: windowStart.toISOString().slice(0, 10),
    },
    checker,
    coldStart,
    insufficient,
    vocabulary,
  };
}

module.exports = { computeSiteShareSuggestions };
