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

module.exports = { globalLimiter, authLimiter };
