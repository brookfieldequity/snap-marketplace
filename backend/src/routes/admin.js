const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/db');
const adminAuth = require('../middleware/adminAuth');
const { sendWelcomeEmail, sendPasswordResetEmail, sendFacilityInvite } = require('../services/credentialEmail');

// Where claim links land. The web app deploys separately from the backend
// (per CLAUDE.md), so this points at the web service URL. Override via
// FACILITY_CLAIM_BASE env var on Railway.
const FACILITY_CLAIM_BASE = process.env.FACILITY_CLAIM_BASE
  || 'https://sublime-flexibility-production-4f52.up.railway.app';

// Default invite TTL — 14 days is conservative enough that "I'll get to it
// next week" still works, short enough that abandoned invites don't pile up.
const DEFAULT_INVITE_TTL_DAYS = parseInt(process.env.FACILITY_INVITE_TTL_DAYS || '14', 10);

// Role labels for the invite email (human-readable per role).
const ROLE_LABELS = {
  ADMIN: 'an administrator',
  COORDINATOR: 'a coordinator',
  VIEWER: 'a viewer',
};

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

// DELETE /admin/facility/:id — remove a facility and its direct dependents.
// Used to clean up orphan / duplicate facility rows left over from the
// pre-invite-flow self-register era. Wrapped in a transaction so a partial
// delete can't leave the DB in a stranger state than we started.
//
// Deliberately conservative: only deletes the rows we know exist for a
// freshly-created or barely-used facility (FacilityUser links, Subscription).
// If a facility has substantive dependents (rosters, schedules, shifts), the
// transaction throws and the row is preserved — Prisma's FK protection acts
// as the safety net.
router.delete('/facility/:id', adminAuth, async (req, res) => {
  try {
    const facilityId = req.params.id;
    // ?force=true does a deep-clean: deletes all dependent rows (shifts +
    // their bookings/applications/completions, schedules, roster, ratings,
    // messages, etc.) before removing the facility. Use ONLY for test/
    // orphan facilities — this is irreversible and removes real data if
    // pointed at a live customer.
    const force = req.query.force === 'true';

    const result = await prisma.$transaction(async (tx) => {
      if (force) {
        // ── Shift subtree (children first) ────────────────────────────────
        const shiftIds = (await tx.shift.findMany({
          where: { facilityId }, select: { id: true },
        })).map((s) => s.id);
        if (shiftIds.length) {
          await tx.shiftCompletion.deleteMany({ where: { shiftId: { in: shiftIds } } });
          await tx.shiftApplication.deleteMany({ where: { shiftId: { in: shiftIds } } });
          await tx.shiftBooking.deleteMany({ where: { shiftId: { in: shiftIds } } });
          await tx.message.deleteMany({ where: { shiftId: { in: shiftIds } } });
        }
        await tx.message.deleteMany({ where: { facilityId } });
        await tx.shift.deleteMany({ where: { facilityId } });

        // ── Scheduling subtree ────────────────────────────────────────────
        const dayIds = (await tx.scheduleDay.findMany({
          where: { facilityId }, select: { id: true },
        })).map((d) => d.id);
        if (dayIds.length) {
          await tx.scheduleAssignment.deleteMany({ where: { scheduleDayId: { in: dayIds } } });
        }
        await tx.scheduleDay.deleteMany({ where: { facilityId } });
        await tx.scheduleBuildRun.deleteMany({ where: { facilityId } });
        await tx.scheduleFeedback.deleteMany({ where: { facilityId } });
        await tx.schedulingRecord.deleteMany({ where: { facilityId } });
        await tx.schedulingUpload.deleteMany({ where: { facilityId } });

        // ── Internal staffing (roster + related) ──────────────────────────
        const rosterIds = (await tx.internalRosterEntry.findMany({
          where: { facilityId }, select: { id: true },
        })).map((r) => r.id);
        if (rosterIds.length) {
          await tx.providerLocation.deleteMany({ where: { rosterEntryId: { in: rosterIds } } });
          await tx.rosterTimeOff.deleteMany({ where: { rosterEntryId: { in: rosterIds } } });
          // NB: this model's FK field is `rosterId`, not `rosterEntryId`.
          await tx.internalIncentiveShiftResponse.deleteMany({ where: { rosterId: { in: rosterIds } } });
        }
        await tx.internalIncentiveShift.deleteMany({ where: { facilityId } });
        await tx.internalRosterEntry.deleteMany({ where: { facilityId } });
        await tx.availabilityWindow.deleteMany({ where: { facilityId } });
        await tx.coverageTemplate.deleteMany({ where: { facilityId } });
        await tx.facilityHoliday.deleteMany({ where: { facilityId } });
        await tx.facilitySiteRate.deleteMany({ where: { facilityId } });

        // ── StaffIQ / analytics / misc ────────────────────────────────────
        await tx.staffIQInsight.deleteMany({ where: { facilityId } });
        await tx.staffIQInput.deleteMany({ where: { facilityId } });
        await tx.staffIQScoreHistory.deleteMany({ where: { facilityId } });
        await tx.automationEvent.deleteMany({ where: { facilityId } });
        await tx.facilityRoiSnapshot.deleteMany({ where: { facilityId } });
        await tx.facilityRoiBaseline.deleteMany({ where: { facilityId } });

        // ── Marketplace relationship rows ─────────────────────────────────
        await tx.preferredProvider.deleteMany({ where: { facilityId } });
        await tx.providerRating.deleteMany({ where: { facilityId } });
        await tx.facilityRating.deleteMany({ where: { facilityId } });

        // ── Credentialing-portal rows ─────────────────────────────────────
        await tx.facilityRosterEntry.deleteMany({ where: { facilityId } });
        await tx.credentialUser.deleteMany({ where: { facilityId } });
      }

      const fu = await tx.facilityUser.deleteMany({ where: { facilityId } });
      const sub = await tx.facilitySubscription.deleteMany({ where: { facilityId } });
      const fac = await tx.facility.delete({ where: { id: facilityId } });
      return {
        facilityUsersDeleted: fu.count,
        subscriptionsDeleted: sub.count,
        forced: force,
        facility: { id: fac.id, name: fac.name },
      };
    }, { timeout: 30000 });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] delete facility failed:', err);
    res.status(500).json({
      error: 'Failed to delete facility — likely has dependent rows. Retry with ?force=true to deep-clean a TEST facility (irreversible).',
      details: err.message,
    });
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

// ── Credential User Management (SNAP admin) ───────────────────────────────────

router.get('/credential-users', adminAuth, async (req, res) => {
  try {
    const users = await prisma.credentialUser.findMany({
      include: { facility: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      permission: u.permission,
      facilityId: u.facilityId,
      facilityName: u.facility.name,
      isActive: u.isActive,
      forcePasswordChange: u.forcePasswordChange,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/credential-users', adminAuth, async (req, res) => {
  try {
    const { name, email, permission, facilityName } = req.body
    if (!name || !email || !permission || !facilityName) {
      return res.status(400).json({ error: 'name, email, permission, facilityName required' })
    }
    let facility = await prisma.facility.findFirst({ where: { name: { equals: facilityName, mode: 'insensitive' } } })
    if (!facility) {
      facility = await prisma.facility.create({ data: { name: facilityName } })
    }
    const tempPassword = require('crypto').randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
    const passwordHash = await bcrypt.hash(tempPassword, 10)
    const user = await prisma.credentialUser.create({
      data: {
        facilityId: facility.id,
        name,
        email: email.toLowerCase(),
        passwordHash,
        permission,
        forcePasswordChange: true,
      },
      select: { id: true, name: true, email: true, permission: true, createdAt: true },
    })
    await sendWelcomeEmail(email.toLowerCase(), name, facilityName, tempPassword)
    res.status(201).json({ ...user, facilityName: facility.name })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already in use' })
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/credential-users/:id/reset-password', adminAuth, async (req, res) => {
  try {
    const user = await prisma.credentialUser.findUnique({
      where: { id: req.params.id },
      include: { facility: { select: { name: true } } },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    const tempPassword = require('crypto').randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
    const passwordHash = await bcrypt.hash(tempPassword, 10)
    await prisma.credentialUser.update({
      where: { id: user.id },
      data: { passwordHash, forcePasswordChange: true },
    })
    await sendWelcomeEmail(user.email, user.name, user.facility.name, tempPassword)
    res.json({ message: 'Password reset and welcome email sent' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/credential-users/:id', adminAuth, async (req, res) => {
  try {
    const { isActive, permission } = req.body
    const data = {}
    if (typeof isActive === 'boolean') data.isActive = isActive
    if (permission) data.permission = permission
    const user = await prisma.credentialUser.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, permission: true, isActive: true },
    })
    res.json(user)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /roster/relink-all — retroactive sweep across every facility's
// roster. Links any InternalRosterEntry whose linkedProviderId is null but
// whose NPI or email matches a registered marketplace ProviderProfile.
// Idempotent. Returns counts.
const { reverseLinkAllOrphans } = require('../services/rosterLink');
const roiCalc = require('../services/roiCalc');

// ── ROI Tracker ─────────────────────────────────────────────────────────
//
// Per-facility baseline (1:1) + monthly snapshots time series. SNAP admins
// use this to show customers their savings and to project for prospects.

// Parse a "YYYY-MM" or "YYYY-MM-DD" param into a Date at the first of the
// month UTC. Throws on invalid input so the route 400s cleanly.
function parseMonthKey(input) {
  if (!input) return null;
  const m = String(input).match(/^(\d{4})-(\d{2})(-\d{2})?$/);
  if (!m) throw new Error('month must be YYYY-MM');
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  if (isNaN(date.getTime())) throw new Error('invalid month');
  return date;
}

function monthRangeUTC(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

// GET /admin/roi/facilities — facility picker payload + at-a-glance
// numbers per row (latest snapshot's savings, last update).
router.get('/roi/facilities', adminAuth, async (req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      select: {
        id: true,
        name: true,
        roiBaseline: true,
        roiSnapshots: {
          orderBy: { month: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    const rows = facilities.map((f) => {
      const latest = f.roiSnapshots[0] || null;
      const savings = f.roiBaseline ? roiCalc.computeSavings(f.roiBaseline, latest) : null;
      return {
        id: f.id,
        name: f.name,
        hasBaseline: !!f.roiBaseline,
        latestMonth: latest?.month || null,
        latestUpdatedAt: latest?.updatedAt || null,
        monthlySavings: savings?.totalMonthly || 0,
        annualSavings: savings?.totalAnnualized || 0,
        providerCount: f.roiBaseline?.providerCount || 0,
      };
    });
    res.json({ facilities: rows });
  } catch (err) {
    console.error('[admin] roi facilities failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/roi/rollup — SNAP-wide aggregate across every customer with
// a baseline + at least one snapshot. Drives the rollup band + Overview.
router.get('/roi/rollup', adminAuth, async (req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      where: { roiBaseline: { isNot: null } },
      select: {
        id: true,
        name: true,
        roiBaseline: true,
        roiSnapshots: { orderBy: { month: 'desc' }, take: 1 },
      },
    });
    const rows = facilities.map((f) => ({
      baseline: f.roiBaseline,
      latestSnapshot: f.roiSnapshots[0] || null,
    }));
    res.json(roiCalc.rollup(rows));
  } catch (err) {
    console.error('[admin] roi rollup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/roi/:facilityId — baseline + all snapshots + per-metric
// progress for the selected month. ?month=YYYY-MM selects which snapshot
// drives the dashboard; omitted = the most recent snapshot.
router.get('/roi/:facilityId', adminAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.params.facilityId },
      select: {
        id: true,
        name: true,
        roiBaseline: true,
        roiSnapshots: { orderBy: { month: 'desc' } },
      },
    });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });

    const baseline = facility.roiBaseline;
    let selected = null;
    if (req.query.month) {
      const key = parseMonthKey(req.query.month);
      selected = facility.roiSnapshots.find((s) => s.month.getTime() === key.getTime()) || null;
    } else {
      selected = facility.roiSnapshots[0] || null;
    }

    res.json({
      facility: { id: facility.id, name: facility.name },
      baseline,
      snapshots: facility.roiSnapshots,
      selected,
      computed: baseline ? {
        savings: roiCalc.computeSavings(baseline, selected),
        metrics: roiCalc.computeMetricProgress(baseline, selected),
      } : null,
      targets: roiCalc.TARGETS,
    });
  } catch (err) {
    if (err.message?.startsWith('month must be') || err.message === 'invalid month') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[admin] roi get failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /admin/roi/:facilityId/baseline — upsert baseline. Body accepts any
// subset of the FacilityRoiBaseline fields.
router.put('/roi/:facilityId/baseline', adminAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.params.facilityId } });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });
    const fields = [
      'providerCount', 'monthlyProviderCost', 'providerHourlyRate', 'backupPremium',
      'backupShiftsPerDay', 'shiftHours', 'annualBackupStaffing',
      'adminSchedulingStaff', 'adminSchedulingHours', 'adminSchedulingRate',
      'credentialingStaff', 'credentialingHours', 'credentialingRate',
      'credentialingTurnaround', 'schedulingGapRate', 'providerSatisfaction', 'notes',
    ];
    const data = {};
    for (const k of fields) {
      if (req.body[k] !== undefined) {
        data[k] = typeof req.body[k] === 'string' && k !== 'notes' ? parseFloat(req.body[k]) : req.body[k];
      }
    }
    const row = await prisma.facilityRoiBaseline.upsert({
      where: { facilityId: req.params.facilityId },
      create: { facilityId: req.params.facilityId, ...data },
      update: data,
    });
    res.json(row);
  } catch (err) {
    console.error('[admin] roi baseline upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /admin/roi/:facilityId/snapshot — upsert one month's actuals.
// Body: { month: "YYYY-MM", backupShiftsPerDay?, adminSchedulingHours?, ... }
router.put('/roi/:facilityId/snapshot', adminAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.params.facilityId } });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });
    const month = parseMonthKey(req.body?.month);
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });
    const fields = [
      'backupShiftsPerDay', 'adminSchedulingHours', 'credentialingHours',
      'credentialingTurnaround', 'schedulingGapRate', 'providerSatisfaction', 'notes',
    ];
    const data = {};
    for (const k of fields) {
      if (req.body[k] !== undefined && req.body[k] !== null && req.body[k] !== '') {
        data[k] = typeof req.body[k] === 'string' && k !== 'notes' ? parseFloat(req.body[k]) : req.body[k];
      } else if (req.body[k] === null) {
        data[k] = null;
      }
    }
    if (req.body.autoPulled !== undefined) data.autoPulled = req.body.autoPulled;
    const row = await prisma.facilityRoiSnapshot.upsert({
      where: { facilityId_month: { facilityId: req.params.facilityId, month } },
      create: { facilityId: req.params.facilityId, month, ...data },
      update: data,
    });
    res.json(row);
  } catch (err) {
    if (err.message?.startsWith('month must be') || err.message === 'invalid month') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[admin] roi snapshot upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/roi/:facilityId/auto-pull?month=YYYY-MM — compute the
// metrics we CAN derive from live data for the given month. Currently:
//   schedulingGapRate — (totalRooms - filled) / totalRooms * 100
//   backupShiftsPerDay — count of internal incentive shifts that month / days
// Doesn't write anything; the UI uses it to pre-fill the snapshot form.
router.get('/roi/:facilityId/auto-pull', adminAuth, async (req, res) => {
  try {
    const month = parseMonthKey(req.query.month);
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });
    const year = month.getUTCFullYear();
    const monthIdx = month.getUTCMonth() + 1;
    const { start, end } = monthRangeUTC(year, monthIdx);

    const [days, incentiveShifts] = await Promise.all([
      prisma.scheduleDay.findMany({
        where: { facilityId: req.params.facilityId, date: { gte: start, lt: end } },
        include: { assignments: { select: { rosterId: true, role: true } } },
      }),
      prisma.internalIncentiveShift.count({
        where: { facilityId: req.params.facilityId, shiftDate: { gte: start, lt: end } },
      }),
    ]);

    let totalRooms = 0;
    let filled = 0;
    for (const d of days) {
      totalRooms += d.roomsRequired || 0;
      for (const a of d.assignments) {
        if (a.rosterId && a.role !== 'SUPERVISING_MD') filled += 1;
      }
    }
    const gapRate = totalRooms > 0 ? ((totalRooms - filled) / totalRooms) * 100 : null;
    const daysInMonth = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const backupShiftsPerDay = incentiveShifts > 0 ? incentiveShifts / daysInMonth : 0;

    res.json({
      month: req.query.month,
      schedulingGapRate: gapRate != null ? Math.round(gapRate * 10) / 10 : null,
      backupShiftsPerDay: Math.round(backupShiftsPerDay * 10) / 10,
      // Source-of-truth counts so the UI can show "based on 12 rooms, 11 filled"
      totalRooms,
      filledRooms: filled,
      incentiveShiftCount: incentiveShifts,
    });
  } catch (err) {
    if (err.message?.startsWith('month must be') || err.message === 'invalid month') {
      return res.status(400).json({ error: err.message });
    }
    console.error('[admin] roi auto-pull failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/roi/projection — prospect projection. Query: providerCount,
// monthlyProviderCost?, sourceFacilityId? (default = highest-savings).
router.get('/roi/projection/run', adminAuth, async (req, res) => {
  try {
    const providerCount = parseInt(req.query.providerCount, 10);
    if (!Number.isFinite(providerCount) || providerCount <= 0) {
      return res.status(400).json({ error: 'providerCount must be a positive integer' });
    }
    const monthlyProviderCost = req.query.monthlyProviderCost
      ? parseFloat(req.query.monthlyProviderCost) : null;

    let source;
    if (req.query.sourceFacilityId) {
      source = await prisma.facility.findUnique({
        where: { id: req.query.sourceFacilityId },
        select: { id: true, name: true, roiBaseline: true,
          roiSnapshots: { orderBy: { month: 'desc' }, take: 1 } },
      });
    } else {
      // Default: pick the customer with the highest monthly savings.
      const facilities = await prisma.facility.findMany({
        where: { roiBaseline: { isNot: null } },
        select: { id: true, name: true, roiBaseline: true,
          roiSnapshots: { orderBy: { month: 'desc' }, take: 1 } },
      });
      source = facilities
        .map((f) => ({ f, savings: roiCalc.computeSavings(f.roiBaseline, f.roiSnapshots[0]).totalMonthly }))
        .sort((a, b) => b.savings - a.savings)[0]?.f || null;
    }

    if (!source?.roiBaseline) {
      return res.status(409).json({ error: 'No customer baseline available to project from. Set one up first.' });
    }
    const projection = roiCalc.projectForProspect(
      source.roiBaseline,
      source.roiSnapshots[0] || null,
      { providerCount, monthlyProviderCost }
    );
    res.json({
      projection,
      sourceCustomer: { id: source.id, name: source.name },
      prospect: { providerCount, monthlyProviderCost },
    });
  } catch (err) {
    console.error('[admin] roi projection failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/roster/relink-all', adminAuth, async (req, res) => {
  try {
    const result = await reverseLinkAllOrphans();
    res.json(result);
  } catch (err) {
    console.error('[admin] relink-all failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Facility creation + invite (the proper enterprise onboarding flow) ────────
// Replaces /auth/facility/register. SNAP Admin creates the Facility in
// advance, then invites the coordinator(s). Full spec:
// snap-applications/capa-pilot/facility-invite-spec.md (locked 2026-06-09).

// POST /admin/facilities — create a new facility (and its subscription).
// Atomic via $transaction so we can never produce orphan-facility-without-
// subscription states like the old /auth/facility/register could.
router.post('/facilities', adminAuth, async (req, res) => {
  try {
    const { name, facilityType, address, zipCode, state, tier } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Facility name is required.' });
    }
    const facility = await prisma.$transaction(async (tx) => {
      return tx.facility.create({
        data: {
          name: name.trim(),
          facilityType: facilityType || null,
          address: address || null,
          zipCode: zipCode || null,
          state: state || 'MA',
          subscription: { create: { tier: tier || 'BASIC' } },
        },
        include: { subscription: true },
      });
    });
    res.status(201).json({
      ok: true,
      facility: {
        id: facility.id,
        name: facility.name,
        facilityType: facility.facilityType,
        address: facility.address,
        zipCode: facility.zipCode,
        state: facility.state,
        tier: facility.subscription?.tier || 'BASIC',
        createdAt: facility.createdAt,
      },
    });
  } catch (err) {
    console.error('[admin] create facility failed:', err);
    res.status(500).json({ error: 'Failed to create facility', details: err.message });
  }
});

// POST /admin/facilities/:id/invite — mint a FacilityInvite + send the email.
// Idempotent: if there's already an unclaimed, unexpired invite for the same
// email + facility, returns it instead of creating a duplicate. "Resend"
// uses the same path — the email gets re-fired for the existing token.
router.post('/facilities/:id/invite', adminAuth, async (req, res) => {
  try {
    const facilityId = req.params.id;
    const {
      email,
      facilityRole = 'ADMIN',
      expiresInDays = DEFAULT_INVITE_TTL_DAYS,
      recipientName: clientRecipientName,
    } = req.body || {};
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!ROLE_LABELS[facilityRole]) {
      return res.status(400).json({ error: `facilityRole must be one of ${Object.keys(ROLE_LABELS).join(', ')}` });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true, name: true },
    });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });

    // Resolve the recipient's first name for the email greeting ("Hi Ryan,").
    // Priority: explicit `recipientName` from the modal, falling back to the
    // email-prefix split on common separators ("ryan.smith@..." → "ryan").
    // No name is preferable to a wrong name — fall through to "there" if both
    // sources are empty.
    function deriveFromEmail(addr) {
      const prefix = (addr || '').split('@')[0];
      const first = (prefix || '').split(/[._-]/)[0];
      if (!first) return null;
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
    const recipientFirstName = (clientRecipientName && clientRecipientName.trim())
      ? clientRecipientName.trim().split(/\s+/)[0]
      : (deriveFromEmail(normalizedEmail) || 'there');

    // The inviter line in the email body simply names SNAP Medical — no per-
    // admin name surfaces ("SNAP Medical invited you…"). Keep `invitedByName`
    // populated on the DB row though, so the audit log knows who clicked.
    const inviter = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true },
    });
    const inviterName = inviter?.email || 'SNAP Medical admin';

    // Existing unclaimed invite for this email+facility? Reuse it (idempotent
    // resend).
    const existing = await prisma.facilityInvite.findFirst({
      where: {
        facilityId,
        email: normalizedEmail,
        claimedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    let invite, rawToken;
    if (existing) {
      // Reuse the existing invite. But we don't have the raw token — it was
      // never stored. Mint a new token + replace hash so the email still works.
      // (Alternative would be to keep the raw token in a separate secret store;
      // for now we treat "resend" as "issue fresh credentials.")
      rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      invite = await prisma.facilityInvite.update({
        where: { id: existing.id },
        data: {
          tokenHash,
          rawTokenPrefix: rawToken.substring(0, 8),
          expiresAt: new Date(Date.now() + expiresInDays * 86400000),
          invitedByAdminId: inviter?.id || null,
          invitedByName: inviterName,
        },
      });
    } else {
      rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      invite = await prisma.facilityInvite.create({
        data: {
          facilityId,
          email: normalizedEmail,
          facilityRole,
          tokenHash,
          rawTokenPrefix: rawToken.substring(0, 8),
          expiresAt: new Date(Date.now() + expiresInDays * 86400000),
          invitedByAdminId: inviter?.id || null,
          invitedByName: inviterName,
        },
      });
    }

    // Send the email. Fire-and-forget; we don't want a SendGrid hiccup to
    // block the response — the invite already exists in the DB.
    const claimLink = `${FACILITY_CLAIM_BASE}/facility-claim/${rawToken}`;
    const expiryDate = invite.expiresAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    sendFacilityInvite(
      normalizedEmail,
      recipientFirstName,  // resolved at top of handler: modal input || email derive || "there"
      facility.name,
      ROLE_LABELS[facilityRole],
      claimLink,
      expiryDate,
    ).catch((e) => console.error('[admin] facility invite email failed:', e.message));

    res.status(201).json({
      ok: true,
      invite: {
        id: invite.id,
        email: invite.email,
        facilityRole: invite.facilityRole,
        expiresAt: invite.expiresAt,
        resent: !!existing,
      },
    });
  } catch (err) {
    console.error('[admin] send facility invite failed:', err);
    res.status(500).json({ error: 'Failed to send invite', details: err.message });
  }
});

// GET /admin/facilities/:id/invites — list pending + claimed invites for a
// facility. Used by the admin UI to show "Pending invites" with resend/view.
router.get('/facilities/:id/invites', adminAuth, async (req, res) => {
  try {
    const invites = await prisma.facilityInvite.findMany({
      where: { facilityId: req.params.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        facilityRole: true,
        expiresAt: true,
        invitedByName: true,
        claimedAt: true,
        claimedByUserId: true,
        createdAt: true,
      },
    });
    const now = new Date();
    res.json(invites.map((i) => ({
      ...i,
      status: i.claimedAt ? 'CLAIMED' : (i.expiresAt < now ? 'EXPIRED' : 'PENDING'),
    })));
  } catch (err) {
    console.error('[admin] list invites failed:', err);
    res.status(500).json({ error: 'Failed to load invites' });
  }
});

// ── Recovery: attach an orphan User to a new Facility ─────────────────────────
// The /auth/facility/register endpoint creates User + Facility in two non-
// transactional steps. If the Facility create throws, the User row is left
// orphaned: login succeeds but no FacilityUser row exists, so the dashboard
// shows the null-fallback "your facility" text. This endpoint recovers that
// state by creating the Facility and attaching the existing User as ADMIN.
//
// Added 2026-06-09 to unblock Ryan's live demo. Body:
//   { facilityName, userEmail, facilityType?, address?, zipCode?, tier? }
router.post('/facility/create-and-attach', adminAuth, async (req, res) => {
  try {
    const { facilityName, userEmail, facilityType, address, zipCode, tier } = req.body || {};
    if (!facilityName || !userEmail) {
      return res.status(400).json({ error: 'facilityName and userEmail are both required' });
    }
    const user = await prisma.user.findUnique({ where: { email: userEmail.toLowerCase().trim() } });
    if (!user) {
      return res.status(404).json({ error: `No user found with email ${userEmail}` });
    }
    const existing = await prisma.facilityUser.findFirst({
      where: { userId: user.id },
      include: { facility: { select: { id: true, name: true } } },
    });
    if (existing) {
      return res.status(409).json({
        error: 'User already attached to a facility',
        existingFacility: existing.facility,
      });
    }
    const facility = await prisma.facility.create({
      data: {
        name: facilityName,
        facilityType: facilityType || null,
        address: address || null,
        zipCode: zipCode || null,
        state: 'MA',
        users: { create: { userId: user.id, facilityRole: 'ADMIN' } },
        subscription: { create: { tier: tier || 'BASIC' } },
      },
      include: { subscription: true, users: true },
    });
    // Make sure the user's role is FACILITY_USER (it should be already, but
    // belt-and-suspenders in case some prior orphan came from a different path).
    if (user.role !== 'FACILITY_USER') {
      await prisma.user.update({ where: { id: user.id }, data: { role: 'FACILITY_USER' } });
    }
    res.json({
      ok: true,
      message: 'User attached to new facility. Have them log out and back in.',
      facility: { id: facility.id, name: facility.name, tier: facility.subscription?.tier },
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error('[admin] create-and-attach failed:', err);
    res.status(500).json({ error: 'Failed to create + attach', details: err.message });
  }
});

// ── Diagnostic: SendGrid email test ────────────────────────────────────────────
// Temporary endpoint added 2026-06-08 to debug "emails not arriving" during the
// CAPA soft-launch prep. Returns the raw SendGrid response so we can see exactly
// what the provider is rejecting (or accepting). Safe to remove once email is
// confirmed working in production.
//
// Body: { to: "email@example.com", subject?: string }
// Returns: { ok, config, request, sendgrid: { statusCode, messageId } | error: {...} }
router.post('/email-test', adminAuth, async (req, res) => {
  const sgMail = require('@sendgrid/mail');
  const to = (req.body?.to || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Valid `to` email required in request body.' });
  }

  // Surface exactly what the backend is reading from env so we can confirm
  // Railway env vars are being picked up.
  const FROM = process.env.SENDGRID_FROM || 'noreply@snapmedical.com';
  const FROM_EMAIL_ALT = process.env.SENDGRID_FROM_EMAIL || null;
  const apiKey = process.env.SENDGRID_API_KEY || '';

  const config = {
    sendgridFrom: FROM,
    sendgridFromEmailAlt: FROM_EMAIL_ALT,
    sendgridApiKeySet: !!apiKey,
    sendgridApiKeyPrefix: apiKey ? `${apiKey.substring(0, 6)}…(len=${apiKey.length})` : null,
    nodeEnv: process.env.NODE_ENV || null,
  };

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      stage: 'precondition',
      error: 'SENDGRID_API_KEY is not set on the backend.',
      config,
    });
  }

  sgMail.setApiKey(apiKey);

  const stamp = new Date().toISOString();
  const subject = (req.body?.subject || '').trim() || `SNAP Medical diagnostic test · ${stamp}`;
  const msg = {
    to,
    from: FROM,
    subject,
    text:
      `This is a diagnostic test email triggered from /api/admin/email-test at ${stamp}.\n` +
      `If you received this in your inbox, SendGrid is configured correctly and the ` +
      `marketplace backend can send mail.\n\n— SNAP Medical`,
    html:
      `<p>This is a diagnostic test email triggered from <code>/api/admin/email-test</code> at <strong>${stamp}</strong>.</p>` +
      `<p>If you received this in your inbox, SendGrid is configured correctly and the ` +
      `marketplace backend can send mail.</p><p>— SNAP Medical</p>`,
  };

  try {
    const [response] = await sgMail.send(msg);
    return res.json({
      ok: true,
      stage: 'sent',
      config,
      request: { from: msg.from, to: msg.to, subject: msg.subject },
      sendgrid: {
        statusCode: response.statusCode,
        messageId: response.headers?.['x-message-id'] || null,
      },
    });
  } catch (err) {
    // sg returns rich error body; capture the whole thing so we can see
    // the exact rejection reason in the HTTP response.
    return res.status(502).json({
      ok: false,
      stage: 'sendgrid',
      config,
      request: { from: msg.from, to: msg.to, subject: msg.subject },
      error: {
        message: err.message,
        code: err.code || null,
        responseStatus: err.response?.statusCode || null,
        responseBody: err.response?.body || null,
      },
    });
  }
});

module.exports = router;
