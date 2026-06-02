const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

const AGENCY_RATES = { ANESTHESIOLOGIST: 425, CRNA: 300, ANESTHESIA_ASSISTANT: 250 };

const FACILITY_TYPE_LABELS = {
  HOSPITAL: 'Hospital',
  SURGERY_CENTER: 'Surgery Center',
  OUTPATIENT: 'Outpatient Clinic',
  DENTAL: 'Dental Office',
  OTHER: 'Other',
};

// ── List facility types (for filter UI) ───────────────────────────────────────
// Public — no auth needed; this is enum metadata + live counts.
router.get('/types', async (req, res) => {
  try {
    const grouped = await prisma.facility.groupBy({
      by: ['facilityType'],
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.facilityType, g._count._all]));
    const types = Object.keys(FACILITY_TYPE_LABELS).map((value) => ({
      value,
      label: FACILITY_TYPE_LABELS[value],
      count: counts.get(value) || 0,
    }));
    res.json({ types });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load facility types' });
  }
});

// ── Get my facility profile ───────────────────────────────────────────────────

router.get('/me', facilityAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      include: {
        subscription: true,
        _count: { select: { shifts: true } },
      },
    });
    res.json(facility);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load facility' });
  }
});

// ── Update facility profile ───────────────────────────────────────────────────

router.patch('/me', facilityAuth, async (req, res) => {
  try {
    const allowed = ['name', 'facilityType', 'address', 'zipCode', 'lat', 'lng', 'photoUrls', 'description', 'caseMix', 'parking', 'whatToBring'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const fields = ['name', 'facilityType', 'address', 'zipCode', 'photoUrls', 'description', 'caseMix', 'parking', 'whatToBring'];
    const filled = fields.filter((f) => updates[f] || req.facility[f]).length;
    const profileScore = Math.round((filled / fields.length) * 100);

    const facility = await prisma.facility.update({
      where: { id: req.facility.id },
      data: { ...updates, profileScore },
      include: { subscription: true },
    });
    res.json(facility);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update facility' });
  }
});

// ── Set snap mode ─────────────────────────────────────────────────────────────

router.patch('/me/mode', facilityAuth, async (req, res) => {
  try {
    const { snapMode } = req.body;
    const valid = ['MARKETPLACE', 'SHIFTS', 'BOTH'];
    if (!valid.includes(snapMode)) return res.status(400).json({ error: 'Invalid mode' });
    const facility = await prisma.facility.update({
      where: { id: req.facility.id },
      data: { snapMode },
    });
    res.json({ snapMode: facility.snapMode });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mode' });
  }
});

// ── Dashboard overview ────────────────────────────────────────────────────────

router.get('/me/dashboard', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [allShifts, upcoming, pendingApps, completedBookings, monthBookings, yearBookings] =
      await Promise.all([
        prisma.shift.findMany({ where: { facilityId }, select: { id: true, status: true } }),
        prisma.shift.findMany({
          where: { facilityId, date: { gte: now, lte: in7Days }, status: { in: ['LIVE', 'FILLED'] } },
          include: { booking: { include: { provider: { select: { firstName: true, lastName: true } } } } },
          orderBy: { date: 'asc' },
        }),
        prisma.shiftApplication.findMany({
          where: { shift: { facilityId }, status: 'PENDING' },
          include: {
            provider: { select: { id: true, firstName: true, lastName: true, specialty: true, credentialed: true, photoUrl: true } },
            shift: { select: { id: true, date: true, specialty: true } },
          },
        }),
        prisma.shiftBooking.findMany({
          where: { shift: { facilityId }, completedAt: { not: null } },
          include: { shift: { select: { specialty: true, durationHours: true } } },
        }),
        prisma.shiftBooking.findMany({
          where: { shift: { facilityId }, completedAt: { gte: thisMonthStart } },
          include: { shift: { select: { specialty: true, durationHours: true, currentRate: true } } },
        }),
        prisma.shiftBooking.findMany({
          where: { shift: { facilityId }, completedAt: { gte: yearStart } },
          include: { shift: { select: { specialty: true, durationHours: true, currentRate: true } } },
        }),
      ]);

    // Fill rate
    const total = allShifts.length;
    const filled = allShifts.filter((s) => ['FILLED', 'COMPLETED'].includes(s.status)).length;
    const fillRate = total > 0 ? Math.round((filled / total) * 100) : 0;

    // Cost savings
    function calcSavings(bookings) {
      let snapCost = 0, agencyCost = 0, hours = 0;
      bookings.forEach((b) => {
        const hrs = b.shift.durationHours || 0;
        const rate = b.shift.currentRate || 0;
        const specialty = b.shift.specialty;
        hours += hrs;
        snapCost += rate * hrs * 1.1; // including 10% platform fee
        agencyCost += (AGENCY_RATES[specialty] || 300) * hrs;
      });
      return { snapCost: Math.round(snapCost), agencyCost: Math.round(agencyCost), savings: Math.round(agencyCost - snapCost), hours: Math.round(hours * 10) / 10 };
    }

    res.json({
      shifts: {
        total,
        open: allShifts.filter((s) => s.status === 'LIVE').length,
        filled: allShifts.filter((s) => s.status === 'FILLED').length,
        completed: allShifts.filter((s) => s.status === 'COMPLETED').length,
        depositPending: allShifts.filter((s) => s.status === 'DEPOSIT_PENDING').length,
        fillRate,
      },
      upcoming,
      pendingApplications: pendingApps,
      savings: {
        thisMonth: calcSavings(monthBookings),
        yearToDate: calcSavings(yearBookings),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ── Subscription management ───────────────────────────────────────────────────

router.get('/me/subscription', facilityAuth, async (req, res) => {
  try {
    const sub = await prisma.facilitySubscription.findUnique({
      where: { facilityId: req.facility.id },
    });
    const TIERS = {
      BASIC: { price: 750, label: 'Basic', shiftLimit: 10, features: ['Up to 10 shifts/month', 'Standard matching'] },
      PROFESSIONAL: { price: 2000, label: 'Professional', shiftLimit: null, features: ['Unlimited shifts', 'Preferred provider early access', 'Featured placement', 'Fill rate analytics'] },
      ENTERPRISE: { price: 5000, label: 'Enterprise', shiftLimit: null, features: ['Everything in Professional', 'Multi-facility dashboard', 'Custom reporting', 'Dedicated account manager', 'Priority matching'] },
    };
    res.json({ subscription: sub, tiers: TIERS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

router.post('/me/subscription/upgrade', facilityAuth, async (req, res) => {
  try {
    const { tier } = req.body;
    if (!['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    const sub = await prisma.facilitySubscription.update({
      where: { facilityId: req.facility.id },
      data: { tier },
    });
    res.json({ subscription: sub, message: 'Tier updated. Payment processing coming soon.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// ── Provider management ───────────────────────────────────────────────────────

router.get('/me/providers', facilityAuth, async (req, res) => {
  try {
    const bookings = await prisma.shiftBooking.findMany({
      where: { shift: { facilityId: req.facility.id } },
      include: {
        provider: true,
        shift: { select: { date: true, specialty: true } },
        providerRating: { select: { stars: true } },
      },
    });

    const applications = await prisma.shiftApplication.findMany({
      where: { shift: { facilityId: req.facility.id } },
      include: { provider: true },
    });

    const preferred = await prisma.preferredProvider.findMany({
      where: { facilityId: req.facility.id },
      select: { providerId: true },
    });
    const preferredIds = new Set(preferred.map((p) => p.providerId));

    const seen = new Map();
    [...bookings.map((b) => b.provider), ...applications.map((a) => a.provider)].forEach((p) => {
      if (!seen.has(p.id)) seen.set(p.id, p);
    });

    const providers = Array.from(seen.values()).map((p) => ({
      ...p,
      isPreferred: preferredIds.has(p.id),
      shiftsWorked: bookings.filter((b) => b.providerId === p.id && b.completedAt).length,
      avgRating: (() => {
        const ratings = bookings.filter((b) => b.providerId === p.id && b.providerRating);
        return ratings.length ? Math.round((ratings.reduce((s, b) => s + b.providerRating.stars, 0) / ratings.length) * 10) / 10 : null;
      })(),
    }));

    res.json(providers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load providers' });
  }
});

// ── Preferred provider list ───────────────────────────────────────────────────

router.post('/me/preferred/:providerId', facilityAuth, async (req, res) => {
  try {
    const record = await prisma.preferredProvider.upsert({
      where: { facilityId_providerId: { facilityId: req.facility.id, providerId: req.params.providerId } },
      create: { facilityId: req.facility.id, providerId: req.params.providerId },
      update: {},
    });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add preferred provider' });
  }
});

router.delete('/me/preferred/:providerId', facilityAuth, async (req, res) => {
  try {
    await prisma.preferredProvider.delete({
      where: { facilityId_providerId: { facilityId: req.facility.id, providerId: req.params.providerId } },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove preferred provider' });
  }
});

// ── Public facility profile (for providers) ───────────────────────────────────

router.get('/:id/public', async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, facilityType: true, zipCode: true, photoUrls: true,
        description: true, caseMix: true, parking: true, whatToBring: true, profileScore: true,
      },
    });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });
    res.json(facility);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load facility' });
  }
});

module.exports = router;
