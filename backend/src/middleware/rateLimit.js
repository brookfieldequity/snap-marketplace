const rateLimit = require('express-rate-limit');

// Broad limiter applied to every request — a blunt backstop against abuse.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for credential-bearing endpoints (login / register / password
// reset) to slow brute-force and credential-stuffing attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

// ── Admin login IP lockout ────────────────────────────────────────────────────
// Tracks failed admin login attempts per IP. After MAX_ATTEMPTS failures within
// WINDOW_MS, the IP is locked out for LOCKOUT_MS. Success clears the record.
// In-memory only — resets on dyno restart, which is acceptable: a restarting
// server is itself a deterrent, and we're not storing PII.

const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 min counting window
const LOCKOUT_MS   = 30 * 60 * 1000; // 30 min lockout after MAX_ATTEMPTS

const adminFailMap = new Map(); // ip -> { count, firstAttemptAt, lockedUntil? }

function checkAdminLockout(req, res, next) {
  const ip     = req.ip;
  const now    = Date.now();
  const record = adminFailMap.get(ip);

  if (record?.lockedUntil && now < record.lockedUntil) {
    const mins = Math.ceil((record.lockedUntil - now) / 60_000);
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    });
  }
  next();
}

function recordAdminFailure(ip) {
  const now    = Date.now();
  const record = adminFailMap.get(ip) || { count: 0, firstAttemptAt: now };

  if (now - record.firstAttemptAt > WINDOW_MS) {
    record.count          = 0;
    record.firstAttemptAt = now;
    delete record.lockedUntil;
  }

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) record.lockedUntil = now + LOCKOUT_MS;

  adminFailMap.set(ip, record);
}

function clearAdminFailures(ip) {
  adminFailMap.delete(ip);
}

module.exports = { globalLimiter, authLimiter, checkAdminLockout, recordAdminFailure, clearAdminFailures };
