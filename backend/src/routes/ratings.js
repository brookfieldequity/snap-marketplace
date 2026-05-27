const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

// ── Facility rates provider ───────────────────────────────────────────────────

router.post('/provider/:bookingId', facilityAuth, async (req, res) => {
  try {
    const { stars, notes } = req.body;
    if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'Rating must be 1–5 stars' });

    const booking = await prisma.shiftBooking.findUnique({
      where: { id: req.params.bookingId },
      include: { shift: true },
    });
    if (!booking || booking.shift.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (!booking.completedAt) return res.status(400).json({ error: 'Shift not yet completed' });

    const rating = await prisma.providerRating.create({
      data: {
        facilityId: req.facility.id,
        providerId: booking.providerId,
        bookingId: booking.id,
        stars: parseInt(stars),
        notes,
      },
    });

    // VIP point for high rating
    if (parseInt(stars) >= 4) {
      await prisma.providerProfile.update({
        where: { id: booking.providerId },
        data: { vipPoints: { increment: 5 } },
      });
      await prisma.vIPPointsLog.create({
        data: { providerId: booking.providerId, points: 5, reason: 'HIGH_RATING' },
      });
    }

    res.status(201).json(rating);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// ── Provider rates facility ───────────────────────────────────────────────────

router.post('/facility/:bookingId', auth, async (req, res) => {
  try {
    const { stars, notes } = req.body;
    if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'Rating must be 1–5 stars' });

    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    const booking = await prisma.shiftBooking.findUnique({
      where: { id: req.params.bookingId },
      include: { shift: true },
    });
    if (!booking || booking.providerId !== provider.id) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (!booking.completedAt) return res.status(400).json({ error: 'Shift not yet completed' });

    const rating = await prisma.facilityRating.create({
      data: {
        providerId: provider.id,
        facilityId: booking.shift.facilityId,
        bookingId: booking.id,
        stars: parseInt(stars),
        notes,
      },
    });
    res.status(201).json(rating);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

module.exports = router;
