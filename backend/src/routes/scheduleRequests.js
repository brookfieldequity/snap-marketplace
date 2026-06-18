// Provider schedule requests (Task #21).
//
// Provider side (auth.js — req.user):
//   POST   /schedule-requests          → create a DAY_OFF or WORK request
//   GET    /schedule-requests/mine      → my requests across facilities
//   DELETE /schedule-requests/:id       → cancel my own pending request
//
// Facility side (facilityAuth — req.facility):
//   GET    /schedule-requests          → this facility's requests (?status=)
//   POST   /schedule-requests/:id/decide → accept | decline
//
// Accepted requests become builder constraints:
//   - DAY_OFF accepted → also writes a RosterTimeOff row so the builder hard-
//     excludes the provider that date (auto-build already honors RosterTimeOff).
//   - WORK accepted → a strong preference the builder reads (see scheduleBuilder).

const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');
const { recordNotification } = require('../services/notifications');

const router = express.Router();

const VALID_TYPES = ['DAY_OFF', 'WORK', 'PTO'];
const DAY_MS = 24 * 60 * 60 * 1000;

const dateOnly = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00.000Z`);

async function resolveProfileId(req) {
  if (req.user?.profileId) return req.user.profileId;
  if (!req.user?.userId) return null;
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: req.user.userId },
    select: { id: true },
  });
  return profile?.id || null;
}

// Find the roster entry linking this provider to a facility. Requests are
// scoped to a roster membership so the builder can join on rosterId.
async function findRosterEntry(facilityId, providerId) {
  return prisma.internalRosterEntry.findFirst({
    where: { facilityId, linkedProviderId: providerId },
    select: { id: true, providerName: true, facility: { select: { name: true } } },
  });
}

// ── Provider: create a request ────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });

    const { facilityId, type, date, endDate, siteName, note } = req.body || {};
    if (!facilityId || !type || !date) {
      return res.status(400).json({ error: 'facilityId, type, and date are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    // endDate (optional) makes the request a span [date, endDate]. Used for PTO
    // (e.g. a Mon–Fri week) but allowed for any type. Must not precede date.
    let end = null;
    if (endDate) {
      end = dateOnly(endDate);
      if (end < dateOnly(date)) {
        return res.status(400).json({ error: 'endDate must be on or after date' });
      }
      if ((end - dateOnly(date)) / DAY_MS > 366) {
        return res.status(400).json({ error: 'Range too large (max 1 year)' });
      }
    }

    const roster = await findRosterEntry(facilityId, providerId);
    if (!roster) {
      return res.status(403).json({ error: 'You are not on this facility roster' });
    }

    const request = await prisma.scheduleRequest.create({
      data: {
        facilityId,
        rosterEntryId: roster.id,
        type,
        date: dateOnly(date),
        endDate: end,
        siteName: siteName || null,
        note: note || null,
      },
    });
    res.status(201).json(request);
  } catch (err) {
    console.error('[schedule-requests] create failed:', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// ── Provider: my requests ─────────────────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.json({ requests: [] });
    const requests = await prisma.scheduleRequest.findMany({
      where: { rosterEntry: { linkedProviderId: providerId } },
      orderBy: { date: 'desc' },
      include: { facility: { select: { name: true } } },
    });
    res.json({ requests });
  } catch (err) {
    console.error('[schedule-requests] mine failed:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// ── Provider: cancel own pending request ──────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });
    const result = await prisma.scheduleRequest.deleteMany({
      where: {
        id: req.params.id,
        status: 'PENDING',
        rosterEntry: { linkedProviderId: providerId },
      },
    });
    res.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error('[schedule-requests] cancel failed:', err);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

// ── Facility: list requests ───────────────────────────────────────────────────
router.get('/', facilityAuth, async (req, res) => {
  try {
    const status = req.query.status; // optional PENDING | ACCEPTED | DECLINED
    const requests = await prisma.scheduleRequest.findMany({
      where: { facilityId: req.facility.id, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { date: 'asc' }],
      include: { rosterEntry: { select: { providerName: true, providerType: true } } },
    });
    res.json({ requests });
  } catch (err) {
    console.error('[schedule-requests] facility list failed:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// ── Facility: decide (accept | decline) ───────────────────────────────────────
router.post('/:id/decide', facilityAuth, async (req, res) => {
  try {
    const { decision } = req.body || {}; // "accept" | "decline"
    if (!['accept', 'decline'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "accept" or "decline"' });
    }

    const request = await prisma.scheduleRequest.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      include: {
        rosterEntry: { select: { id: true, linkedProviderId: true, providerName: true } },
      },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: `Request already ${request.status.toLowerCase()}` });
    }

    const newStatus = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';

    await prisma.$transaction(async (tx) => {
      await tx.scheduleRequest.update({
        where: { id: request.id },
        data: {
          status: newStatus,
          decidedAt: new Date(),
          decidedBy: req.user?.userId || null,
        },
      });

      if (decision === 'accept') {
        const spanEnd = request.endDate || request.date;
        if (request.type === 'DAY_OFF') {
          // Materialize a RosterTimeOff so the builder auto-excludes this
          // provider across the requested span.
          await tx.rosterTimeOff.create({
            data: {
              facilityId: req.facility.id,
              rosterEntryId: request.rosterEntryId,
              startDate: request.date,
              endDate: spanEnd,
              reason: 'Approved day-off request',
            },
          });
        } else if (request.type === 'PTO') {
          // Write source='PTO' RosterAvailability rows across the span so it
          // shows on the calendar, counts toward the PTO allotment, and the
          // schedule builder treats those days as unavailable (via resolver).
          for (let d = new Date(request.date); d <= spanEnd; d = new Date(d.getTime() + DAY_MS)) {
            const dateObj = new Date(d);
            await tx.rosterAvailability.upsert({
              where: { rosterEntryId_date: { rosterEntryId: request.rosterEntryId, date: dateObj } },
              create: {
                rosterEntryId: request.rosterEntryId,
                facilityId: req.facility.id,
                date: dateObj,
                available: false,
                source: 'PTO',
                note: 'Approved PTO request',
              },
              update: { available: false, source: 'PTO', note: 'Approved PTO request' },
            });
          }
        }
      }
    });

    // Notify the provider their request was answered.
    if (request.rosterEntry?.linkedProviderId) {
      const fmt = (d) => new Date(d).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const dateStr = request.endDate && request.endDate > request.date
        ? `${fmt(request.date)} – ${fmt(request.endDate)}`
        : fmt(request.date);
      const verb = request.type === 'DAY_OFF' ? 'day off'
        : request.type === 'PTO' ? 'PTO'
        : 'request to work';
      const past = newStatus === 'ACCEPTED' ? 'approved' : 'declined';
      await recordNotification(request.rosterEntry.linkedProviderId, {
        type: 'REQUEST_ANSWERED',
        title: `Your ${verb} for ${dateStr} was ${past}`,
        body: `${req.facility.name} ${past} your ${verb} request for ${dateStr}.`,
        data: { scheduleRequestId: request.id, status: newStatus, date: request.date, endDate: request.endDate },
      });
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[schedule-requests] decide failed:', err);
    res.status(500).json({ error: 'Failed to decide request' });
  }
});

module.exports = router;
