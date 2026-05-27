# SNAP Marketplace — Railway Deployment Guide

This guide deploys two Railway services (backend API + web portal) from the same GitHub repository using monorepo root directories.

---

## Prerequisites

- GitHub account with the `snap-marketplace` repository pushed to it
- Railway account (railway.app) — Hobby plan or higher
- Your existing Neon PostgreSQL `DATABASE_URL` (or use Railway's built-in PostgreSQL)
- All API keys ready: JWT secret, SendGrid, Twilio, AWS S3

---

## Step 1 — Create a Railway Account

1. Go to [railway.app](https://railway.app) and sign up with GitHub
2. Click **New Project**

---

## Step 2 — Add a PostgreSQL Database

> Skip this if you are keeping your existing Neon database — just use that DATABASE_URL.

1. Inside your new Railway project, click **+ New** → **Database** → **Add PostgreSQL**
2. Wait for it to provision (30–60 seconds)
3. Click the PostgreSQL service → **Variables** tab
4. Copy the `DATABASE_URL` value — you will need it in Step 5

---

## Step 3 — Deploy the Backend

### 3a — Create the backend service

1. Click **+ New** → **GitHub Repo**
2. Select your `snap-marketplace` repository
3. When asked for the root directory, set it to: **`backend`**
4. Railway will detect Node.js automatically

### 3b — Set backend environment variables

In the backend service → **Variables** tab, add every variable from `backend/.env.example`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon URL or the Railway PostgreSQL URL from Step 2 |
| `JWT_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` locally and paste the result |
| `ADMIN_EMAIL` | `admin@snapmedical.com` |
| `ADMIN_PASSWORD` | A strong password you will use to log into the admin panel |
| `SENDGRID_API_KEY` | Your SendGrid key (starts with `SG.`) |
| `SENDGRID_FROM_EMAIL` | `noreply@snapmedical.com` |
| `TWILIO_ACCOUNT_SID` | Your Twilio SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | Your Twilio auth token |
| `TWILIO_PHONE_NUMBER` | `+18669701509` |
| `AWS_ACCESS_KEY_ID` | Your AWS key ID |
| `AWS_SECRET_ACCESS_KEY` | Your AWS secret |
| `AWS_REGION` | `us-east-1` |
| `AWS_S3_BUCKET` | `snap-marketplace-uploads` |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Leave blank for now — fill in after Step 6 |

> Do NOT set `PORT` — Railway injects this automatically.

### 3c — Deploy

1. Click **Deploy** (or it may auto-deploy after saving variables)
2. Watch the build logs — it will run:
   - `npm ci`
   - `npx prisma generate` (build step)
   - `npx prisma db push` (syncs schema to database on first start)
   - `node src/index.js`
3. Build takes 2–4 minutes on first deploy

### 3d — Verify the backend is running

Once deployed, Railway shows a public URL like `https://snap-marketplace-backend-xxxx.up.railway.app`.

Open: `https://YOUR-BACKEND-URL.up.railway.app/health`

You should see: `{"status":"ok","app":"SNAP Marketplace"}`

**Copy this backend URL — you need it for the next step.**

---

## Step 4 — Deploy the Web Portal

### 4a — Create the web service

1. Inside the same Railway project, click **+ New** → **GitHub Repo**
2. Select the same `snap-marketplace` repository
3. Set root directory to: **`web`**

### 4b — Set web environment variables

In the web service → **Variables** tab:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://YOUR-BACKEND-URL.up.railway.app/api` |

Replace `YOUR-BACKEND-URL` with the actual URL from Step 3d.

### 4c — Deploy

1. Click **Deploy**
2. Build runs `npm install && npm run build` then serves via `vite preview`
3. Takes 1–2 minutes

Once done, Railway gives you a web portal URL like `https://snap-web-xxxx.up.railway.app`

**Copy this web URL — you need it for Step 5.**

---

## Step 5 — Update Backend CORS

Now that you have both URLs, configure the backend to accept requests from the web portal:

1. Go to the **backend** service → **Variables** tab
2. Set `CORS_ORIGINS` to your web portal URL (comma-separated if you have multiple):
   ```
   https://snap-web-xxxx.up.railway.app,https://charming-cassata-46043f.netlify.app
   ```
3. Railway will automatically redeploy the backend

---

## Step 6 — Verify End-to-End

1. Open your web portal URL in a browser
2. Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in Step 3b
3. Confirm the dashboard loads and data is visible
4. Open a second tab and register a facility account to confirm the full auth flow

---

## Step 7 — Update the Mobile App (EAS Build)

Before building a new version of the mobile app pointing to Railway:

1. Open `mobile/eas.json`
2. Find the `production.env` section and replace the placeholder URL:
   ```json
   "EXPO_PUBLIC_API_URL": "https://YOUR-BACKEND-URL.up.railway.app/api"
   ```
3. Build and submit a new production version:
   ```bash
   cd mobile
   npx eas-cli build --platform ios --profile production
   npx eas-cli submit --platform ios --latest
   ```

---

## Step 8 — Custom Domain (Optional)

To use `api.snapmedical.com` and `app.snapmedical.com` instead of Railway's generated URLs:

1. Backend service → **Settings** → **Domains** → **Custom Domain**
   - Add `api.snapmedical.com`
   - Add the CNAME record Railway provides to your DNS (Namecheap / Cloudflare)
2. Web service → **Settings** → **Domains** → **Custom Domain**
   - Add `app.snapmedical.com`
3. After DNS propagates (~5 min with Cloudflare, up to 48h otherwise), update:
   - Backend `CORS_ORIGINS` to include `https://app.snapmedical.com`
   - Web `VITE_API_URL` to `https://api.snapmedical.com/api`
   - `mobile/eas.json` `EXPO_PUBLIC_API_URL` to `https://api.snapmedical.com/api`

---

## Environment Variable Quick Reference

### Backend (`backend/.env.example`)
```
DATABASE_URL          — PostgreSQL connection string
JWT_SECRET            — 64-char random hex
ADMIN_EMAIL           — Admin login email
ADMIN_PASSWORD        — Admin login password
SENDGRID_API_KEY      — SendGrid API key
SENDGRID_FROM_EMAIL   — Verified sender email
TWILIO_ACCOUNT_SID    — Twilio SID
TWILIO_AUTH_TOKEN     — Twilio auth token
TWILIO_PHONE_NUMBER   — Twilio number (+E.164)
AWS_ACCESS_KEY_ID     — AWS IAM key
AWS_SECRET_ACCESS_KEY — AWS IAM secret
AWS_REGION            — us-east-1
AWS_S3_BUCKET         — S3 bucket name
CORS_ORIGINS          — Comma-separated frontend URLs
NODE_ENV              — production
```

### Web portal (`web/.env.example`)
```
VITE_API_URL          — Full backend URL including /api
```

### Mobile (`mobile/eas.json` production env)
```
EXPO_PUBLIC_API_URL   — Full backend URL including /api
```

---

## Troubleshooting

**Backend build fails with "prisma: command not found"**
→ Ensure `prisma` is in `devDependencies` in `backend/package.json`. Railway installs devDependencies during the build phase.

**`npx prisma db push` fails on start**
→ Check that `DATABASE_URL` is correctly set in the backend Variables tab. Open the PostgreSQL service and copy the exact URL.

**Web portal shows blank page or network errors**
→ Check browser console. If you see CORS errors, your `CORS_ORIGINS` on the backend does not include the web portal URL. Update it and redeploy.

**"Unauthorized" on all API calls from web portal**
→ Confirm `VITE_API_URL` ends with `/api` (not just the root domain). The variable is baked into the build — redeploy the web service after changing it.

**Mobile app still hitting old Render URL**
→ Update `EXPO_PUBLIC_API_URL` in `mobile/eas.json` and submit a new EAS production build.
