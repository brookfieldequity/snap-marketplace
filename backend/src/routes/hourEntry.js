// Provider worked-hours entry — coordinator routes (Stage 1).
// facilityAuth + payroll_builder flag, same audience as the Payroll Builder.
// Provider self-service routes are Stage 2 (separate auth).

const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { requireFlag } = require('../config/featureFlags');
const { seedHourEntries, getEntries, hoursFromWindow } = require('../services/hourEntry');

const router = express.Router();
router.use(facilityAuth);
router.use(requireFlag('payroll_builder'));

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
