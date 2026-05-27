const express = require('express');
const prisma = require('../config/db');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

// ── Providers list ────────────────────────────────────────────────────────────

router.get('/providers', adminAuth, async (req, res) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      include: {
        user: { select: { email: true, createdAt: true } },
        _count: { select: { bookings: true, applications: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const in90Days = new Date(now.getTime() + 90 * 86400000);
    const enriched = providers.map((p) => ({
      ...p,
      licenseExpiringSoon: p.maLicenseExpiry && new Date(p.maLicenseExpiry) <= in90Days,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load providers' });
  }
});

router.get('/providers/:id', adminAuth, async (req, res) => {
  try {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true } },
        bookings: { include: { shift: { include: { facility: true } }, completion: true }, orderBy: { confirmedAt: 'desc' } },
        vipLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!provider) return res.status(404).json({ error: 'Not found' });
    res.json(provider);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load provider' });
  }
});

router.patch('/providers/:id/credentialed', adminAuth, async (req, res) => {
  try {
    const { credentialed } = req.body;
    const updated = await prisma.providerProfile.update({
      where: { id: req.params.id },
      data: { credentialed: !!credentialed },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

// ── Facilities list ───────────────────────────────────────────────────────────

router.get('/facilities', adminAuth, async (req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      include: {
        subscription: true,
        _count: { select: { shifts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(facilities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load facilities' });
  }
});

router.patch('/facilities/:id/subscription', adminAuth, async (req, res) => {
  try {
    const { tier } = req.body;
    const sub = await prisma.facilitySubscription.update({
      where: { facilityId: req.params.id },
      data: { tier },
    });
    res.json(sub);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// ── All shifts ────────────────────────────────────────────────────────────────

router.get('/shifts', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const shifts = await prisma.shift.findMany({
      where: status ? { status } : {},
      include: {
        facility: { select: { name: true, zipCode: true } },
        booking: { include: { provider: { select: { firstName: true, lastName: true } } } },
        completion: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shifts' });
  }
});

router.patch('/shifts/:id/override', adminAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const shift = await prisma.shift.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(shift);
  } catch (err) {
    res.status(500).json({ error: 'Failed to override shift' });
  }
});

// ── Dispute queue ─────────────────────────────────────────────────────────────

router.get('/disputes', adminAuth, async (req, res) => {
  try {
    const disputes = await prisma.shiftCompletion.findMany({
      where: { disputed: true, disputeResolvedAt: null },
      include: {
        booking: { include: { provider: { select: { firstName: true, lastName: true } } } },
        shift: { include: { facility: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(disputes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load disputes' });
  }
});

router.patch('/disputes/:id/resolve', adminAuth, async (req, res) => {
  try {
    const { notes, finalHours } = req.body;
    const completion = await prisma.shiftCompletion.update({
      where: { id: req.params.id },
      data: { disputeResolvedAt: new Date(), disputeNotes: notes },
    });

    if (finalHours) {
      const booking = await prisma.shiftBooking.findUnique({
        where: { id: completion.bookingId },
        include: { shift: true },
      });
      const total = booking.shift.currentRate * parseFloat(finalHours);
      const fee = total * ((booking.shift.platformFeePercent || 10) / 100);
      await prisma.shiftBooking.update({
        where: { id: booking.id },
        data: { totalShiftValue: total, platformFeeAmount: fee, completedAt: new Date(), paymentStatus: 'PROCESSING' },
      });
      await prisma.shift.update({ where: { id: booking.shiftId }, data: { status: 'COMPLETED' } });
    }

    res.json(completion);
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// ── Flagged messages ──────────────────────────────────────────────────────────

router.get('/messages/flagged', adminAuth, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { flagged: true },
      include: {
        sender: { select: { firstName: true, lastName: true } },
        facility: { select: { name: true } },
        shift: { select: { id: true, date: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load flagged messages' });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      totalProviders, totalFacilities, totalShifts,
      completedBookings, allBookings, subscriptions,
      disputedShifts, monthBookings,
      topFacilities, topProviders,
      licenseExpiringSoon,
      flaggedMessages,
    ] = await Promise.all([
      prisma.providerProfile.count(),
      prisma.facility.count(),
      prisma.shift.count(),
      prisma.shiftBooking.findMany({
        where: { completedAt: { not: null } },
        include: { shift: { select: { specialty: true, durationHours: true, currentRate: true, facilityId: true, createdAt: true } } },
      }),
      prisma.shiftBooking.findMany({ select: { confirmedAt: true } }),
      prisma.facilitySubscription.groupBy({ by: ['tier'], _count: { tier: true } }),
      prisma.shift.count({ where: { status: 'DISPUTED' } }),
      prisma.shiftBooking.findMany({
        where: { completedAt: { gte: thisMonthStart } },
        include: { shift: true },
      }),
      prisma.shift.groupBy({
        by: ['facilityId'],
        where: { status: 'COMPLETED' },
        _count: { facilityId: true },
        orderBy: { _count: { facilityId: 'desc' } },
        take: 10,
      }),
      prisma.shiftBooking.groupBy({
        by: ['providerId'],
        where: { completedAt: { not: null } },
        _count: { providerId: true },
        _avg: { totalShiftValue: true },
        orderBy: { _count: { providerId: 'desc' } },
        take: 10,
      }),
      prisma.providerProfile.findMany({
        where: { maLicenseExpiry: { lte: new Date(now.getTime() + 90 * 86400000), gt: now } },
        select: { id: true, firstName: true, lastName: true, maLicenseExpiry: true, maLicenseNumber: true },
      }),
      prisma.message.count({ where: { flagged: true } }),
    ]);

    const totalGTV = completedBookings.reduce((s, b) => s + (b.totalShiftValue || 0), 0);
    const totalPlatformFees = completedBookings.reduce((s, b) => s + ((b.totalShiftValue || 0) * 0.1), 0);

    const shiftsByStatus = await prisma.shift.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const totalOpen = shiftsByStatus.find((s) => s.status === 'LIVE')?._count.status || 0;
    const totalFilled = shiftsByStatus.filter((s) => ['FILLED', 'COMPLETED'].includes(s.status)).reduce((s, r) => s + r._count.status, 0);
    const fillRate = totalShifts > 0 ? Math.round((totalFilled / totalShifts) * 100) : 0;

    const activeProviders = await prisma.providerProfile.count({
      where: { bookings: { some: { confirmedAt: { gte: new Date(now.getTime() - 30 * 86400000) } } } },
    });

    const subscriptionRevenue = {
      BASIC: (subscriptions.find((s) => s.tier === 'BASIC')?._count.tier || 0) * 750,
      PROFESSIONAL: (subscriptions.find((s) => s.tier === 'PROFESSIONAL')?._count.tier || 0) * 2000,
      ENTERPRISE: (subscriptions.find((s) => s.tier === 'ENTERPRISE')?._count.tier || 0) * 5000,
    };

    res.json({
      overview: {
        totalProviders,
        totalFacilities,
        totalShifts,
        totalGTV: Math.round(totalGTV),
        totalPlatformFees: Math.round(totalPlatformFees),
        fillRate,
        activeProviders,
        disputedShifts,
        flaggedMessages,
      },
      subscriptionRevenue,
      subscriptionCounts: Object.fromEntries(subscriptions.map((s) => [s.tier, s._count.tier])),
      topFacilities,
      topProviders,
      licenseExpiringSoon,
      shiftsByStatus,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// ── StaffIQ Analytics ─────────────────────────────────────────────────────────

router.get('/staffiq/analytics', adminAuth, async (req, res) => {
  try {
    const [insightCount, insights, topInsight] = await Promise.all([
      prisma.staffIQInsight.count(),
      prisma.staffIQInsight.findMany({ select: { dollarImpactEstimate: true, insightType: true } }),
      prisma.staffIQInsight.groupBy({
        by: ['insightType'],
        _count: { insightType: true },
        orderBy: { _count: { insightType: 'desc' } },
        take: 1,
      }),
    ]);
    const totalDollarImpact = insights.reduce((s, i) => s + (i.dollarImpactEstimate || 0), 0);
    const facilityCount = await prisma.facility.count({ where: { staffiqInsights: { some: {} } } });
    res.json({
      totalInsightsGenerated: insightCount,
      totalDollarSavingsCalculated: Math.round(totalDollarImpact),
      mostCommonInsightType: topInsight[0]?.insightType || null,
      avgSavingsPerFacility: facilityCount > 0 ? Math.round(totalDollarImpact / facilityCount) : 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load StaffIQ analytics' });
  }
});

// ── Leads Management ──────────────────────────────────────────────────────────

router.get('/leads', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const leads = await prisma.lead.findMany({
      where: status ? { followUpStatus: status } : {},
      orderBy: { createdAt: 'desc' },
    });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

router.patch('/leads/:id', adminAuth, async (req, res) => {
  try {
    const { followUpStatus } = req.body;
    const valid = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'CUSTOMER', 'NOT_INTERESTED'];
    if (!valid.includes(followUpStatus)) return res.status(400).json({ error: 'Invalid status' });
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { followUpStatus } });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ── Availability Windows (all facilities) ─────────────────────────────────────

router.get('/windows', adminAuth, async (req, res) => {
  try {
    const windows = await prisma.availabilityWindow.findMany({
      include: {
        facility: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const roster = await prisma.internalRosterEntry.groupBy({
      by: ['facilityId'],
      _count: { facilityId: true },
    });
    const rosterMap = Object.fromEntries(roster.map((r) => [r.facilityId, r._count.facilityId]));
    res.json(windows.map((w) => ({
      ...w,
      totalRoster: rosterMap[w.facilityId] || 0,
      submitRate: (rosterMap[w.facilityId] || 0) > 0
        ? Math.round((w._count.submissions / rosterMap[w.facilityId]) * 100)
        : 0,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load windows' });
  }
});

// ── Incentive Shifts (all facilities) ────────────────────────────────────────

router.get('/incentive-shifts', adminAuth, async (req, res) => {
  try {
    const shifts = await prisma.internalIncentiveShift.findMany({
      include: {
        facility: { select: { name: true } },
        _count: { select: { responses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const filled = shifts.filter((s) => s.status === 'FILLED').length;
    const escalated = shifts.filter((s) => s.escalatedToMarketplace).length;
    res.json({
      shifts,
      stats: {
        total: shifts.length,
        filled,
        escalated,
        fillRate: shifts.length > 0 ? Math.round((filled / shifts.length) * 100) : 0,
        escalationRate: shifts.length > 0 ? Math.round((escalated / shifts.length) * 100) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load incentive shifts' });
  }
});

// ── Schedule Uploads (all facilities) ────────────────────────────────────────

router.get('/uploads', adminAuth, async (req, res) => {
  try {
    const uploads = await prisma.schedulingUpload.findMany({
      include: { facility: { select: { name: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(uploads);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load uploads' });
  }
});

// ── StaffIQ Scores (all facilities, ranked lowest to highest) ─────────────────

router.get('/staffiq-scores', adminAuth, async (req, res) => {
  try {
    // Get all facilities with their latest StaffIQ score history entry
    const histories = await prisma.staffIQScoreHistory.findMany({
      include: {
        facility: { select: { id: true, name: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    // Deduplicate: keep only the latest entry per facility
    const latestByFacility = new Map();
    for (const entry of histories) {
      if (!latestByFacility.has(entry.facilityId)) {
        latestByFacility.set(entry.facilityId, entry);
      }
    }

    const facilityScores = Array.from(latestByFacility.values())
      .map((entry) => ({
        facilityId: entry.facilityId,
        facilityName: entry.facility.name,
        score: entry.score,
        calculationMethod: entry.calculationMethod,
        calculatedAt: entry.calculatedAt,
      }))
      .sort((a, b) => a.score - b.score); // ranked lowest to highest

    // Compute aggregates from the latest StaffIQInput records
    const inputs = await prisma.staffIQInput.findMany({
      where: {
        facilityId: { in: Array.from(latestByFacility.keys()) },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    const latestInputByFacility = new Map();
    for (const input of inputs) {
      if (!latestInputByFacility.has(input.facilityId)) {
        latestInputByFacility.set(input.facilityId, input);
      }
    }

    const totalDollarInefficiency = Array.from(latestInputByFacility.values()).reduce(
      (sum, inp) => sum + (inp.inefficiency1Cost || 0) + (inp.inefficiency2Cost || 0),
      0
    );

    const avgScore =
      facilityScores.length > 0
        ? Math.round(facilityScores.reduce((s, f) => s + f.score, 0) / facilityScores.length)
        : null;

    res.json({
      facilities: facilityScores,
      avgScore,
      totalDollarInefficiency: Math.round(totalDollarInefficiency),
      totalFacilitiesScored: facilityScores.length,
    });
  } catch (err) {
    console.error('GET /admin/staffiq-scores error:', err);
    res.status(500).json({ error: 'Failed to load StaffIQ scores' });
  }
});

// ── Calculator Leads ──────────────────────────────────────────────────────────

// GET /calculator-leads/export must come BEFORE /:id to avoid param collision
router.get('/calculator-leads/export', adminAuth, async (req, res) => {
  try {
    const leads = await prisma.calculatorLead.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'id', 'facilityName', 'contactName', 'email', 'phone',
      'locationsInput', 'providersInput', 'hourlyRateInput',
      'estimatedBudget', 'inefficiency1Cost', 'inefficiency2Cost', 'totalInefficiency',
      'reportGenerated', 'reportSentAt', 'followUpStatus', 'createdAt',
    ];

    const escape = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.join(','),
      ...leads.map((lead) => headers.map((h) => escape(lead[h])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="calculator-leads.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('GET /admin/calculator-leads/export error:', err);
    res.status(500).json({ error: 'Failed to export leads' });
  }
});

router.get('/calculator-leads', adminAuth, async (req, res) => {
  try {
    const leads = await prisma.calculatorLead.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(leads);
  } catch (err) {
    console.error('GET /admin/calculator-leads error:', err);
    res.status(500).json({ error: 'Failed to load calculator leads' });
  }
});

router.patch('/calculator-leads/:id', adminAuth, async (req, res) => {
  try {
    const { followUpStatus } = req.body;
    const valid = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'CUSTOMER', 'NOT_INTERESTED'];
    if (!valid.includes(followUpStatus)) {
      return res.status(400).json({ error: 'Invalid followUpStatus. Must be one of: ' + valid.join(', ') });
    }
    const lead = await prisma.calculatorLead.update({
      where: { id: req.params.id },
      data: { followUpStatus },
    });
    res.json(lead);
  } catch (err) {
    console.error('PATCH /admin/calculator-leads/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lead not found' });
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// GET /staffiq/gary-presentation — CAPA-specific presentation data
router.get('/staffiq/gary-presentation', adminAuth, async (req, res) => {
  try {
    // Find CAPA facility
    const facility = await prisma.facility.findFirst({
      where: { name: { contains: 'CAPA', mode: 'insensitive' } },
    });

    if (!facility) {
      // Return hardcoded presentation data if CAPA not found or no uploads
      return res.json({
        facilityName: 'CAPA',
        page1: {
          title: 'What StaffIQ Found in Your June Schedule',
          metrics: [
            { label: 'Inefficient days at Kenmore', value: '6 of 22 working days', pct: 27 },
            { label: 'Inefficient days at Weymouth', value: '8 of 22 working days', pct: 36 },
            { label: 'Combined estimated annual waste', value: '$295,500', raw: 295500 },
          ],
        },
        page2: {
          title: 'Your Friday CRNA Shortage Is Costing You',
          kenmoreWeekdayRatio: 2.8,
          kenmoreFridayRatio: 1.9,
          weymouthWeekdayRatio: 2.6,
          weymouthFridayRatio: 1.7,
          fridayAnnualPremium: 104500,
          totalSavingsOpportunity: { min: 400000, max: 500000 },
        },
        page3: {
          title: 'How SNAP Fixes This',
          bullets: [
            'StaffIQ identifies every suboptimal staffing day before it costs you money',
            'SNAP Shifts sends automatic incentive alerts to your CRNAs for high-cost coverage gaps',
            'SNAP Marketplace connects you to external CRNAs when internal coverage falls short',
          ],
        },
      });
    }

    // Try to load real data from uploads
    const records = await prisma.schedulingRecord.findMany({
      where: { facilityId: facility.id },
      orderBy: { shiftDate: 'asc' },
    });

    // Return structured presentation data
    res.json({ facilityName: facility.name, hasRealData: records.length > 0, recordCount: records.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load presentation data' });
  }
});

module.exports = router;
