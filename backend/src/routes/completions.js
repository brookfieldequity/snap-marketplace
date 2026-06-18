const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');
const { notifyCompletionConfirmed, notifyDispute } = require('../services/notifications');
const { accrueBookingFee } = require('../services/marketplaceFees');

const router = express.Router();

// ── Provider confirms completion ──────────────────────────────────────────────

router.post('/:bookingId/provider-confirm', auth, async (req, res) => {
  try {
    const { hoursWorked, notes } = req.body;
    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    const booking = await prisma.shiftBooking.findUnique({
      where: { id: req.params.bookingId },
      include: { shift: true, completion: true },
    });
    if (!booking || booking.providerId !== provider.id) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    let completion = booking.completion;
    if (!completion) {
      completion = await prisma.shiftCompletion.create({
        data: {
          shiftId: booking.shiftId,
          bookingId: booking.id,
          providerId: provider.id,
        },
      });
    }

    const updated = await prisma.shiftCompletion.update({
      where: { id: completion.id },
      data: {
        providerConfirmed: true,
        providerHours: parseFloat(hoursWorked),
        providerNotes: notes,
        providerConfirmedAt: new Date(),
      },
    });

    await checkAndFinalizeCompletion(updated.id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm completion' });
  }
});

// ── Facility confirms completion ──────────────────────────────────────────────

router.post('/:bookingId/facility-confirm', facilityAuth, async (req, res) => {
  try {
    const { hoursWorked, notes } = req.body;
    const booking = await prisma.shiftBooking.findUnique({
      where: { id: req.params.bookingId },
      include: { shift: true, completion: true },
    });
    if (!booking || booking.shift.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    let completion = booking.completion;
    if (!completion) {
      completion = await prisma.shiftCompletion.create({
        data: {
          shiftId: booking.shiftId,
          bookingId: booking.id,
          providerId: booking.providerId,
        },
      });
    }

    const updated = await prisma.shiftCompletion.update({
      where: { id: completion.id },
      data: {
        facilityConfirmed: true,
        facilityHours: parseFloat(hoursWorked),
        facilityNotes: notes,
        facilityConfirmedAt: new Date(),
      },
    });

    await checkAndFinalizeCompletion(updated.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm completion' });
  }
});

async function checkAndFinalizeCompletion(completionId) {
  const completion = await prisma.shiftCompletion.findUnique({
    where: { id: completionId },
    include: { booking: { include: { shift: true } } },
  });
  if (!completion.providerConfirmed || !completion.facilityConfirmed) return;

  const hoursDiff = Math.abs((completion.providerHours || 0) - (completion.facilityHours || 0));
  if (hoursDiff > 0.5) {
    await prisma.shiftCompletion.update({
      where: { id: completionId },
      data: { disputed: true },
    });
    await prisma.shift.update({ where: { id: completion.booking.shiftId }, data: { status: 'DISPUTED' } });
    notifyDispute(completionId).catch((err) => console.error('notifyDispute:', err.message));
    return;
  }

  // Both confirmed, no dispute — mark complete
  const finalHours = completion.facilityHours || completion.providerHours;
  const rate = completion.booking.shift.currentRate;
  const total = rate * finalHours;
  const fee = total * ((completion.booking.platformFeePercent || 10) / 100);

  await prisma.$transaction([
    prisma.shiftBooking.update({
      where: { id: completion.bookingId },
      data: {
        completedAt: new Date(),
        totalShiftValue: total,
        platformFeeAmount: fee,
        paymentStatus: 'PROCESSING',
      },
    }),
    prisma.shift.update({
      where: { id: completion.shiftId },
      data: { status: 'COMPLETED', platformFeeAmount: fee },
    }),
    // VIP point for provider
    prisma.providerProfile.update({
      where: { id: completion.providerId },
      data: { vipPoints: { increment: 10 } },
    }),
    prisma.vIPPointsLog.create({
      data: { providerId: completion.providerId, points: 10, reason: 'SHIFT_COMPLETED' },
    }),
  ]);

  // Position 1: accrue SNAP's 5% platform fee (ledger only — no charge yet),
  // gated by the facility's transaction_fees flag. Non-fatal if it fails.
  accrueBookingFee(completion.bookingId).catch((err) => console.error('accrueBookingFee:', err.message));

  notifyCompletionConfirmed(completionId).catch((err) => console.error('notifyCompletionConfirmed:', err.message));
}

module.exports = router;
