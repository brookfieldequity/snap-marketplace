const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

const VIP_THRESHOLD = 100;

function calcProfilePct(p) {
  const fields = [p.firstName, p.lastName, p.specialty, p.yearsExperience, p.city, p.photoUrl, p.maLicenseNumber, p.personalStatement];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

// ── Get my profile ────────────────────────────────────────────────────────────

router.get('/me', auth, async (req, res) => {
  try {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
      include: {
        vipLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { bookings: true } },
      },
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── Update my profile ─────────────────────────────────────────────────────────

router.patch('/me', auth, async (req, res) => {
  try {
    const allowed = [
      'firstName', 'lastName', 'specialty', 'additionalSpecialties',
      'yearsExperience', 'city', 'lat', 'lng', 'photoUrl',
      'personalStatement', 'equipmentPreferences', 'caseMixExperience',
      'maLicenseNumber', 'maLicenseExpiry', 'notifPreference', 'notifSurge',
      'expoPushToken',
    ];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const profile = await prisma.providerProfile.update({
      where: { userId: req.user.userId },
      data: {
        ...updates,
        maLicenseExpiry: updates.maLicenseExpiry ? new Date(updates.maLicenseExpiry) : undefined,
        profileCompletePct: undefined,
      },
    });

    const pct = calcProfilePct(profile);
    const updated = await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { profileCompletePct: pct },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── Get availability ──────────────────────────────────────────────────────────

router.get('/me/availability', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    const start = new Date(year || new Date().getFullYear(), (month || new Date().getMonth()) - 1, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 2, 0);

    const availability = await prisma.providerAvailability.findMany({
      where: { providerId: profile.id, date: { gte: start, lte: end } },
    });
    res.json(availability);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// ── Set availability ──────────────────────────────────────────────────────────

router.post('/me/availability', auth, async (req, res) => {
  try {
    const { dates } = req.body; // [{ date: "2026-06-01", available: true }, ...]
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });

    const ops = dates.map(({ date, available }) =>
      prisma.providerAvailability.upsert({
        where: { providerId_date: { providerId: profile.id, date: new Date(date) } },
        create: { providerId: profile.id, date: new Date(date), available },
        update: { available },
      })
    );
    const results = await prisma.$transaction(ops);

    // VIP point for keeping calendar updated
    await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { vipPoints: { increment: 1 } },
    });
    await prisma.vIPPointsLog.create({
      data: { providerId: profile.id, points: 1, reason: 'CALENDAR_UPDATED' },
    });

    await checkVipStatus(profile.id);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

// ── My bookings / earnings ────────────────────────────────────────────────────

router.get('/me/earnings', auth, async (req, res) => {
  try {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    const bookings = await prisma.shiftBooking.findMany({
      where: { providerId: profile.id },
      include: {
        shift: { include: { facility: { select: { name: true, zipCode: true } } } },
        completion: true,
      },
      orderBy: { confirmedAt: 'desc' },
    });

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalEarnedAllTime = 0;
    let totalEarnedThisMonth = 0;

    const enriched = bookings.map((b) => {
      const earned = b.totalShiftValue || 0;
      const isCompleted = b.completedAt != null;
      if (isCompleted) {
        totalEarnedAllTime += earned;
        if (new Date(b.completedAt) >= thisMonthStart) totalEarnedThisMonth += earned;
      }
      return {
        ...b,
        paymentStatusLabel:
          b.paymentStatus === 'PAID' ? 'Paid'
          : b.completion?.facilityConfirmed ? 'Payment Processing'
          : b.completion?.providerConfirmed ? 'Awaiting Facility Confirmation'
          : 'Pending Confirmation',
      };
    });

    res.json({
      bookings: enriched,
      summary: { totalEarnedAllTime, totalEarnedThisMonth },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load earnings' });
  }
});

// ── VIP status ────────────────────────────────────────────────────────────────

router.get('/me/vip', auth, async (req, res) => {
  try {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { vipPoints: true, vipStatus: true, vipEarnedAt: true },
    });
    res.json({
      ...profile,
      threshold: VIP_THRESHOLD,
      pointsToVip: Math.max(0, VIP_THRESHOLD - profile.vipPoints),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load VIP status' });
  }
});

// Active availability windows for provider
router.get('/me/active-windows', auth, async (req, res) => {
  try {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) return res.json([]);
    // Find facilities where this provider is on the internal roster
    const rosterEntries = await prisma.internalRosterEntry.findMany({
      where: { linkedProviderId: profile.id },
      select: { facilityId: true },
    });
    const facilityIds = rosterEntries.map((r) => r.facilityId);
    if (facilityIds.length === 0) return res.json([]);
    const now = new Date();
    const windows = await prisma.availabilityWindow.findMany({
      where: {
        facilityId: { in: facilityIds },
        status: 'ACTIVE',
        closeDate: { gt: now },
      },
      include: { facility: { select: { name: true } } },
      orderBy: { closeDate: 'asc' },
    });
    res.json(windows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load windows' });
  }
});

async function checkVipStatus(profileId) {
  const profile = await prisma.providerProfile.findUnique({
    where: { id: profileId },
    select: { vipPoints: true, vipStatus: true },
  });
  if (!profile.vipStatus && profile.vipPoints >= VIP_THRESHOLD) {
    await prisma.providerProfile.update({
      where: { id: profileId },
      data: { vipStatus: true, vipEarnedAt: new Date() },
    });
  }
}

module.exports = router;
