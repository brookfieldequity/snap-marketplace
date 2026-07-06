// Server-side login sessions (Security HIGH-1).
//
// Every JWT we issue embeds a `jti` that must match a live AuthSession row.
// That gives us what stateless 30-day tokens couldn't: real server-side
// expiry, logout that actually kills the token, revoke-all on password reset,
// and an admin kill switch. Middleware calls assertSession() on every request.

const crypto = require('crypto');
const prisma = require('../config/db');

// Per-audience session lifetimes. Web portals get working-day windows
// (coordinators re-log daily); the provider mobile app keeps a long session
// for UX — it's revocable now, which is the part that matters.
const TTL_MS = {
  ADMIN: 8 * 60 * 60 * 1000, // 8h
  FACILITY: 12 * 60 * 60 * 1000, // 12h
  CREDENTIAL: 12 * 60 * 60 * 1000, // 12h
  PROVIDER: 30 * 24 * 60 * 60 * 1000, // 30d (mobile app)
};

// Matching JWT expiresIn strings (token exp mirrors the session's).
const TTL_JWT = {
  ADMIN: '8h',
  FACILITY: '12h',
  CREDENTIAL: '12h',
  PROVIDER: '30d',
};

// Only touch lastSeenAt when it's stale — avoids a write per request.
const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

// Create a session row and return { jti, expiresAt }. ttlMs overrides the
// audience default (e.g. the 24h admin demo-launch token).
async function issueSession({ audience, userId, req, ttlMs }) {
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + (ttlMs || TTL_MS[audience] || TTL_MS.FACILITY));
  await prisma.authSession.create({
    data: {
      jti,
      audience,
      userId,
      expiresAt,
      userAgent: req?.headers?.['user-agent']?.slice(0, 255) || null,
      ip: req?.ip || null,
    },
  });
  return { jti, expiresAt };
}

// Throws (with .code) when the session is missing, revoked, or expired.
async function assertSession(jti) {
  if (!jti) {
    const err = new Error('Session required');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  const session = await prisma.authSession.findUnique({ where: { jti } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    const err = new Error('Session expired or revoked');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    prisma.authSession
      .update({ where: { jti }, data: { lastSeenAt: new Date() } })
      .catch(() => {}); // telemetry only — never block the request
  }
  return session;
}

async function revokeByJti(jti) {
  if (!jti) return;
  await prisma.authSession
    .updateMany({ where: { jti, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => {});
}

// Kill every live session for a user (password reset, admin action).
// Returns the number of sessions revoked.
async function revokeAllForUser(userId, audience) {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null, ...(audience ? { audience } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// Purge rows that have been dead for a week (cron housekeeping).
async function gcSessions() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.authSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  if (result.count) console.log(`[authSessions] gc removed ${result.count} dead sessions`);
}

module.exports = { TTL_JWT, issueSession, assertSession, revokeByJti, revokeAllForUser, gcSessions };
