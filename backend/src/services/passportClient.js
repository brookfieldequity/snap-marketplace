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
 * Ask the provider for access. The cred backend will fire a push
 * notification to the provider; they approve/deny in the credentialing
 * mobile app, which creates the actual PassportGrant.
 *
 * Currently a 501 stub on the cred side (Task #7). Calling this now
 * surfaces a "Not implemented" error with `plannedIn` so the marketplace
 * UI can show "feature coming soon" rather than a generic 5xx.
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
      facilityName,
      scopes,
    }),
  });
  if (ok) return body;
  const err = new Error(body?.error || `grant request failed (HTTP ${status})`);
  err.status = status;
  err.plannedIn = body?.plannedIn;
  throw err;
}

module.exports = {
  isConfigured,
  getGrantStatus,
  getPassport,
  requestGrant,
};
