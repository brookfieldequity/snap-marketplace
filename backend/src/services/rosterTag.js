'use strict';

// Roster-vs-agency tagging for scheduling records (benchmark metric 3:
// agency dependence). A record is "roster" when its provider name matches an
// InternalRosterEntry by the SAME fingerprint rule the roster importer and
// Payroll Builder use (first-initial + last-name — see services/nameKey.js);
// otherwise it is agency/non-roster. Records with no parseable provider name
// stay untagged (isAgency null) and are reported as such, never guessed.

const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');

/**
 * Load the facility's roster as a Map of nameKey → rosterEntryId.
 * Matches against ALL roster entries (past members' historical shifts were
 * roster shifts when worked).
 */
async function buildRosterKeyMap(facilityId) {
  const roster = await prisma.internalRosterEntry.findMany({
    where: { facilityId },
    select: { id: true, providerName: true },
  });
  const map = new Map();
  for (const entry of roster) {
    const key = buildNameKey(entry.providerName);
    if (key && !map.has(key)) map.set(key, entry.id);
  }
  return map;
}

/**
 * Tag one record-shaped object against the roster key map.
 * Returns { isAgency, matchedRosterId } — both null when the name is
 * unparseable (unknown stays unknown).
 */
function tagRecord(providerName, keyMap) {
  const key = buildNameKey(providerName);
  if (!key) return { isAgency: null, matchedRosterId: null };
  const rosterId = keyMap.get(key);
  return rosterId
    ? { isAgency: false, matchedRosterId: rosterId }
    : { isAgency: true, matchedRosterId: null };
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

module.exports = { buildRosterKeyMap, tagRecord, backfillUntagged };
