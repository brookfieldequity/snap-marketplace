// Centralized environment validation.
// Required config is checked at boot so the service never starts in an
// insecure state (e.g. with a missing JWT secret or wide-open CORS).

const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// JWT_SECRET is mandatory in every environment — there is no safe default.
const JWT_SECRET = required('JWT_SECRET');
if (JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters (use a 64-char random hex string)');
}

// CORS allowlist is mandatory in production. In local dev, an unset value
// reflects the request origin so tooling keeps working.
let corsOrigins;
if (process.env.CORS_ORIGINS) {
  corsOrigins = process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
} else if (isProd) {
  throw new Error('CORS_ORIGINS must be set in production (comma-separated allowlist of frontend URLs)');
} else {
  corsOrigins = true; // dev only
}

module.exports = { isProd, JWT_SECRET, corsOrigins };
