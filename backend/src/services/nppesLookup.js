/**
 * NPPES (NPI Registry) lookup utility.
 *
 * Public CMS API — no auth, no rate limit (within reason), instant.
 * Docs: https://npiregistry.cms.hhs.gov/api-page
 *
 * We use it during roster import to attach NPIs to provider rows when the
 * source file (e.g., CAPA's roster spreadsheet) doesn't include NPI itself.
 * NPI is the canonical SNAP provider identity per
 * [[passport-first-architecture]] — every roster row should have one.
 *
 * Usage:
 *   const { resolveNpi } = require('./nppesLookup');
 *   const result = await resolveNpi({ name: 'Jane Smith', state: 'MA' });
 *   // result.decision is one of: AUTO_MATCHED | NEEDS_DISAMBIGUATION | NO_MATCH
 *   // result.matches is array of candidate NPI records
 */

const NPPES_API_URL = 'https://npiregistry.cms.hhs.gov/api/';

// ── Throttle + retry ─────────────────────────────────────────────────────────
// NPPES throttles rapid bursts (a resolve/import pass firing dozens of calls
// back-to-back gets starved — empty results or 429s). Space every call out
// globally and retry transient failures so large passes complete reliably from
// any host (Railway, local, etc.).
const MIN_GAP_MS = parseInt(process.env.NPPES_MIN_GAP_MS || '300', 10);
let _nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, _nextSlot - now);
  _nextSlot = Math.max(now, _nextSlot) + MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}
async function nppesGet(params, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    // eslint-disable-next-line no-await-in-loop
    await throttle();
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${NPPES_API_URL}?${params}`);
      if (res.ok) return await res.json();
      // 429 / 5xx are transient → back off and retry; other 4xx → give up.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status);
        // eslint-disable-next-line no-await-in-loop
        await sleep(800 * (i + 1));
        continue;
      }
      console.error('[nppes] HTTP', res.status);
      return null;
    } catch (err) {
      lastErr = err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(800 * (i + 1));
    }
  }
  if (lastErr) console.error('[nppes] gave up after retries:', lastErr.message);
  return null;
}

/**
 * Raw search against NPPES. Returns normalized match objects.
 * Empty array on any error / no results.
 */
async function searchByName({ firstName, lastName, state, limit = 5 }) {
  if (!firstName || !lastName) return [];

  const params = new URLSearchParams({
    version: '2.1',
    first_name: firstName,
    last_name: lastName,
    enumeration_type: 'NPI-1', // Individual providers only (NPI-2 = organizations)
    limit: String(limit),
  });
  if (state) params.set('state', state);

  const data = await nppesGet(params);
  if (!data) return [];
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((r) => r.basic) // drop records with no basic data (rare; deactivated entries)
    .map((r) => ({
        npi: r.number,
        firstName: r.basic.first_name || null,
        lastName: r.basic.last_name || null,
        middleName: r.basic.middle_name || null,
        credential: r.basic.credential || null,
        status: r.basic.status || null, // 'A' = Active
        // Most-recent primary taxonomy (specialty). NPPES lists potentially many;
        // we surface the primary so the disambiguation UI can show "Anesthesiology"
        // next to the name.
        primaryTaxonomy: (r.taxonomies || []).find((t) => t.primary)?.desc || null,
        // First mailing address — gives coordinator enough to pick the right
        // person ("the Jane Smith in Worcester, not Boston").
        primaryAddress: (r.addresses || [])
          .filter((a) => a.address_purpose === 'LOCATION' || a.address_purpose === 'MAILING')
          .map((a) => ({ city: a.city, state: a.state }))[0] || null,
    }));
}

/**
 * Parse "Jane Q Smith" -> { firstName: "Jane", lastName: "Smith" }.
 * Strategy: last token is lastName; first token is firstName; middle tokens
 * are ignored (NPPES name matching tolerates missing middle names).
 *
 * Returns null if name can't be split into at least 2 parts.
 */
function splitName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  // Normalize whitespace; strip credentials suffixes (", CRNA", ", MD", "(MD)")
  const cleaned = rawName
    .replace(/,?\s*\(?(MD|DO|CRNA|AA|PA|NP)\)?\.?$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
  const parts = cleaned.split(' ').filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

/**
 * Resolve an NPI from a single name string.
 *
 * Returns:
 *   { decision: 'AUTO_MATCHED', matches: [singleMatch], npi: '...' }
 *     -> single high-confidence match; safe to auto-attach
 *   { decision: 'NEEDS_DISAMBIGUATION', matches: [...] }
 *     -> multiple candidates; coordinator must pick one in the UI
 *   { decision: 'NO_MATCH', matches: [] }
 *     -> zero candidates; row imports with npi=null + a flag for review
 *   { decision: 'INVALID_NAME', matches: [] }
 *     -> name couldn't be parsed into first+last
 */
async function resolveNpi({ name, state = 'MA' } = {}) {
  const split = splitName(name);
  if (!split) return { decision: 'INVALID_NAME', matches: [], npi: null };

  const matches = await searchByName({
    firstName: split.firstName,
    lastName: split.lastName,
    state,
  });
  // Only consider active records — deactivated NPIs cause more confusion than
  // they help during disambiguation.
  const active = matches.filter((m) => m.status === 'A');

  if (active.length === 0) {
    return { decision: 'NO_MATCH', matches: [], npi: null, searched: split };
  }
  if (active.length === 1) {
    return { decision: 'AUTO_MATCHED', matches: active, npi: active[0].npi };
  }
  return { decision: 'NEEDS_DISAMBIGUATION', matches: active, npi: null, searched: split };
}

/**
 * Look up a single NPI by number and return its primary taxonomy + name.
 * Used to authoritatively re-classify a roster row's provider type. Returns
 * { found: false } on any miss/error so callers can skip safely.
 */
async function lookupByNumber(npi) {
  if (!/^\d{10}$/.test(String(npi || ''))) return { found: false };
  const params = new URLSearchParams({ version: '2.1', number: String(npi) });
  const data = await nppesGet(params);
  if (!data) return { found: false };
  const r = Array.isArray(data.results) ? data.results[0] : null;
  if (!r || !r.basic) return { found: false };
  return {
    found: true,
    firstName: r.basic.first_name || null,
    lastName: r.basic.last_name || null,
    credential: r.basic.credential || null,
    primaryTaxonomy:
      (r.taxonomies || []).find((t) => t.primary)?.desc || (r.taxonomies || [])[0]?.desc || null,
  };
}

/**
 * Map an NPPES taxonomy description to a SNAP Specialty enum value. Returns
 * null when it isn't one of our three anesthesia roles, so callers leave the
 * existing type untouched rather than guessing. Order matters: "Anesthesiologist
 * Assistant" also contains "anesthesiolog", so it's checked before the MD case.
 */
function specialtyFromTaxonomy(desc) {
  if (!desc) return null;
  const d = String(desc).toLowerCase();
  if (d.includes('nurse anesthetist')) return 'CRNA';
  if (d.includes('anesthesiologist assistant')) return 'ANESTHESIA_ASSISTANT';
  if (d.includes('anesthesiolog')) return 'ANESTHESIOLOGIST'; // "Anesthesiology" (MD/DO)
  return null;
}

module.exports = { searchByName, splitName, resolveNpi, lookupByNumber, specialtyFromTaxonomy };
