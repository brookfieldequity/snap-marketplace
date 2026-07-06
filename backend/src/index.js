require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const prisma = require('./config/db');
// Validates required env (JWT_SECRET, CORS_ORIGINS in prod) at boot — throws if missing.
const { corsOrigins } = require('./config/env');
const { globalLimiter, authLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const shiftRoutes = require('./routes/shifts');
const providerRoutes = require('./routes/providers');
const facilityRoutes = require('./routes/facilities');
const completionRoutes = require('./routes/completions');
const ratingRoutes = require('./routes/ratings');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');
// SNAP Shifts routes
const rosterRoutes = require('./routes/roster');
const rosterAvailabilityRoutes = require('./routes/rosterAvailability');
const windowRoutes = require('./routes/windows');
const scheduleRoutes = require('./routes/schedule');
const incentiveRoutes = require('./routes/incentive');
const staffiqRoutes = require('./routes/staffiq');
const datauploadRoutes = require('./routes/dataupload');
const calculatorRoutes = require('./routes/calculator');
const leadsRoutes = require('./routes/leads');
const staffiqInputsRoutes = require('./routes/staffiqInputs');
const credentialingRoutes = require('./routes/credentialing');
const payrollRoutes = require('./routes/payroll');
const hourEntryRoutes = require('./routes/hourEntry');
const featureFlagRoutes = require('./routes/featureFlags');
const ptoBuilderRoutes = require('./routes/ptoBuilder');
const coverageTemplatesRoutes = require('./routes/coverageTemplates');
const holidayRoutes = require('./routes/holidays');
const automationEventsRoutes = require('./routes/automationEvents')
const { router: invoiceRoutes, processMonthlyInvoices } = require('./routes/invoices');

const { runSurgePricing, expireOldShifts, openPreferredShifts, notifySurgeExpiring } = require('./jobs/surge');
const { checkAllVipStatuses } = require('./jobs/vip');
const { checkExpiredIncentiveShifts } = require('./services/notifications');
const { seedNetworkPriors } = require('./services/staffiqLearning');
const { runCredentialAlerts } = require('./jobs/credentialAlerts');

const app = express();

// Behind Railway's proxy — trust the first hop so req.ip / rate limiting use
// the real client IP from X-Forwarded-For (and not the proxy address).
app.set('trust proxy', 1);

// Security headers. CSP is disabled (JSON API, no HTML) and cross-origin
// resource policy is relaxed so the SPA can fetch credential documents/images.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

// CORS allowlist comes from config/env (required in production).
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Broad rate-limit on all routes; the health check stays unthrottled.
app.use(globalLimiter);

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', app: 'SNAP Marketplace', db: 'connected' });
  } catch (err) {
    console.error('[health] DB check failed:', err.message);
    res.status(503).json({ status: 'degraded', app: 'SNAP Marketplace', db: 'disconnected', error: err.message });
  }
});

// Strict throttling on credential-bearing endpoints (login/register/reset).
app.use('/api/auth', authLimiter);
app.use([
  '/api/credentialing/auth/login',
  '/api/credentialing/auth/forgot-password',
  '/api/credentialing/auth/reset-password',
], authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/completions', completionRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
// SNAP Shifts
app.use('/api/roster', rosterRoutes);
app.use('/api/roster-availability', rosterAvailabilityRoutes);
app.use('/api/windows', windowRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/incentive', incentiveRoutes);
app.use('/api/staffiq', staffiqRoutes);
app.use('/api/data-upload', datauploadRoutes);
app.use('/api/calculator', calculatorRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/staffiq-inputs', staffiqInputsRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/admin/invoices', invoiceRoutes);
app.use('/api/hour-entry', hourEntryRoutes);
app.use('/api/feature-flags', featureFlagRoutes);
app.use('/api/pto-builder', ptoBuilderRoutes);
app.use('/api/credentialing', credentialingRoutes);
// Facility-coordinator invite + claim. Replaces /auth/facility/register
// per snap-applications/capa-pilot/facility-invite-spec.md (2026-06-09).
app.use('/api/facility-claim', require('./routes/facilityClaim'));
// Provider notification inbox (Task #16) + provider schedule requests (Task #21).
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/schedule-requests', require('./routes/scheduleRequests'));
// Snappy AI support assistant (Task #17).
app.use('/api/snappy', require('./routes/snappy'));
// Coverage Templates + holiday overrides (per-facility). See
// docs/coverage-templates-design.md.
app.use('/api/coverage-templates', coverageTemplatesRoutes);
app.use('/api/facilities', holidayRoutes); // mounts /:id/holidays/* under /api/facilities
// Cost-savings / time-saved tracking for the dashboard + credentialing
// portal widgets. See services/automationEvents.js.
app.use('/api/automation-events', automationEventsRoutes);
// Provider availability self-submission — public, token-gated (no auth middleware).
app.use('/api/avail', require('./routes/avail'));

// ── Scheduled jobs ────────────────────────────────────────────────────────────

cron.schedule('*/30 * * * *', async () => {
  await runSurgePricing();
  await expireOldShifts();
  await openPreferredShifts();
  await notifySurgeExpiring();
});

cron.schedule('0 * * * *', async () => {
  await checkAllVipStatuses();
});

cron.schedule('0 */6 * * *', async () => {
  await checkExpiredIncentiveShifts();
});

// Daily at 6 AM — credential expiration alerts
cron.schedule('0 6 * * *', async () => {
  await runCredentialAlerts();
});

// Daily at 8 AM — auto-send monthly recurring invoices
cron.schedule('0 8 * * *', async () => {
  await processMonthlyInvoices();
});

// Daily at 5 AM — purge week-dead auth sessions (expired/revoked rows)
cron.schedule('0 5 * * *', async () => {
  try {
    await require('./services/authSessions').gcSessions();
  } catch (err) {
    console.error('[cron] session gc failed:', err.message);
  }
});

// ── 404 + error handling ──────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — returns generic messages so internals/stack traces
// are never leaked to clients. Full error is logged server-side.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  // Multer / upload validation errors carry a safe, user-facing message.
  if (err.message && (/allowed/i.test(err.message) || err.code === 'LIMIT_FILE_SIZE')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[error]', req.method, req.path, '-', err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// ── Seed admin ────────────────────────────────────────────────────────────────

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  // No insecure default — skip seeding if credentials are not configured.
  if (!email || !password) {
    console.warn('[seed] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed');
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { email, password: hashed, role: 'ADMIN' } });
    console.log('Admin user created:', email);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`SNAP Marketplace backend running on port ${PORT}`);
  await seedAdmin();
  await seedNetworkPriors(); // jump-start StaffIQ benchmark with published-norm priors
  await runSurgePricing();
  await checkAllVipStatuses();
});
