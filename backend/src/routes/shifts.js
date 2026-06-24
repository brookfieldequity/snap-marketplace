const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');
const { notifyShiftPosted, notifyBooking, notifyApplication, notifyApplicationReview } = require('../services/notifications');
const { aggregateFacilityRatings, aggregateProviderRatings, deriveProviderBadges } = require('../services/trust');

const router = express.Router();

const CONTACT_PATTERN = /(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|(?<![a-zA-Z0-9])@[a-zA-Z0-9.]+\.[a-zA-Z]{2,})/;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Provider feed ─────────────────────────────────────────────────────────────

router.get('/feed', auth, async (req, res) => {
  try {
    const {
      sort = 'location',
      page = 1,
      limit = 20,
      specialty,
      minRate,
      maxRate,
      dateRange,            // NEXT_7 | THIS_MONTH | NEXT_MONTH | ALL
      facilityType,         // CSV: HOSPITAL,SURGERY_CENTER,...
      shiftType,            // DAY | NIGHT
      q,                    // keyword — matches facility name
      centerLat,            // "search this area" — map center + radius (miles)
      centerLng,
      radiusMiles,
    } = req.query;
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
    });

    const where = {
      status: 'LIVE',
      ...(specialty ? { specialty } : {}),
    };

    if (minRate || maxRate) {
      where.currentRate = {};
      if (minRate) where.currentRate.gte = Number(minRate);
      if (maxRate) where.currentRate.lte = Number(maxRate);
    }

    if (dateRange && dateRange !== 'ALL') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let start, end;
      if (dateRange === 'NEXT_7') {
        start = startOfToday;
        end = new Date(startOfToday.getTime() + 7 * 86400000);
      } else if (dateRange === 'THIS_MONTH') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      } else if (dateRange === 'NEXT_MONTH') {
        start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      }
      if (start && end) where.date = { gte: start, lt: end };
    }

    // Facility-scoped filters (type + keyword) build one nested `facility` where.
    const facilityWhere = {};
    if (facilityType) {
      const types = String(facilityType).split(',').map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) facilityWhere.facilityType = { in: types };
    }
    if (q && String(q).trim()) {
      facilityWhere.name = { contains: String(q).trim(), mode: 'insensitive' };
    }
    if (Object.keys(facilityWhere).length > 0) {
      where.facility = facilityWhere;
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        facility: {
          select: {
            id: true, name: true, photoUrls: true, zipCode: true,
            lat: true, lng: true, address: true, facilityType: true,
          },
        },
        booking: { select: { id: true } },
        _count: { select: { applications: true } },
      },
      orderBy: sort === 'newest' ? { createdAt: 'desc' }
        : sort === 'pay' ? { currentRate: 'desc' }
        : sort === 'featured' ? { featured: 'desc' }
        : sort === 'surge' ? { surgeMultiplier: 'desc' }
        : { createdAt: 'desc' },
    });

    // Day/Night derived from shift.startTime — "HH:MM" string (24h).
    // Night = start >= 19:00 OR start < 07:00. Day = otherwise.
    const filteredByShiftType = shiftType
      ? shifts.filter((s) => {
          const t = String(s.startTime || '');
          const m = /^(\d{1,2}):/.exec(t);
          if (!m) return true; // keep unparseable so we don't silently drop rows
          const hour = parseInt(m[1], 10);
          const isNight = hour >= 19 || hour < 7;
          return shiftType === 'NIGHT' ? isNight : !isNight;
        })
      : shifts;

    // Check VIP/preferred window
    const isVip = provider?.vipStatus || false;
    const isPreferredAtFacility = provider
      ? await prisma.preferredProvider.findMany({ where: { providerId: provider.id }, select: { facilityId: true } })
      : [];
    const preferredFacilityIds = new Set(isPreferredAtFacility.map((p) => p.facilityId));

    // Check past-worked facilities
    const workedFacilities = provider
      ? await prisma.shiftBooking.findMany({
          where: { providerId: provider.id, completedAt: { not: null } },
          include: { shift: { select: { facilityId: true } } },
        })
      : [];
    const workedFacilityIds = new Set(workedFacilities.map((b) => b.shift.facilityId));

    let results = filteredByShiftType.map((shift) => {
      const now = new Date();
      const inVipWindow =
        shift.preferredAccessOnly &&
        shift.preferredWindowEnds &&
        shift.preferredWindowEnds > now;

      if (inVipWindow && !isVip && !preferredFacilityIds.has(shift.facilityId)) {
        return null;
      }

      const hoursUntilShift = shift.expiresAt
        ? Math.max(0, (new Date(shift.expiresAt) - now) / 3600000)
        : null;

      const distanceKm =
        provider?.lat && shift.facility.lat
          ? haversineKm(provider.lat, provider.lng, shift.facility.lat, shift.facility.lng)
          : null;

      return {
        ...shift,
        distanceMiles: distanceKm ? Math.round(distanceKm * 0.621371 * 10) / 10 : null,
        hoursUntilExpiry: hoursUntilShift ? Math.round(hoursUntilShift * 10) / 10 : null,
        workedHereBefore: workedFacilityIds.has(shift.facilityId),
        vipWindowActive: inVipWindow,
        providerIsCredentialed: provider?.credentialed ?? false,
      };
    }).filter(Boolean);

    // "Search this area" — filter to facilities within radiusMiles of the map
    // center. Independent of the provider's own location (which drives display
    // distance + the default location sort).
    const cLat = Number(centerLat), cLng = Number(centerLng), rMi = Number(radiusMiles);
    if (centerLat && centerLng && radiusMiles && !Number.isNaN(cLat) && !Number.isNaN(cLng) && !Number.isNaN(rMi)) {
      results = results.filter((s) => {
        if (s.facility?.lat == null || s.facility?.lng == null) return false;
        return haversineKm(cLat, cLng, s.facility.lat, s.facility.lng) * 0.621371 <= rMi;
      });
    }

    if (sort === 'location' && provider?.lat) {
      results.sort((a, b) => (a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999));
    }

    const start = (parseInt(page) - 1) * parseInt(limit);
    const pageSlice = results.slice(start, start + parseInt(limit));

    // Attach each facility's public rating (only for the page we return).
    const ratingMap = await aggregateFacilityRatings(pageSlice.map((s) => s.facility.id));
    const withRatings = pageSlice.map((s) => ({
      ...s,
      facility: { ...s.facility, rating: ratingMap.get(s.facility.id) || { avg: null, count: 0 } },
    }));

    res.json({
      shifts: withRatings,
      total: results.length,
      page: parseInt(page),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

// ── Shift detail ──────────────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: {
        facility: {
          include: {
            subscription: true,
            _count: { select: { shifts: true } },
          },
        },
        applications: { select: { id: true, providerId: true, status: true } },
        booking: { select: { id: true, providerId: true } },
      },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    // Increment viewer count
    await prisma.shift.update({
      where: { id: shift.id },
      data: { currentViewers: { increment: 1 } },
    });

    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    const myApplication = shift.applications.find((a) => a.providerId === provider?.id);

    const ratingMap = await aggregateFacilityRatings([shift.facilityId]);

    res.json({
      ...shift,
      facility: { ...shift.facility, rating: ratingMap.get(shift.facilityId) || { avg: null, count: 0 } },
      myApplicationStatus: myApplication?.status || null,
      isBooked: !!shift.booking,
      isMyBooking: shift.booking?.providerId === provider?.id,
      providerIsCredentialed: provider?.credentialed ?? false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shift' });
  }
});

// ── Book shift (provider) ─────────────────────────────────────────────────────

router.post('/:id/book', auth, async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: { facility: { include: { subscription: true } } },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'LIVE') return res.status(400).json({ error: 'Shift not available' });
    if (shift.booking) return res.status(409).json({ error: 'Shift already booked' });

    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!provider) return res.status(400).json({ error: 'Provider profile not found' });
    if (!provider.credentialed) return res.status(403).json({ error: 'Credentialing required to book shifts' });

    const totalValue = shift.currentRate * shift.durationHours;
    const platformFee = totalValue * (shift.platformFeePercent / 100);

    const [booking] = await prisma.$transaction([
      prisma.shiftBooking.create({
        data: {
          shiftId: shift.id,
          providerId: provider.id,
          providerHourlyRate: shift.currentRate,
          shiftDurationHours: shift.durationHours,
          totalShiftValue: totalValue,
          platformFeePercent: shift.platformFeePercent,
          platformFeeAmount: platformFee,
          facilityTier: shift.facility.subscription?.tier,
        },
      }),
      prisma.shift.update({
        where: { id: shift.id },
        data: {
          status: 'FILLED',
          platformFeeAmount: platformFee,
        },
      }),
    ]);

    // VIP: award point for accepting
    await prisma.providerProfile.update({
      where: { id: provider.id },
      data: { vipPoints: { increment: 5 } },
    });
    await prisma.vIPPointsLog.create({
      data: { providerId: provider.id, points: 5, reason: 'SHIFT_ACCEPTED' },
    });

    notifyBooking(shift.id, provider.id).catch((err) => console.error('notifyBooking:', err.message));
    res.status(201).json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Booking failed' });
  }
});

// ── Apply to shift (non-credentialed, creates application) ────────────────────

router.post('/:id/apply', auth, async (req, res) => {
  try {
    const provider = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!provider) return res.status(400).json({ error: 'Provider profile not found' });

    const existing = await prisma.shiftApplication.findUnique({
      where: { shiftId_providerId: { shiftId: req.params.id, providerId: provider.id } },
    });
    if (existing) return res.status(409).json({ error: 'Already applied' });

    const application = await prisma.shiftApplication.create({
      data: { shiftId: req.params.id, providerId: provider.id },
    });

    notifyApplication(req.params.id, provider.id).catch((err) => console.error('notifyApplication:', err.message));
    res.status(201).json(application);
  } catch (err) {
    res.status(500).json({ error: 'Application failed' });
  }
});

// ── Post shift (facility) ─────────────────────────────────────────────────────

router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      specialty, date, startTime, durationHours, baseRate,
      featured, surgeEnabled, preferredAccessOnly, preferredWindowHours,
    } = req.body;

    if (!specialty || !date || !startTime || !durationHours || !baseRate) {
      return res.status(400).json({ error: 'specialty, date, startTime, durationHours, and baseRate are required' });
    }

    const sub = req.facility.subscription;
    if (sub?.tier === 'BASIC') {
      await resetMonthlyCount(sub);
      if (sub.shiftsPostedThisMonth >= 10) {
        return res.status(403).json({ error: 'Monthly shift limit reached. Upgrade to Professional for unlimited posting.' });
      }
    }

    const estimatedTotal = parseFloat(baseRate) * parseFloat(durationHours);
    const depositAmount = Math.round(estimatedTotal * 0.25 * 100) / 100;
    const shiftDate = new Date(date);
    const expiresAt = new Date(shiftDate.getTime() - 2 * 3600000); // 2h before shift

    let preferredWindowEnds = null;
    if (preferredAccessOnly) {
      preferredWindowEnds = new Date(Date.now() + (preferredWindowHours || 2) * 3600000);
    }

    const shift = await prisma.shift.create({
      data: {
        facilityId: req.facility.id,
        specialty,
        date: shiftDate,
        startTime,
        durationHours: parseFloat(durationHours),
        baseRate: parseFloat(baseRate),
        currentRate: parseFloat(baseRate),
        featured: !!featured,
        surgeEnabled: !!surgeEnabled,
        preferredAccessOnly: !!preferredAccessOnly,
        preferredWindowEnds,
        expiresAt,
        estimatedTotal,
        depositAmount,
        status: 'DEPOSIT_PENDING',
        platformFeePercent: 10,
      },
    });

    if (sub) {
      await prisma.facilitySubscription.update({
        where: { id: sub.id },
        data: { shiftsPostedThisMonth: { increment: 1 } },
      });
    }

    notifyShiftPosted(shift).catch((err) => console.error('notifyShiftPosted:', err.message));
    res.status(201).json(shift);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post shift' });
  }
});

// ── Confirm deposit (facility) ────────────────────────────────────────────────

router.post('/:id/confirm-deposit', facilityAuth, async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!shift || shift.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.status !== 'DEPOSIT_PENDING') {
      return res.status(400).json({ error: 'Shift is not pending deposit' });
    }
    const updated = await prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: 'LIVE',
        depositConfirmed: true,
        depositConfirmedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm deposit' });
  }
});

// ── Get facility's shifts ─────────────────────────────────────────────────────

router.get('/facility/mine', facilityAuth, async (req, res) => {
  try {
    const providerSelect = {
      id: true, firstName: true, lastName: true, specialty: true,
      credentialed: true, photoUrl: true, vipStatus: true,
      maLicenseNumber: true, maLicenseExpiry: true,
      _count: { select: { bookings: true } },
    };
    const shifts = await prisma.shift.findMany({
      where: { facilityId: req.facility.id },
      include: {
        applications: { include: { provider: { select: providerSelect } } },
        booking: { include: { provider: { select: providerSelect } } },
        completions: true,
      },
      orderBy: { date: 'asc' },
    });

    // Collect every provider id across applicants + bookings, fetch ratings once,
    // then decorate each provider with { rating, badges }.
    const providerIds = [];
    for (const s of shifts) {
      for (const a of s.applications) if (a.provider) providerIds.push(a.provider.id);
      if (s.booking?.provider) providerIds.push(s.booking.provider.id);
    }
    const ratingMap = await aggregateProviderRatings(providerIds);
    const decorate = (p) => p && {
      ...p,
      rating: ratingMap.get(p.id) || { avg: null, count: 0 },
      badges: deriveProviderBadges(p, { completedShifts: p._count?.bookings }),
    };
    const enriched = shifts.map((s) => ({
      ...s,
      applications: s.applications.map((a) => ({ ...a, provider: decorate(a.provider) })),
      booking: s.booking ? { ...s.booking, provider: decorate(s.booking.provider) } : s.booking,
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shifts' });
  }
});

// ── Review application (facility approves/rejects) ────────────────────────────

router.patch('/:shiftId/applications/:appId', facilityAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const app = await prisma.shiftApplication.update({
      where: { id: req.params.appId },
      data: { status, reviewedAt: new Date() },
    });

    notifyApplicationReview(app.id, status).catch((err) => console.error('notifyApplicationReview:', err.message));
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update application' });
  }
});

async function resetMonthlyCount(sub) {
  const now = new Date();
  if (!sub.monthResetAt || now.getMonth() !== new Date(sub.monthResetAt).getMonth()) {
    await prisma.facilitySubscription.update({
      where: { id: sub.id },
      data: { shiftsPostedThisMonth: 0, monthResetAt: now },
    });
    sub.shiftsPostedThisMonth = 0;
  }
}

module.exports = router;
