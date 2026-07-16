/**
 * Cross-app client for the snap-credentialing passport API.
 *
 * Marketplace consumes the credentialing backend as a trusted service,
 * authenticated via X-Service-Key (shared secret). The same secret is
 * configured on both Railway services:
 *   - cred backend env: CREDENTIALING_SERVICE_API_KEY
 *   - marketplace env:  CREDENTIALING_API_KEY
 *
 * Methods mirror the three v1 endpoints we need from this side:
 *   getGrantStatus(npi, facilityId) — precheck "does facility have access?"
 *   getPassport(npi, facilityId)    — full passport, filtered by grant scope
 *   requestGrant(npi, facilityId)   — fire a grant request (push to provider)
 *
 * See snap-credentialing/docs/passport-api-design.md for the contract.
 */

const CRED_BACKEND_URL =
  process.env.CREDENTIALING_BACKEND_URL ||
  'https://snap-credentialing-backend-production.up.railway.app';

function getServiceKey() {
  return process.env.CREDENTIALING_API_KEY;
}

/**
 * True when the bridge can be called. Use to gate UI / route handlers so
 * a missing key results in a clean 503 instead of a confusing fetch error.
 */
function isConfigured() {
  return Boolean(getServiceKey());
}

async function callPassportApi(path, opts = {}) {
  const key = getServiceKey();
  if (!key) {
    const err = new Error('CREDENTIALING_API_KEY is not set; passport bridge unavailable.');
    err.code = 'BRIDGE_NOT_CONFIGURED';
    throw err;
  }

  const url = `${CRED_BACKEND_URL}${path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'X-Service-Key': key,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body || undefined,
  });

  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body, ok: res.ok };
}

/**
 * GET /api/service/passport/:npi/grant-status?granteeRef=<facilityId>
 *
 * Returns the parsed body for 200 (grant exists) and 404 (no grant /
 * provider not found). Both are "expected" responses for this cheap
 * precheck — callers should branch on `body.exists`.
 *
 * Throws on 400 / 401 / 5xx so route handlers can surface real errors
 * rather than rendering "no grant" for a misconfigured request.
 */
async function getGrantStatus(npi, facilityId) {
  const path = `/api/service/passport/${encodeURIComponent(npi)}/grant-status?granteeRef=${encodeURIComponent(facilityId)}`;
  const { status, body } = await callPassportApi(path);
  if (status === 200 || status === 404) return body;
  const err = new Error(body?.error || `grant-status failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

/**
 * GET /api/service/passport/:npi?granteeRef=<facilityId>
 *
 * Full passport read, filtered by grant scopes. Returns the passport
 * payload on 200. Throws on any non-2xx with status + hint attached so
 * the calling route can decide whether to render "Request access" CTA
 * (403 no grant), "Provider not found" (404), or a generic error.
 */
async function getPassport(npi, facilityId) {
  const path = `/api/service/passport/${encodeURIComponent(npi)}?granteeRef=${encodeURIComponent(facilityId)}`;
  const { status, body, ok } = await callPassportApi(path);
  if (ok) return body;
  const err = new Error(body?.error || `passport read failed (HTTP ${status})`);
  err.status = status;
  err.hint = body?.hint;
  throw err;
}

/**
 * POST /api/service/passport/:npi/grant-request
 *
 * Ask the provider for access. The cred backend fires a push notification to
 * the provider; they approve/deny in the credentialing mobile app, which
 * creates the actual PassportGrant.
 *
 * Optional payload:
 *   facilityName — human-friendly label shown in the push notification
 *   scopes       — array of requested scopes (default: provider chooses)
 */
async function requestGrant(npi, facilityId, { facilityName, scopes } = {}) {
  const path = `/api/service/passport/${encodeURIComponent(npi)}/grant-request`;
  const { status, body, ok } = await callPassportApi(path, {
    method: 'POST',
    body: JSON.stringify({
      granteeRef: facilityId,
      granteeLabel: facilityName,
      scopes,
    }),
  });
  if (ok) return body;
  const err = new Error(body?.error || `grant request failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

/**
 * POST /api/service/passport/invite
 *
 * Facility-initiated credentialing invite. Two outcomes, distinguished by
 * `mode` in the returned body:
 *   - INVITE_CREATED   → provider has no passport yet; body.claimToken is a
 *                        one-time token. Build a claim link and deliver it
 *                        (email/SMS) so the provider can register + claim.
 *   - EXISTING_PROVIDER → provider already has a passport; the cred backend
 *                        pushed a grant request to their app (no claim link).
 *   - ALREADY_GRANTED  → this facility already has an active grant.
 *
 * Optional payload:
 *   facilityName — shown to the provider in the invite + on the grant
 *   firstName/lastName — pre-seed the provider's profile on claim
 *   scopes       — scopes to auto-grant on claim (default: server default)
 */
async function invite(npi, facilityId, { facilityName, firstName, lastName, scopes } = {}) {
  const { status, body, ok } = await callPassportApi('/api/service/passport/invite', {
    method: 'POST',
    body: JSON.stringify({
      npi,
      firstName,
      lastName,
      granteeRef: facilityId,
      granteeLabel: facilityName,
      scopes,
    }),
  });
  if (ok) return body;
  const err = new Error(body?.error || `invite failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

/**
 * GET /api/cme/by-npi/:npi
 *
 * Returns CME history for a provider identified by NPI. Returns
 * { entries, totalHours, found } — found=false means provider has no
 * passport yet (not an error; just show "No CME records yet").
 */
async function getCmeHistory(npi) {
  const { status, body, ok } = await callPassportApi(`/api/cme/by-npi/${encodeURIComponent(npi)}`);
  if (ok) return body;
  const err = new Error(body?.error || `CME lookup failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

/**
 * POST /api/service/passport/batch-summary
 *
 * One round-trip roster summary for the portal list + expiry dashboard.
 * Returns { summaries: [{ npi, exists, hasGrant, completeness?, credentials? }] }.
 */
async function batchSummary(facilityId, npis) {
  const { status, body, ok } = await callPassportApi('/api/service/passport/batch-summary', {
    method: 'POST',
    body: JSON.stringify({ granteeRef: facilityId, npis }),
  });
  if (ok) return body;
  const err = new Error(body?.error || `batch summary failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

/**
 * PUT /api/service/passport/:npi/credentials/:type
 *
 * Coordinator write path — record/correct credential facts (expiry dates,
 * identifiers) on the passport. Facility-entered provenance, not verification.
 */
async function updateCredential(npi, facilityId, type, fields) {
  const path = `/api/service/passport/${encodeURIComponent(npi)}/credentials/${encodeURIComponent(type)}?granteeRef=${encodeURIComponent(facilityId)}`;
  const { status, body, ok } = await callPassportApi(path, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
  if (ok) return body;
  const err = new Error(body?.error || `credential update failed (HTTP ${status})`);
  err.status = status;
  err.hint = body?.hint;
  throw err;
}

/**
 * POST /api/service/passport/:npi/documents
 *
 * Coordinator document upload on behalf of a granted provider. `file` is
 * { buffer, originalname, mimetype } (multer memory-storage shape).
 * Stored encrypted on the passport backend; nothing kept marketplace-side.
 */
async function uploadDocument(npi, facilityId, file, { type, credentialType } = {}) {
  const key = getServiceKey();
  if (!key) {
    const err = new Error('CREDENTIALING_API_KEY is not set; passport bridge unavailable.');
    err.code = 'BRIDGE_NOT_CONFIGURED';
    throw err;
  }
  const form = new FormData();
  form.append('document', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  if (type) form.append('type', type);
  if (credentialType) form.append('credentialType', credentialType);

  const url = `${CRED_BACKEND_URL}/api/service/passport/${encodeURIComponent(npi)}/documents?granteeRef=${encodeURIComponent(facilityId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Service-Key': key, Accept: 'application/json' },
    body: form,
  });
  let body = null;
  const text = await res.text();
  if (text) { try { body = JSON.parse(text); } catch { body = { raw: text }; } }
  if (res.ok) return body;
  const err = new Error(body?.error || `document upload failed (HTTP ${res.status})`);
  err.status = res.status;
  throw err;
}

// ── Smart Document Intake (ease of switch) ───────────────────────────────────

/** Forward a multi-file upload (multer memory files) to the intake pipeline. */
async function createIntakeBatch(facilityId, facilityName, files, rosterHints) {
  const key = getServiceKey();
  if (!key) {
    const err = new Error('CREDENTIALING_API_KEY is not set; passport bridge unavailable.');
    err.code = 'BRIDGE_NOT_CONFIGURED';
    throw err;
  }
  const form = new FormData();
  form.append('granteeRef', facilityId);
  form.append('granteeLabel', facilityName || facilityId);
  if (rosterHints) form.append('rosterHints', JSON.stringify(rosterHints));
  for (const f of files) {
    form.append('files', new Blob([f.buffer], { type: f.mimetype }), f.originalname);
  }
  const res = await fetch(`${CRED_BACKEND_URL}/api/service/intake/batches`, {
    method: 'POST',
    headers: { 'X-Service-Key': key, Accept: 'application/json' },
    body: form,
  });
  let body = null;
  const text = await res.text();
  if (text) { try { body = JSON.parse(text); } catch { body = { raw: text }; } }
  if (res.ok) return body;
  const err = new Error(body?.error || `intake upload failed (HTTP ${res.status})`);
  err.status = res.status;
  throw err;
}

async function listIntakeBatches(facilityId) {
  const { status, body, ok } = await callPassportApi(`/api/service/intake/batches?granteeRef=${encodeURIComponent(facilityId)}`);
  if (ok) return body;
  const err = new Error(body?.error || `intake list failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

async function getIntakeBatch(facilityId, batchId) {
  const { status, body, ok } = await callPassportApi(`/api/service/intake/batches/${encodeURIComponent(batchId)}?granteeRef=${encodeURIComponent(facilityId)}`);
  if (ok) return body;
  const err = new Error(body?.error || `intake read failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

async function updateIntakeItem(itemId, fields) {
  const { status, body, ok } = await callPassportApi(`/api/service/intake/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  if (ok) return body;
  const err = new Error(body?.error || `intake item update failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

async function commitIntakeBatch(facilityId, batchId) {
  const { status, body, ok } = await callPassportApi(`/api/service/intake/batches/${encodeURIComponent(batchId)}/commit`, {
    method: 'POST',
    body: JSON.stringify({ granteeRef: facilityId }),
  });
  if (ok) return body;
  const err = new Error(body?.error || `intake commit failed (HTTP ${status})`);
  err.status = status;
  throw err;
}

module.exports = {
  isConfigured,
  getGrantStatus,
  getPassport,
  requestGrant,
  invite,
  getCmeHistory,
  batchSummary,
  updateCredential,
  uploadDocument,
  createIntakeBatch,
  listIntakeBatches,
  getIntakeBatch,
  updateIntakeItem,
  commitIntakeBatch,
};
