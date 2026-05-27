require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const prisma = require('./config/db');

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
const windowRoutes = require('./routes/windows');
const scheduleRoutes = require('./routes/schedule');
const incentiveRoutes = require('./routes/incentive');
const staffiqRoutes = require('./routes/staffiq');
const datauploadRoutes = require('./routes/dataupload');
const calculatorRoutes = require('./routes/calculator');
const leadsRoutes = require('./routes/leads');
const staffiqInputsRoutes = require('./routes/staffiqInputs');

const { runSurgePricing, expireOldShifts, openPreferredShifts, notifySurgeExpiring } = require('./jobs/surge');
const { checkAllVipStatuses } = require('./jobs/vip');
const { checkExpiredIncentiveShifts } = require('./services/notifications');

const app = express();

// Allow origins listed in CORS_ORIGINS env var (comma-separated).
// Falls back to allow all origins when the variable is not set (local dev).
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : true;
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'SNAP Marketplace' }));

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
app.use('/api/windows', windowRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/incentive', incentiveRoutes);
app.use('/api/staffiq', staffiqRoutes);
app.use('/api/data-upload', datauploadRoutes);
app.use('/api/calculator', calculatorRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/staffiq-inputs', staffiqInputsRoutes);

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

// ── Seed admin ────────────────────────────────────────────────────────────────

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@snapmedical.com';
  const password = process.env.ADMIN_PASSWORD || 'SnapAdmin2024!';
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
  await runSurgePricing();
  await checkAllVipStatuses();
});
