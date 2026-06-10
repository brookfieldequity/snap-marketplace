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

const VALID_TYPES = ['DAY_OFF', 'WORK'];

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

    const { facilityId, type, date, siteName, note } = req.body || {};
    if (!facilityId || !type || !date) {
      return res.status(400).json({ error: 'facilityId, type, and date are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
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
        date: new Date(date),
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

      // Accepted DAY_OFF → materialize a RosterTimeOff so the builder
      // auto-excludes this provider on that date (single-day range).
      if (decision === 'accept' && request.type === 'DAY_OFF') {
        await tx.rosterTimeOff.create({
          data: {
            facilityId: req.facility.id,
            rosterEntryId: request.rosterEntryId,
            startDate: request.date,
            endDate: request.date,
            reason: 'Approved day-off request',
          },
        });
      }
    });

    // Notify the provider their request was answered.
    if (request.rosterEntry?.linkedProviderId) {
      const dateStr = new Date(request.date).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      const verb = request.type === 'DAY_OFF' ? 'day off' : 'request to work';
      await recordNotification(request.rosterEntry.linkedProviderId, {
        type: 'REQUEST_ANSWERED',
        title: `Your ${verb} on ${dateStr} was ${newStatus === 'ACCEPTED' ? 'approved' : 'declined'}`,
        body: `${req.facility.name} ${newStatus === 'ACCEPTED' ? 'approved' : 'declined'} your ${verb} request for ${dateStr}.`,
        data: { scheduleRequestId: request.id, status: newStatus, date: request.date },
      });
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[schedule-requests] decide failed:', err);
    res.status(500).json({ error: 'Failed to decide request' });
  }
});

module.exports = router;
