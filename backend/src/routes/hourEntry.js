// Provider worked-hours entry — coordinator routes (Stage 1).
// facilityAuth + payroll_builder flag, same audience as the Payroll Builder.
// Provider self-service routes are Stage 2 (separate auth).

const express = require('express');
const multer = require('multer');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { requireFlag } = require('../config/featureFlags');
const { seedHourEntries, getEntries, hoursFromWindow, importApnePayrollSheet } = require('../services/hourEntry');

const router = express.Router();
router.use(facilityAuth);
router.use(requireFlag('payroll_builder'));

const payrollUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .csv, .xlsx, or .xls files are accepted.'), ok);
  },
});

// POST /import-payroll-sheet — ingest an APNE Gusto-format 1099 payroll sheet for
// a pay period: seed/match roster cards, record CAPA hours + bonus + reimbursement.
// Multipart: file + periodStart + periodEnd.
router.post('/import-payroll-sheet', payrollUpload.single('file'), async (req, res) => {
  const { periodStart, periodEnd } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required.' });
  try {
    const result = await importApnePayrollSheet({
      facilityId: req.facility.id,
      buffer: req.file.buffer,
      periodStart,
      periodEnd,
    });
    // Surface missing money columns loudly — a renamed header otherwise
    // silently imports zeros and only shows up as short payroll/invoices.
    const warn = result.columnsMissing?.length
      ? ` ⚠ Columns not found in the sheet: ${result.columnsMissing.join(', ')} — those values were imported as 0.`
      : '';
    // Echo what was actually read so formatting problems are visible NOW.
    const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const totals = result.sheetTotals
      ? ` Read from tab "${result.sheetName || '?'}": ${result.sheetTotals.hours} hrs · ${money(result.sheetTotals.reimbursement)} reimbursement · ${money(result.sheetTotals.bonus)} bonus.`
      : '';
    // Seeding brand-new roster cards during a RE-import usually means name
    // matching failed (or the wrong tab was parsed) — new cards have no all-in
    // rate, so their hours silently vanish from the agency invoice.
    const seedWarn = result.seeded > 0
      ? ` ⚠ ${result.seeded} NEW roster card(s) were created — if these providers already exist, check Internal Roster for duplicates (new cards have no all-in rate and won't bill on the agency invoice).`
      : '';
    res.json({ ...result, message: `Imported ${result.rows} rows — ${result.seeded} new providers, ${result.matched} matched.${totals}${seedWarn}${warn}` });
  } catch (err) {
    console.error('[hour-entry/import-payroll-sheet]', err.message);
    res.status(500).json({ error: err.message || 'Failed to import payroll sheet' });
  }
});

// ── Site default hours ─────────────────────────────────────────────────────────
// Per-location default shift window used to pre-fill provider one-tap hours
// entry (and available to the coordinator surface). No DB unique on
// (facilityId, location) — deduped here via findFirst (Railway db-push gotcha).

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

// GET /site-defaults — the facility's defaults + discoverable location names
// (coverage templates ∪ recent ScheduleDay rows ∪ locations already defaulted).
router.get('/site-defaults', async (req, res) => {
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [defaults, tmplDays, schedDays] = await Promise.all([
      prisma.siteHourDefault.findMany({ where: { facilityId: req.facility.id }, orderBy: { location: 'asc' } }),
      prisma.coverageTemplateDay.findMany({
        where: { template: { facilityId: req.facility.id } },
        select: { location: true },
        distinct: ['location'],
      }),
      prisma.scheduleDay.findMany({
        where: { facilityId: req.facility.id, date: { gte: since } },
        select: { location: true },
        distinct: ['location'],
      }),
    ]);
    const set = new Set();
    tmplDays.forEach((r) => r.location && set.add(r.location.trim()));
    schedDays.forEach((r) => r.location && set.add(r.location.trim()));
    defaults.forEach((d) => set.add(d.location));
    res.json({
      defaults: defaults.map((d) => ({ id: d.id, location: d.location, startTime: d.startTime, endTime: d.endTime })),
      locations: [...set].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    console.error('[hour-entry/site-defaults]', err.message);
    res.status(500).json({ error: 'Failed to load site defaults' });
  }
});

// PUT /site-defaults { location, startTime, endTime } — upsert by (facility, location).
router.put('/site-defaults', async (req, res) => {
  const { location, startTime, endTime } = req.body || {};
  const loc = String(location || '').trim();
  if (!loc) return res.status(400).json({ error: 'location is required' });
  if (!HHMM.test(startTime || '') || !HHMM.test(endTime || '')) {
    return res.status(400).json({ error: 'startTime and endTime must be "HH:MM" 24h' });
  }
  try {
    const existing = await prisma.siteHourDefault.findFirst({
      where: { facilityId: req.facility.id, location: loc },
      select: { id: true },
    });
    const row = existing
      ? await prisma.siteHourDefault.update({ where: { id: existing.id }, data: { startTime, endTime } })
      : await prisma.siteHourDefault.create({ data: { facilityId: req.facility.id, location: loc, startTime, endTime } });
    res.json({ id: row.id, location: row.location, startTime: row.startTime, endTime: row.endTime });
  } catch (err) {
    console.error('[hour-entry/site-defaults/put]', err.message);
    res.status(500).json({ error: 'Failed to save site default' });
  }
});

// DELETE /site-defaults/:id
router.delete('/site-defaults/:id', async (req, res) => {
  try {
    const existing = await prisma.siteHourDefault.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Site default not found' });
    await prisma.siteHourDefault.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    console.error('[hour-entry/site-defaults/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete site default' });
  }
});

// GET /?periodStart&periodEnd — entries for the period, grouped by 1099 provider.
router.get('/', async (req, res) => {
  const { periodStart, periodEnd } = req.query;
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  try {
    res.json(await getEntries({ facilityId: req.facility.id, periodStart, periodEnd }));
  } catch (err) {
    console.error('[hour-entry/list]', err.message);
    res.status(500).json({ error: 'Failed to load hour entries' });
  }
});

// POST /seed { periodStart, periodEnd } — seed DRAFT entries from the schedule,
// then return the refreshed list.
router.post('/seed', async (req, res) => {
  const { periodStart, periodEnd } = req.body || {};
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  try {
    const result = await seedHourEntries({ facilityId: req.facility.id, periodStart, periodEnd });
    const list = await getEntries({ facilityId: req.facility.id, periodStart, periodEnd });
    res.json({ ...result, ...list });
  } catch (err) {
    console.error('[hour-entry/seed]', err.message);
    res.status(500).json({ error: 'Failed to seed hour entries' });
  }
});

// POST / — manual add. { rosterEntryId, date, location?, startTime?, endTime?, hours? }
router.post('/', async (req, res) => {
  const { rosterEntryId, date, location, startTime, endTime, hours } = req.body || {};
  if (!rosterEntryId || !date) return res.status(400).json({ error: 'rosterEntryId and date are required' });
  try {
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { id: rosterEntryId, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!entry) return res.status(404).json({ error: 'Provider not found' });
    const computed = hours != null ? Number(hours) : hoursFromWindow(startTime, endTime);
    const row = await prisma.providerHourEntry.create({
      data: {
        facilityId: req.facility.id, rosterEntryId, date: new Date(date),
        location: location || null, startTime: startTime || null, endTime: endTime || null,
        hours: computed, status: 'DRAFT', source: 'MANUAL', enteredBy: 'coordinator',
      },
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'An entry already exists for that provider, day, and location.' });
    console.error('[hour-entry/create]', err.message);
    res.status(500).json({ error: 'Failed to add hour entry' });
  }
});

// PATCH /:id — edit window/hours/location/status. Recomputes hours from the
// window when start/end change and an explicit hours wasn't supplied.
router.patch('/:id', async (req, res) => {
  const { startTime, endTime, hours, location, status } = req.body || {};
  try {
    const existing = await prisma.providerHourEntry.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    if (status !== undefined && !['DRAFT', 'SUBMITTED'].includes(status)) {
      return res.status(400).json({ error: 'status must be DRAFT or SUBMITTED' });
    }
    const data = {};
    if (location !== undefined) data.location = location || null;
    if (startTime !== undefined) data.startTime = startTime || null;
    if (endTime !== undefined) data.endTime = endTime || null;
    if (status !== undefined) data.status = status;
    if (hours != null) {
      data.hours = Number(hours);
    } else if (startTime !== undefined || endTime !== undefined) {
      data.hours = hoursFromWindow(startTime ?? existing.startTime, endTime ?? existing.endTime);
    }
    const row = await prisma.providerHourEntry.update({ where: { id: existing.id }, data });
    res.json(row);
  } catch (err) {
    console.error('[hour-entry/update]', err.message);
    res.status(500).json({ error: 'Failed to update hour entry' });
  }
});

// POST /submit { periodStart, periodEnd, rosterEntryId? } — mark DRAFT → SUBMITTED
// for the period (optionally one provider). The gate before payroll/invoicing.
router.post('/submit', async (req, res) => {
  const { periodStart, periodEnd, rosterEntryId } = req.body || {};
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  try {
    const start = new Date(periodStart);
    const end = new Date(new Date(periodEnd).getTime() + 86399999);
    const result = await prisma.providerHourEntry.updateMany({
      where: {
        facilityId: req.facility.id, status: 'DRAFT', date: { gte: start, lte: end },
        ...(rosterEntryId ? { rosterEntryId } : {}),
      },
      data: { status: 'SUBMITTED' },
    });
    const list = await getEntries({ facilityId: req.facility.id, periodStart, periodEnd });
    res.json({ submitted: result.count, ...list });
  } catch (err) {
    console.error('[hour-entry/submit]', err.message);
    res.status(500).json({ error: 'Failed to submit hours' });
  }
});

// POST /clear-period — delete ALL hour entries for the facility in a period.
// Undo for a bad import. Body: { periodStart, periodEnd }.
router.post('/clear-period', async (req, res) => {
  const { periodStart, periodEnd } = req.body || {};
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  try {
    const start = new Date(periodStart);
    const end = new Date(new Date(periodEnd).getTime() + 86399999);
    const result = await prisma.providerHourEntry.deleteMany({
      where: { facilityId: req.facility.id, date: { gte: start, lte: end } },
    });
    // A period clear is a full reset: also drop the Payroll Builder's saved
    // bonus/reimbursement drafts for this period, so a re-import seeds fresh
    // values instead of being overridden by stale edits.
    await prisma.payrollLineDraft.deleteMany({
      where: {
        facilityId: req.facility.id,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
      },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    console.error('[hour-entry/clear-period]', err.message);
    res.status(500).json({ error: 'Failed to clear hour entries' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.providerHourEntry.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    await prisma.providerHourEntry.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    console.error('[hour-entry/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete hour entry' });
  }
});

module.exports = router;
