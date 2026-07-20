const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const { aggregateProviderRatings, deriveProviderBadges } = require('../services/trust');
const { deleteProviderAccount } = require('../services/accountDeletion');
const bcrypt = require('bcryptjs');

const router = express.Router();

const VIP_THRESHOLD = 100;

const VIP_REASON_LABELS = {
  DAILY_LOGIN: 'Daily login',
  CALENDAR_UPDATED: 'Updated availability',
  SHIFT_ACCEPTED: 'Accepted a shift',
  SHIFT_COMPLETED: 'Completed a shift',
  HIGH_RATING: 'Received a 4★+ rating',
};

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
    const ratingMap = await aggregateProviderRatings([profile.id]);
    res.json({
      ...profile,
      rating: ratingMap.get(profile.id) || { avg: null, count: 0 },
      badges: deriveProviderBadges(profile, { completedShifts: profile._count?.bookings }),
    });
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
    if (!profile) return res.json([]); // no provider profile yet → nothing to show
    const start = new Date(year || new Date().getFullYear(), (month || new Date().getMonth()) - 1, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 2, 0);

    const availability = await prisma.providerAvailability.findMany({
      where: { providerId: profile.id, date: { gte: start, lte: end } },
    });
    res.json(availability);
  } catch (err) {
    console.error('[availability] load failed:', err);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// ── Set availability ──────────────────────────────────────────────────────────

router.post('/me/availability', auth, async (req, res) => {
  try {
    const { dates = [], clearDates = [] } = req.body;
    // dates:       [{ date: "2026-06-01", available: true, note: "after 10am" }, ...]
    // clearDates:  ["2026-06-02", ...]  — dates the provider cycled back to neutral
    // `note` (Task #20) is optional free text attached to that specific date,
    // surfaced to the coordinator in the schedule-builder day editor.
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      return res.status(400).json({ error: 'No provider profile found — complete your profile before setting availability.' });
    }

    // Only upsert entries with a real boolean `available` (the column is required;
    // a malformed entry would otherwise fail the whole transaction).
    const ops = dates
      .filter((d) => d && d.date && typeof d.available === 'boolean')
      .map(({ date, available, note }) =>
        prisma.providerAvailability.upsert({
          where: { providerId_date: { providerId: profile.id, date: new Date(date) } },
          create: { providerId: profile.id, date: new Date(date), available, note: note ?? null },
          update: { available, ...(note !== undefined ? { note: note || null } : {}) },
        })
      );
    if (clearDates.length > 0) {
      ops.push(
        prisma.providerAvailability.deleteMany({
          where: {
            providerId: profile.id,
            date: { in: clearDates.map((d) => new Date(d)) },
          },
        })
      );
    }
    const results = ops.length > 0 ? await prisma.$transaction(ops) : [];

    // VIP points are a non-critical side effect — never let them fail the save.
    try {
      await prisma.providerProfile.update({
        where: { id: profile.id },
        data: { vipPoints: { increment: 1 } },
      });
      await prisma.vIPPointsLog.create({
        data: { providerId: profile.id, points: 1, reason: 'CALENDAR_UPDATED' },
      });
      await checkVipStatus(profile.id);
    } catch (vipErr) {
      console.error('[availability] VIP side-effect failed (availability still saved):', vipErr.message);
    }

    res.json(results);
  } catch (err) {
    console.error('[availability] save failed:', err);
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
      select: { id: true, vipPoints: true, vipStatus: true, vipEarnedAt: true },
    });
    const logEntries = await prisma.vIPPointsLog.findMany({
      where: { providerId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      vipPoints: profile.vipPoints,
      vipStatus: profile.vipStatus,
      vipEarnedAt: profile.vipEarnedAt,
      threshold: VIP_THRESHOLD,
      pointsToVip: Math.max(0, VIP_THRESHOLD - profile.vipPoints),
      vipLog: logEntries.map((entry) => ({
        reason: entry.reason,
        description: VIP_REASON_LABELS[entry.reason] || entry.reason,
        points: entry.points,
        date: entry.createdAt,
      })),
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

/**
 * DELETE /me — permanent provider account deletion (App Store 5.1.1(v)).
 * Requires the literal confirmation string; password re-verified when the
 * account has one (Apple/Google-only accounts don't).
 */
router.delete('/me', auth, async (req, res) => {
  try {
    const { confirmation, password } = req.body || {};
    if (confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm account deletion.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.password) {
      const ok = password ? await bcrypt.compare(password, user.password) : false;
      if (!ok) return res.status(401).json({ error: 'Password is incorrect.' });
    }
    const result = await deleteProviderAccount(user.id);
    if (!result.deleted) return res.status(400).json({ error: 'This account type cannot be deleted from the app.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[providers] account deletion failed:', err);
    res.status(500).json({ error: 'Account deletion failed. Please contact support@snapmedical.app.' });
  }
});

module.exports = router;
