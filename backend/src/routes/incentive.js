const express = require('express');
const { Expo } = require('expo-server-sdk');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const auth = require('../middleware/auth');
const { sendSMS } = require('../services/notifications');

const router = express.Router();
const expo = new Expo();

// ── Push helper ───────────────────────────────────────────────────────────────

async function sendPush(tokens, title, body, data = {}) {
  if (!tokens || !tokens.length) return;
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (!valid.length) return;
  const chunks = expo.chunkPushNotifications(
    valid.map((to) => ({ to, sound: 'default', title, body, data }))
  );
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error('Push send error:', err.message);
    }
  }
}

// ── Facility endpoints (facilityAuth) ─────────────────────────────────────────

// GET / — list all incentive shifts for facility with response counts
router.get('/', facilityAuth, async (req, res) => {
  try {
    const { status } = req.query;

    const where = { facilityId: req.facility.id };
    if (status) where.status = status;

    const shifts = await prisma.internalIncentiveShift.findMany({
      where,
      include: {
        _count: { select: { responses: true } },
      },
      orderBy: { shiftDate: 'asc' },
    });

    res.json(shifts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load incentive shifts' });
  }
});

// POST / — create incentive shift, then fire-and-forget push notifications
router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      shiftDate,
      startTime,
      durationHours,
      facilityLocation,
      incentiveRate,
      providerTypeRequired,
      responseDeadline,
    } = req.body;

    if (
      !shiftDate || !startTime || !durationHours || !facilityLocation ||
      !incentiveRate || !providerTypeRequired || !responseDeadline
    ) {
      return res.status(400).json({
        error: 'shiftDate, startTime, durationHours, facilityLocation, incentiveRate, providerTypeRequired, and responseDeadline are required',
      });
    }

    const shift = await prisma.internalIncentiveShift.create({
      data: {
        facilityId: req.facility.id,
        shiftDate: new Date(shiftDate),
        startTime,
        durationHours: parseFloat(durationHours),
        facilityLocation,
        incentiveRate: parseFloat(incentiveRate),
        providerTypeRequired,
        responseDeadline: new Date(responseDeadline),
      },
    });

    // Fire-and-forget: push to matching roster members who are linked
    const facilityName = req.facility.name;
    const dateStr = new Date(shiftDate).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

    setImmediate(async () => {
      try {
        const rosterEntries = await prisma.internalRosterEntry.findMany({
          where: { facilityId: req.facility.id, providerType: providerTypeRequired },
          select: { linkedProviderId: true, phoneNumber: true },
        });

        const pushMsg = `${facilityName} has a shift available on ${dateStr} at ${facilityLocation} for ${durationHours} hours. Incentive rate: $${parseFloat(incentiveRate).toFixed(0)}/hour. Tap here to respond.`;
        const smsMsg = `${facilityName} — Incentive Shift: ${dateStr} at ${facilityLocation}, ${durationHours}h @ $${parseFloat(incentiveRate).toFixed(0)}/hr. Open your SNAP app to respond.`;

        // Push to linked SNAP providers
        const providerIds = rosterEntries.map((e) => e.linkedProviderId).filter(Boolean);
        if (providerIds.length > 0) {
          const profiles = await prisma.providerProfile.findMany({
            where: { id: { in: providerIds }, expoPushToken: { not: null } },
            select: { expoPushToken: true },
          });
          const tokens = profiles.map((p) => p.expoPushToken).filter(Boolean);
          await sendPush(tokens, `${facilityName} — Incentive Shift Available`, pushMsg, { shiftId: shift.id, type: 'INCENTIVE_SHIFT' });
        }

        // SMS to all matching roster members with phone numbers
        await Promise.all(rosterEntries.map((e) => sendSMS(e.phoneNumber, smsMsg)));
      } catch (err) {
        console.error('Incentive shift push/SMS error:', err.message);
      }
    });

    res.status(201).json(shift);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create incentive shift' });
  }
});

// GET /:id — single shift with responses (include rosterEntry.providerName)
router.get('/:id', facilityAuth, async (req, res) => {
  try {
    const shift = await prisma.internalIncentiveShift.findUnique({
      where: { id: req.params.id },
      include: {
        responses: {
          include: {
            rosterEntry: { select: { providerName: true } },
          },
        },
        _count: { select: { responses: true } },
      },
    });

    if (!shift || shift.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Incentive shift not found' });
    }

    res.json(shift);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load incentive shift' });
  }
});

// POST /:id/escalate — facility approves escalation to marketplace
router.post('/:id/escalate', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalIncentiveShift.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Incentive shift not found' });
    }

    const updated = await prisma.internalIncentiveShift.update({
      where: { id: req.params.id },
      data: {
        escalatedToMarketplace: true,
        escalationApprovedAt: new Date(),
        escalationApprovedBy: req.facility.id,
        status: 'ESCALATED',
      },
    });

    res.json({
      shift: updated,
      escalated: true,
      prefill: {
        specialty: updated.providerTypeRequired,
        date: updated.shiftDate,
        startTime: updated.startTime,
        durationHours: updated.durationHours,
        baseRate: updated.incentiveRate,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to escalate incentive shift' });
  }
});

// POST /:id/expire — mark shift EXPIRED
router.post('/:id/expire', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalIncentiveShift.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Incentive shift not found' });
    }

    const updated = await prisma.internalIncentiveShift.update({
      where: { id: req.params.id },
      data: { status: 'EXPIRED' },
    });

    res.json({
      shift: updated,
      message: 'Shift marked as expired. Facility admin will be notified that the shift is unfilled.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to expire incentive shift' });
  }
});

// ── Provider endpoints (auth) ─────────────────────────────────────────────────

// GET /provider/active — active OPEN incentive shifts for this provider's facilities
router.get('/provider/active', auth, async (req, res) => {
  try {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!provider) {
      return res.status(404).json({ error: 'Provider profile not found' });
    }

    // Find all roster entries for this provider (linked by linkedProviderId)
    const rosterEntries = await prisma.internalRosterEntry.findMany({
      where: { linkedProviderId: provider.id },
      select: { id: true, facilityId: true },
    });

    if (!rosterEntries.length) {
      return res.json([]);
    }

    const facilityIds = [...new Set(rosterEntries.map((e) => e.facilityId))];
    const rosterIds = rosterEntries.map((e) => e.id);
    const now = new Date();

    const shifts = await prisma.internalIncentiveShift.findMany({
      where: {
        facilityId: { in: facilityIds },
        status: 'OPEN',
        responseDeadline: { gt: now },
      },
      include: {
        responses: {
          where: { rosterId: { in: rosterIds } },
          select: { accepted: true, respondedAt: true },
        },
        _count: { select: { responses: true } },
      },
      orderBy: { responseDeadline: 'asc' },
    });

    const result = shifts.map((shift) => ({
      ...shift,
      myResponse: shift.responses[0] || null,
      hasResponded: shift.responses.length > 0,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load active incentive shifts' });
  }
});

// POST /:id/respond — provider responds to an incentive shift
router.post('/:id/respond', auth, async (req, res) => {
  try {
    const { accepted } = req.body;

    if (typeof accepted !== 'boolean') {
      return res.status(400).json({ error: 'accepted (boolean) is required' });
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!provider) {
      return res.status(404).json({ error: 'Provider profile not found' });
    }

    const shift = await prisma.internalIncentiveShift.findUnique({
      where: { id: req.params.id },
    });

    if (!shift) {
      return res.status(404).json({ error: 'Incentive shift not found' });
    }

    // Find the provider's roster entry for the facility that owns this shift
    const rosterEntry = await prisma.internalRosterEntry.findFirst({
      where: {
        facilityId: shift.facilityId,
        linkedProviderId: provider.id,
      },
    });

    if (!rosterEntry) {
      return res.status(403).json({
        error: 'You are not on the internal roster for this facility',
      });
    }

    // Upsert the response
    const response = await prisma.internalIncentiveShiftResponse.upsert({
      where: {
        shiftId_rosterId: { shiftId: shift.id, rosterId: rosterEntry.id },
      },
      create: {
        shiftId: shift.id,
        rosterId: rosterEntry.id,
        accepted,
        respondedAt: new Date(),
      },
      update: {
        accepted,
        respondedAt: new Date(),
      },
    });

    // If accepted and shift is OPEN, mark it FILLED
    let updatedShift = shift;
    if (accepted && shift.status === 'OPEN') {
      updatedShift = await prisma.internalIncentiveShift.update({
        where: { id: shift.id },
        data: { status: 'FILLED' },
      });
    } else {
      updatedShift = await prisma.internalIncentiveShift.findUnique({
        where: { id: shift.id },
      });
    }

    // Facility push notifications are not yet implemented (no facility push tokens)

    res.json({ response, shift: updatedShift });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

module.exports = router;
