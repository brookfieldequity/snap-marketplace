# SNAP Marketplace — Pilot Hardening Notes

Security hardening applied before the limited production pilot. Read alongside `DEPLOYMENT.md`.

## What changed in the backend

- **Boot-time env validation** (`backend/src/config/env.js`): the service refuses to
  start unless `JWT_SECRET` is set (≥32 chars) and, in production, `CORS_ORIGINS` is set.
  No more insecure fallbacks.
- Removed hardcoded `JWT_SECRET` fallback (`'snap-secret'`) and the default admin
  password (`'SnapAdmin2024!'`). The admin seed is skipped if `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` are not set.
- **CORS** is an explicit allowlist (`CORS_ORIGINS`, comma-separated) — never allow-all in prod.
- **helmet** security headers + HSTS.
- **express-rate-limit**: global (1000 / 15 min) + strict on auth endpoints (20 / 15 min);
  `trust proxy` set for Railway.
- JSON/body size limits (2 MB); 404 handler; global error handler that never leaks stack traces.
- Upload hardening: strict file-type allowlist + randomized storage filenames.

## ⚠️ Railway gotcha

Railway runs Node with **`NODE_ENV=production` at runtime even if it's not in the
Variables tab**. Any env-gated boot check therefore runs in prod mode. **Set required
env vars on a service BEFORE deploying code that fails-fast on them**, or the service
will crash-loop.

## Required env vars (backend service)

`DATABASE_URL`, `JWT_SECRET` (≥32-char hex), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`CORS_ORIGINS`, `NODE_ENV=production`, plus `SENDGRID_*`, `TWILIO_*`, `AWS_*`.
Do **not** set `PORT` (Railway injects it).

## Post-deploy verification

```
curl -sD - https://<backend>/health -o /dev/null   # expect helmet headers + ratelimit-limit
curl -s https://<backend>/api/does-not-exist        # expect {"error":"Not found"}
# 25 rapid POSTs to /api/auth/admin/login -> 429 after ~20
```

## Post-pilot punch list (not done yet)

- **`xlsx` dependency** has a known high-severity prototype-pollution/ReDoS (no npm fix).
  Switch to the SheetJS CDN tarball, or restrict spreadsheet upload to trusted users.
- Marketplace `multer` is still 1.x — upgrade to 2.x (breaking API changes).
- Add request-body schema validation (zod/joi) on auth + write endpoints.
- Add audit logging for admin/credential actions; structured logging (pino) instead of console.
- Reduce provider/facility JWT expiry from 30d.
- Bound the in-memory doc rate-limit `Map` in `routes/credentialing.js` (memory growth).
- Credentialing backend: rotate `JWT_SECRET` (still the dev value) and reset the admin
  password; the standalone admin web app points at a dead Render URL and needs repointing.
- Confirm Neon database backups / point-in-time recovery before go-live.
