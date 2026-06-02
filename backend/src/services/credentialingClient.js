/**
 * Client for the snap-credentialing API — used by snap-marketplace to drive
 * signature requests and read passport state on behalf of facility
 * coordinators and providers.
 *
 * Why this exists: snap-credentialing OWNS the passport (vision doc principle
 * — "marketplace is a consumer, not the owner"). The marketplace must not
 * store its own copy of credential/signature data. This client is the
 * single API surface for cross-app reads/writes.
 *
 * Required env:
 *   CREDENTIALING_API_URL  — base URL, e.g.
 *                            https://snap-credentialing-backend-production.up.railway.app
 *   CREDENTIALING_API_KEY  — shared secret (matches CREDENTIALING_SERVICE_API_KEY
 *                            on the credentialing side)
 */

const BASE_URL = process.env.CREDENTIALING_API_URL;
const SERVICE_KEY = process.env.CREDENTIALING_API_KEY;

function isConfigured() {
  return Boolean(BASE_URL && SERVICE_KEY);
}

/**
 * Throws an Error subclass that carries the upstream HTTP status so callers
 * can map to the right marketplace-side response (e.g. 404 → "provider not
 * onboarded yet" surfaced to coordinator).
 */
class CredentialingApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, { body, query } = {}) {
  if (!isConfigured()) {
    throw new CredentialingApiError(
      'Credentialing API client is not configured (CREDENTIALING_API_URL / CREDENTIALING_API_KEY).',
      503
    );
  }
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'X-Service-Key': SERVICE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON or empty body — leave parsed = null */
  }
  if (!res.ok) {
    const msg = parsed?.error || `Credentialing API ${method} ${path} returned ${res.status}`;
    throw new CredentialingApiError(msg, res.status, parsed);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a signature request for a provider, identified by email.
 *
 * @param {object} args
 * @param {string} args.providerEmail
 * @param {string} args.marketplaceFacilityId  Our facility id — used for audit on the credentialing side.
 * @param {string} args.documentName
 * @param {string} args.sourceDocumentUrl       Pre-signed URL Anvil can fetch from.
 * @param {string} [args.documentDescription]
 * @param {Date|string} [args.dueAt]
 */
async function createSignatureRequest(args) {
  return call('POST', '/api/service/signatures', {
    body: {
      providerEmail: args.providerEmail,
      marketplaceFacilityId: args.marketplaceFacilityId,
      documentName: args.documentName,
      documentDescription: args.documentDescription,
      dueAt: args.dueAt instanceof Date ? args.dueAt.toISOString() : args.dueAt,
      sourceDocumentUrl: args.sourceDocumentUrl,
    },
  });
}

/**
 * List a provider's signature requests, optionally filtered by status.
 * Used by marketplace mobile to compute passport blockers.
 *
 * @param {object} args
 * @param {string} args.providerEmail
 * @param {string} [args.status]  PENDING | SIGNED | DECLINED | EXPIRED
 * @returns {Promise<{ requests: object[] }>}
 */
async function listSignatureRequests({ providerEmail, status } = {}) {
  return call('GET', '/api/service/signatures', { query: { providerEmail, status } });
}

/**
 * Fetch a fresh embedded signing URL for a specific request.
 *
 * @param {object} args
 * @param {string} args.requestId
 * @param {string} args.providerEmail
 * @returns {Promise<{ url: string }>}
 */
async function getSignatureSignUrl({ requestId, providerEmail }) {
  return call('GET', `/api/service/signatures/${requestId}/sign-url`, {
    query: { providerEmail },
  });
}

module.exports = {
  isConfigured,
  CredentialingApiError,
  createSignatureRequest,
  listSignatureRequests,
  getSignatureSignUrl,
};
