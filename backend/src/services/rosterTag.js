'use strict';

// Roster-vs-agency tagging for scheduling records (benchmark metric 3:
// agency dependence). A record is "roster" when its provider name matches an
// InternalRosterEntry by the SAME fingerprint rule the roster importer and
// Payroll Builder use (first-initial + last-name — see services/nameKey.js);
// otherwise it is agency/non-roster. Records with no parseable provider name
// stay untagged (isAgency null) and are reported as such, never guessed.

const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');

// Roster names arrive messy: "Mary Ann Vann" (double first name), "Audrey
// Long (O'Connor)" (parenthetical surname), plain "Cristin McMurray" whose
// schedule cells say just "McMurray". Each entry therefore contributes SEVERAL
// deterministic key variants; a schedule token matches only when it resolves
// to exactly ONE roster entry across all variants (CAPA-verified 2026-07-13).
function keyVariants(providerName) {
  const cleaned = String(providerName || '').replace(/[()]/g, ' ');
  const tokens = cleaned.split(/[\s,]+/).map((t) => t.replace(/[^a-zA-Z0-9]/g, '')).filter((t) => t.length > 0);
  const lower = tokens.map((t) => t.toLowerCase());
  const variants = new Set();
  const canonical = buildNameKey(providerName);
  if (canonical) variants.add(canonical);
  if (lower.length >= 2) {
    const last = lower[lower.length - 1];
    // first-initial + last token (parenthetical-stripped view)
    variants.add(lower[0][0] + last);
    // all leading initials + last token ("Mary Ann Vann" → mavann)
    variants.add(lower.slice(0, -1).map((t) => t[0]).join('') + last);
    // first-initial + EACH non-first token ("Audrey Long (O'Connor)" → along, aoconnor)
    for (let i = 1; i < lower.length; i++) variants.add(lower[0][0] + lower[i]);
  }
  // each token alone, length ≥ 4 (last-name-only schedule cells: "McMurray")
  for (const t of lower) if (t.length >= 4) variants.add(t);
  return [...variants];
}

/**
 * Load the facility's roster as a variant index:
 * { byKey: Map<keyVariant, Set<rosterEntryId>>, allKeys: [{ key, id }] }.
 * Matches against ALL roster entries (past members' historical shifts were
 * roster shifts when worked).
 */
async function buildRosterKeyMap(facilityId) {
  const roster = await prisma.internalRosterEntry.findMany({
    where: { facilityId },
    select: { id: true, providerName: true },
  });
  const byKey = new Map();
  const allKeys = [];
  for (const entry of roster) {
    for (const key of keyVariants(entry.providerName)) {
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(entry.id);
      allKeys.push({ key, id: entry.id });
    }
  }
  return { byKey, allKeys };
}

// Levenshtein distance ≤ 1 check (one insert/delete/substitute) — used ONLY
// to rescue spelling variants ("SWilliander" vs roster "Sten Willander" →
// swillander) and ONLY toward roster: a false fuzzy hit can merely move a
// record agency→roster, which UNDERSTATES agency dependence — the
// conservative direction for the published metric.
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/**
 * Compact single-token key for Schedule4-style names ("BFerla", "JEpst",
 * "McMurray") — first initial fused to a possibly-truncated last name.
 * Returns lowercase alphanumerics, or null for multi-token / too-short input.
 */
function compactKey(rawName) {
  const t = String(rawName || '').trim();
  if (!t || /[\s,]/.test(t)) return null; // single tokens only
  const k = t.toLowerCase().replace(/[^a-z0-9]/g, '');
  return k.length >= 3 ? k : null;
}

// A compact token "looks like a name" when it carries at least two capitals
// (BFerla, McMurray, SWilliander). Tokens without that shape ("None", "off")
// are markers, not people — they stay untagged rather than counting as agency.
function looksLikeCompactName(rawName) {
  return /^[A-Z].*[A-Z]/.test(String(rawName || '').trim());
}

/**
 * Tag one record-shaped object against the roster variant index.
 *
 * Resolution ladder (each step requires exactly ONE roster entry — ambiguity
 * at any step stays untagged, never guessed):
 *   1. Exact variant hit (covers "First Last", compact "BFerla", last-name-
 *      only "McMurray", double-initial "MAVann", parenthetical surnames).
 *   2. Prefix hit — schedule token as a prefix of a roster variant
 *      (Schedule4 truncation: "JEpst" → jepstein).
 *   3. Edit-distance-1 hit, tokens ≥ 6 chars — spelling variants
 *      ("SWilliander" → swillander). Fuzzy only ever tags TOWARD roster,
 *      which understates agency dependence (conservative by construction).
 *   4. Unmatched: name-like tokens (≥2 capitals) or parseable two-token
 *      names → agency; markers ("None", "off") → untagged.
 *
 * Returns { isAgency, matchedRosterId }.
 */
function tagRecord(providerName, rosterIndex) {
  const { byKey, allKeys } = rosterIndex;
  const key = buildNameKey(providerName);
  const ck = compactKey(providerName);
  const probe = key || ck;
  if (!probe) return { isAgency: null, matchedRosterId: null };

  const uniqueOf = (ids) => {
    const set = ids instanceof Set ? ids : new Set(ids);
    return set.size === 1 ? [...set][0] : (set.size > 1 ? 'AMBIGUOUS' : null);
  };

  // 1. exact variant
  if (byKey.has(probe)) {
    const u = uniqueOf(byKey.get(probe));
    if (u && u !== 'AMBIGUOUS') return { isAgency: false, matchedRosterId: u };
    if (u === 'AMBIGUOUS') return { isAgency: null, matchedRosterId: null };
  }

  // 2. prefix (truncated compact tokens)
  const prefixIds = new Set();
  for (const { key: k, id } of allKeys) if (k.startsWith(probe)) prefixIds.add(id);
  const pu = uniqueOf(prefixIds);
  if (pu && pu !== 'AMBIGUOUS') return { isAgency: false, matchedRosterId: pu };
  if (pu === 'AMBIGUOUS') return { isAgency: null, matchedRosterId: null };

  // 3. edit-distance 1 (spelling variants) — toward roster only
  if (probe.length >= 6) {
    const fuzzyIds = new Set();
    for (const { key: k, id } of allKeys) {
      if (k.length >= 6 && withinOneEdit(probe, k)) fuzzyIds.add(id);
    }
    const fu = uniqueOf(fuzzyIds);
    if (fu && fu !== 'AMBIGUOUS') return { isAgency: false, matchedRosterId: fu };
    if (fu === 'AMBIGUOUS') return { isAgency: null, matchedRosterId: null };
  }

  // 4. no roster match
  if (key || looksLikeCompactName(providerName)) {
    return { isAgency: true, matchedRosterId: null };
  }
  return { isAgency: null, matchedRosterId: null };
}

/**
 * Backfill tags for a facility's untagged records (predating the tagging
 * pipeline). Groups updates so roster matches write per roster entry and all
 * agency records write in one updateMany. Returns counts; never throws —
 * tagging must not break an analysis run.
 */
async function backfillUntagged(facilityId) {
  try {
    const untagged = await prisma.schedulingRecord.findMany({
      where: { facilityId, isAgency: null, providerName: { not: null } },
      select: { id: true, providerName: true },
    });
    if (!untagged.length) return { tagged: 0, roster: 0, agency: 0, unparseable: 0 };

    const keyMap = await buildRosterKeyMap(facilityId);

    const byRosterId = new Map(); // rosterEntryId → [recordIds]
    const agencyIds = [];
    let unparseable = 0;
    for (const rec of untagged) {
      const tag = tagRecord(rec.providerName, keyMap);
      if (tag.isAgency === null) { unparseable++; continue; }
      if (tag.isAgency) agencyIds.push(rec.id);
      else {
        if (!byRosterId.has(tag.matchedRosterId)) byRosterId.set(tag.matchedRosterId, []);
        byRosterId.get(tag.matchedRosterId).push(rec.id);
      }
    }

    let roster = 0;
    for (const [rosterId, ids] of byRosterId) {
      const r = await prisma.schedulingRecord.updateMany({
        where: { id: { in: ids } },
        data: { isAgency: false, matchedRosterId: rosterId },
      });
      roster += r.count;
    }
    let agency = 0;
    if (agencyIds.length) {
      const r = await prisma.schedulingRecord.updateMany({
        where: { id: { in: agencyIds } },
        data: { isAgency: true, matchedRosterId: null },
      });
      agency = r.count;
    }
    return { tagged: roster + agency, roster, agency, unparseable };
  } catch (err) {
    console.error('rosterTag.backfillUntagged failed (non-fatal):', err.message);
    return { tagged: 0, roster: 0, agency: 0, unparseable: 0, error: err.message };
  }
}

module.exports = { buildRosterKeyMap, tagRecord, backfillUntagged, keyVariants };
