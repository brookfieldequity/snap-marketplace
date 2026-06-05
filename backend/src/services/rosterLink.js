/**
 * Reverse-link helper.
 *
 * The roster importer auto-links rows to a marketplace ProviderProfile at
 * import time (by NPI, falling back to email). But CAPA's real flow is the
 * opposite: providers are imported into the roster BEFORE they register in
 * the marketplace mobile app. When they later register or log in, nothing
 * stitched them back to their roster row, so My Schedule + Today rendered
 * empty even though they had assignments.
 *
 * This module fixes that. Call `reverseLinkForProvider(...)` on every
 * provider register/login success; it's idempotent and cheap. Also exposes
 * `reverseLinkAllOrphans` for a one-shot retroactive pass across the whole
 * customer base.
 */

const prisma = require('../config/db');

/**
 * Link any orphan InternalRosterEntry rows to a freshly-authenticated
 * provider. "Orphan" = linkedProviderId is null. Matches by:
 *   1. NPI exact match (the canonical identity key)
 *   2. snapAccountEmail case-insensitive match (when row has no NPI)
 *
 * Always re-checks both axes so a registration that adds an NPI later
 * picks up rows that the email-only pass missed.
 *
 * Safe to call on every login — no-op when nothing matches.
 *
 * @param {object} provider - { id, userEmail, npiNumber }
 * @returns {Promise<{linked: number, rosterEntryIds: string[]}>}
 */
async function reverseLinkForProvider({ id, userEmail, npiNumber }) {
  if (!id) return { linked: 0, rosterEntryIds: [] };
  // Build the OR clause — match by NPI when we have one, AND match by
  // email when we have one. Skip the email branch if there's no email.
  const or = [];
  if (npiNumber) or.push({ npi: npiNumber });
  if (userEmail) {
    // Prisma doesn't support case-insensitive equality cheaply across all
    // backends — store lowercased on InternalRosterEntry.snapAccountEmail
    // already (importer/manual entry both normalize). Compare lowercased.
    or.push({ snapAccountEmail: userEmail.toLowerCase() });
  }
  if (or.length === 0) return { linked: 0, rosterEntryIds: [] };

  const orphans = await prisma.internalRosterEntry.findMany({
    where: {
      linkedProviderId: null,
      OR: or,
    },
    select: { id: true },
  });
  if (orphans.length === 0) return { linked: 0, rosterEntryIds: [] };

  const ids = orphans.map((r) => r.id);
  await prisma.internalRosterEntry.updateMany({
    where: { id: { in: ids } },
    data: {
      linkedProviderId: id,
      snapAccountLinked: true,
    },
  });
  return { linked: ids.length, rosterEntryIds: ids };
}

/**
 * One-shot retroactive linker. Walks every orphan roster entry across the
 * whole DB, looks each up against ProviderProfile by NPI then email, and
 * links anyone who registered before the per-login reconciler landed.
 *
 * Returns {linked, scanned} so an admin endpoint can report results.
 */
async function reverseLinkAllOrphans() {
  const orphans = await prisma.internalRosterEntry.findMany({
    where: { linkedProviderId: null },
    select: { id: true, npi: true, snapAccountEmail: true },
  });
  if (orphans.length === 0) return { linked: 0, scanned: 0 };

  // Pre-load all providers in one query keyed on NPI + email so we don't
  // hit the DB N times for a 5000-row roster. Marketplace is single-tenant
  // for this concept (provider ↔ roster across all facilities), so a
  // single pass is fine.
  const npis = [...new Set(orphans.map((o) => o.npi).filter(Boolean))];
  const emails = [...new Set(orphans.map((o) => o.snapAccountEmail).filter(Boolean))];

  const profilesByNpi = new Map();
  if (npis.length > 0) {
    const rows = await prisma.providerProfile.findMany({
      where: { npiNumber: { in: npis } },
      select: { id: true, npiNumber: true },
    });
    for (const r of rows) profilesByNpi.set(r.npiNumber, r.id);
  }

  const profilesByEmail = new Map();
  if (emails.length > 0) {
    const users = await prisma.user.findMany({
      where: { email: { in: emails }, role: 'PROVIDER' },
      select: { email: true, providerProfile: { select: { id: true } } },
    });
    for (const u of users) {
      if (u.providerProfile) profilesByEmail.set(u.email.toLowerCase(), u.providerProfile.id);
    }
  }

  // Group orphans by the providerId they should link to. Per-provider
  // batched updateMany — much cheaper than per-row updates.
  const groups = new Map(); // providerId -> [rosterEntryId, ...]
  for (const o of orphans) {
    const matchedId =
      (o.npi && profilesByNpi.get(o.npi)) ||
      (o.snapAccountEmail && profilesByEmail.get(o.snapAccountEmail.toLowerCase())) ||
      null;
    if (matchedId) {
      const list = groups.get(matchedId) || [];
      list.push(o.id);
      groups.set(matchedId, list);
    }
  }
  let linked = 0;
  for (const [providerId, ids] of groups.entries()) {
    const result = await prisma.internalRosterEntry.updateMany({
      where: { id: { in: ids } },
      data: { linkedProviderId: providerId, snapAccountLinked: true },
    });
    linked += result.count;
  }
  return { linked, scanned: orphans.length };
}

module.exports = { reverseLinkForProvider, reverseLinkAllOrphans };
