/**
 * Cross-app login bridge (single sign-on between SNAP backends).
 *
 * A provider should be able to sign in to either app with one set of
 * credentials. When a password login fails locally, we ask the credentialing
 * backend to verify the same email+password; if it vouches for them, we
 * find-or-create the local PROVIDER account, store a locally-computed bcrypt
 * hash of the password (we hold the plaintext only for the duration of the
 * login request), and let the normal login flow continue. After the first
 * federated login the account is fully native here.
 *
 * Transport reuses the existing passport-bridge trust pair (X-Service-Key):
 *   - outbound calls use CREDENTIALING_API_KEY against CREDENTIALING_BACKEND_URL
 *   - the inbound /api/auth/service/verify-credentials endpoint (in routes/auth.js)
 *     accepts the same CREDENTIALING_API_KEY value from the peer
 * No new secrets: both env vars are already configured on Railway for the
 * passport bridge. If the key is unset, the bridge silently disables and
 * login behaves exactly as before.
 */

const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

const CRED_BACKEND_URL =
  process.env.CREDENTIALING_BACKEND_URL ||
  'https://snap-credentialing-backend-production.up.railway.app';

const VERIFY_TIMEOUT_MS = 5000;

function isConfigured() {
  return Boolean(process.env.CREDENTIALING_API_KEY);
}

/**
 * Ask the credentialing backend whether email+password are valid there.
 * Returns { valid, user: { email, firstName, lastName, npi } } or null on any
 * transport/config failure (callers treat null as "no federated opinion").
 */
async function verifyWithCredentialing(email, password) {
  if (!isConfigured()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(`${CRED_BACKEND_URL}/api/auth/service/verify-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Key': process.env.CREDENTIALING_API_KEY,
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('[authBridge] credentialing verify failed:', err.message);
    return null;
  }
}

/**
 * Federated fallback for /provider/login. Called only after local
 * verification failed. If the credentialing backend vouches for the
 * credentials, find-or-create the local PROVIDER user (mirroring the OAuth
 * find-or-create shape) and sync the local password hash so future logins
 * are native. Returns the user (with providerProfile) or null.
 */
async function federatedProviderLogin(email, password) {
  const peer = await verifyWithCredentialing(email, password);
  if (!peer || !peer.valid) return null;

  const normalizedEmail = String(email).trim().toLowerCase();
  const hashed = await bcrypt.hash(password, 10);

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { providerProfile: true },
  });

  if (user) {
    // Never let the bridge touch facility/admin accounts.
    if (user.role !== 'PROVIDER') return null;
    // Converge on the credentialing password (covers OAuth-only accounts with
    // no password, and passwords changed on the credentialing side).
    user = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
      include: { providerProfile: true },
    });
    console.log(`[authBridge] synced password from credentialing for user ${user.id}`);
    return user;
  }

  const p = peer.user || {};
  user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password: hashed,
      role: 'PROVIDER',
      providerProfile: {
        create: {
          firstName: p.firstName || undefined,
          lastName: p.lastName || undefined,
          npiNumber: p.npi || undefined,
          profileCompletePct: 10,
        },
      },
    },
    include: { providerProfile: true },
  });
  console.log(`[authBridge] provisioned marketplace account from credentialing login: user ${user.id}`);
  return user;
}

module.exports = { isConfigured, federatedProviderLogin };
