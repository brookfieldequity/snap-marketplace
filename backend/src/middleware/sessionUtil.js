// Shared helpers for session-backed auth middlewares (Security HIGH-1).

// Which portal a token belongs to — used so the frontend knows exactly which
// stored token to clear when a session dies.
function audienceOf(payload) {
  if (!payload) return null;
  if (payload.type === 'credential') return 'CREDENTIAL';
  if (payload.role === 'ADMIN') return 'ADMIN';
  if (payload.role === 'FACILITY_USER') return 'FACILITY';
  return 'PROVIDER';
}

// Uniform 401 for anything session-related (expired JWT, missing jti, revoked
// or expired session). code lets clients distinguish "sign in again" from
// other 401s; audience tells the web app which portal token to drop.
function sendSessionExpired(res, audience) {
  return res.status(401).json({
    error: 'Your session has expired — please sign in again.',
    code: 'SESSION_EXPIRED',
    audience: audience || null,
  });
}

module.exports = { audienceOf, sendSessionExpired };
