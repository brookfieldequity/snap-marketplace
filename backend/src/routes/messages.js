const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

// Detect contact info in messages (flag but don't block)
const CONTACT_PATTERN = /(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

// ── Send message (provider → facility, shift context) ─────────────────────────

router.post('/', auth, async (req, res) => {
  try {
    const { shiftId, body } = req.body;
    if (!shiftId || !body?.trim()) return res.status(400).json({ error: 'shiftId and body required' });

    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!provider) return res.status(400).json({ error: 'Provider profile not found' });

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const flagged = CONTACT_PATTERN.test(body);

    const message = await prisma.message.create({
      data: {
        shiftId,
        facilityId: shift.facilityId,
        senderId: provider.id,
        body: body.trim(),
        flagged,
      },
    });

    res.status(201).json({ ...message, flaggedWarning: flagged ? 'Message flagged for review — contact information sharing is not permitted on platform.' : null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── Get messages for a shift ──────────────────────────────────────────────────

router.get('/shift/:shiftId', auth, async (req, res) => {
  try {
    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!provider) return res.status(403).json({ error: 'Not authorized' });

    const hasAccess = await prisma.shiftBooking.findFirst({
      where: { shiftId: req.params.shiftId, providerId: provider.id },
    }) || await prisma.shiftApplication.findFirst({
      where: { shiftId: req.params.shiftId, providerId: provider.id },
    });
    if (!hasAccess) return res.status(403).json({ error: 'Not authorized' });

    const messages = await prisma.message.findMany({
      where: { shiftId: req.params.shiftId },
      include: {
        sender: { select: { firstName: true, lastName: true, photoUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ── Get messages for facility's shifts ───────────────────────────────────────

router.get('/facility', facilityAuth, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { facilityId: req.facility.id },
      include: {
        sender: { select: { firstName: true, lastName: true, photoUrl: true } },
        shift: { select: { id: true, date: true, specialty: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

module.exports = router;
