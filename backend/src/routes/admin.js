const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const adminAuth = require('../middleware/adminAuth');
const { sendWelcomeEmail, sendPasswordResetEmail, sendFacilityInvite } = require('../services/credentialEmail');
const scorecard = require('../services/scorecard');
const { accrueBookingFee, feeSummary } = require('../services/marketplaceFees');
const { buildNameKey } = require('../services/nameKey');
const { calculateStaffIQScore } = require('../utils/staffiqScore');
const normBizName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

    // Task #14: a provider's facility affiliations come from the internal
    // roster (InternalRosterEntry.linkedProviderId), NOT from owning the
    // provider — providers stay global identities (locked multi-facility
    // design). Resolve all memberships in one query, group by provider.
    const profileIds = providers.map((p) => p.id);
    const memberships = profileIds.length
      ? await prisma.internalRosterEntry.findMany({
          where: { linkedProviderId: { in: profileIds } },
          select: {
            linkedProviderId: true,
            facility: { select: { id: true, name: true } },
          },
        })
      : [];
    const affiliationsByProvider = {};
    for (const m of memberships) {
      const arr = (affiliationsByProvider[m.linkedProviderId] ||= []);
      if (m.facility && !arr.some((f) => f.id === m.facility.id)) {
        arr.push({ id: m.facility.id, name: m.facility.name });
      }
    }

    const now = new Date();
    const in90Days = new Date(now.getTime() + 90 * 86400000);
    const enriched = providers.map((p) => ({
      ...p,
      licenseExpiringSoon: p.maLicenseExpiry && new Date(p.maLicenseExpiry) <= in90Days,
      // Facilities whose roster this provider is linked to. Empty = marketplace-
      // only (no facility roster membership yet).
      affiliations: affiliationsByProvider[p.id] || [],
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[admin] providers list failed:', err);
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
        users: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, email: true } } },
        },
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

        // ── Credentialing-portal rows (children first) ────────────────────
        // Leaf tables all carry facilityId directly. ProviderCredential does
        // NOT — resolve those via the facility's FacilityRosterEntry ids.
        await tx.credentialAccessLog.deleteMany({ where: { facilityId } });
        await tx.credentialReminder.deleteMany({ where: { facilityId } });
        await tx.credentialFlag.deleteMany({ where: { facilityId } });
        await tx.facilityCredentialNote.deleteMany({ where: { facilityId } });
        await tx.credentialVerification.deleteMany({ where: { facilityId } });
        const credRosterIds = (await tx.facilityRosterEntry.findMany({
          where: { facilityId }, select: { id: true },
        })).map((r) => r.id);
        if (credRosterIds.length) {
          await tx.providerCredential.deleteMany({ where: { rosterId: { in: credRosterIds } } });
        }
        await tx.facilityRosterEntry.deleteMany({ where: { facilityId } });
        await tx.credentialUser.deleteMany({ where: { facilityId } });
      }

      // Capture the logins attached to this facility BEFORE removing the
      // membership links, so we can clean up coordinator accounts that become
      // orphaned by the delete (TEMPORARY test-teardown convenience).
      const attachedUserIds = force
        ? (await tx.facilityUser.findMany({ where: { facilityId }, select: { userId: true } })).map((x) => x.userId)
        : [];

      const fu = await tx.facilityUser.deleteMany({ where: { facilityId } });
      const sub = await tx.facilitySubscription.deleteMany({ where: { facilityId } });
      const fac = await tx.facility.delete({ where: { id: facilityId } });

      // Delete coordinator logins that are now orphaned: role FACILITY_USER with
      // zero remaining facility memberships. Never PROVIDER/ADMIN accounts, and
      // never an account still attached to another facility (e.g. an internal
      // anesthesiologist who is also on the real CAPA roster). Runs after
      // facility.delete so FacilityInvite rows (onDelete: Cascade) are already
      // gone and don't pin claimedByUserId.
      const loginsDeleted = [];
      for (const uid of attachedUserIds) {
        const remaining = await tx.facilityUser.count({ where: { userId: uid } });
        if (remaining > 0) continue;
        const u = await tx.user.findUnique({ where: { id: uid }, select: { email: true, role: true } });
        if (u && u.role === 'FACILITY_USER') {
          await tx.user.delete({ where: { id: uid } });
          loginsDeleted.push(u.email);
        }
      }

      return {
        facilityUsersDeleted: fu.count,
        loginsDeleted,
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
    console.error('[admin] update subscription failed:', err);
    res.status(500).json({ error: 'Failed to update subscription', details: err.message });
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
      // Position 1: accrue SNAP's platform fee now that the dispute is resolved
      // and the final shift value is known. Ledger-only (no charge yet).
      await accrueBookingFee(booking.id).catch((err) => console.error('accrueBookingFee:', err.message));
    }

    res.json(completion);
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// ── Marketplace fee ledger (Position 1) ─────────────────────────────────────────

router.get('/marketplace-fees/summary', adminAuth, async (req, res) => {
  try {
    res.json(await feeSummary());
  } catch (err) {
    console.error('[admin/marketplace-fees/summary]', err.message);
    res.status(500).json({ error: 'Failed to load fee summary' });
  }
});

router.get('/marketplace-fees', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await prisma.marketplaceFeeLedger.findMany({
      where: status ? { status } : undefined,
      orderBy: { accruedAt: 'desc' },
      take: 500,
      include: {
        facility: { select: { name: true } },
        booking: {
          select: {
            totalShiftValue: true,
            provider: { select: { firstName: true, lastName: true } },
            shift: { select: { date: true } },
          },
        },
      },
    });
    res.json({ fees: rows });
  } catch (err) {
    console.error('[admin/marketplace-fees]', err.message);
    res.status(500).json({ error: 'Failed to load marketplace fees' });
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

    // Tier prices repriced 2026-06-10 (Basic 2.5k / Pro 5k / Ent 10k; $750 retired).
    // Keep in sync with services/scorecard.js TIER_PRICE and the web pricing pages.
    const subscriptionRevenue = {
      BASIC: (subscriptions.find((s) => s.tier === 'BASIC')?._count.tier || 0) * 2500,
      PROFESSIONAL: (subscriptions.find((s) => s.tier === 'PROFESSIONAL')?._count.tier || 0) * 5000,
      ENTERPRISE: (subscriptions.find((s) => s.tier === 'ENTERPRISE')?._count.tier || 0) * 10000,
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

// ── Weekly Scorecard (EOS) — see docs/admin-scorecard-spec.md ───────────────────
// The seven numbers, composed from existing data + roiCalc + manual inputs.
router.get('/scorecard', adminAuth, async (req, res) => {
  try {
    res.json(await scorecard.getScorecard());
  } catch (err) {
    console.error('[scorecard] load failed:', err);
    res.status(500).json({ error: 'Failed to load scorecard' });
  }
});

// Set the manual inputs (MRR / pipeline / days-to-close / CAPA NPS).
router.post('/scorecard/manual', adminAuth, async (req, res) => {
  try {
    const { mrrMonthly, pipelineActive, avgDaysToClose, capaNps } = req.body || {};
    const saved = await scorecard.setManual(
      { mrrMonthly, pipelineActive, avgDaysToClose, capaNps },
      req.user?.email || null,
    );
    res.json(saved);
  } catch (err) {
    console.error('[scorecard] save manual failed:', err);
    res.status(500).json({ error: 'Failed to save scorecard inputs' });
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

// GET /staffiq/calibration — projected-vs-realized savings snapshots per
// facility (the accuracy record behind the hero number). Measurement only;
// auto-calibration stays OFF until turned on deliberately (see the Notion
// task "Turn ON StaffIQ auto-calibration").
router.get('/staffiq/calibration', adminAuth, async (req, res) => {
  try {
    const calibration = await require('../services/staffiqLearning').getSavingsCalibration();
    res.json(calibration);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load StaffIQ calibration' });
  }
});

// PATCH /staffiq/location-config/:facilityId — set per-site StaffIQ config
// (billing-model exclusions like CAPA's Shattuck, supervision-ratio overrides).
// Body: { location: "Shattuck", config: { excludeFromSavings, billingModel,
// reason, supervisionRatio } } — config: null removes the entry.
router.patch('/staffiq/location-config/:facilityId', adminAuth, async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { location, config } = req.body || {};
    if (!location || typeof location !== 'string') {
      return res.status(400).json({ error: 'location (string) is required' });
    }
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      select: { staffiqLocationConfig: true },
    });
    if (!facility) return res.status(404).json({ error: 'Facility not found' });

    const current = facility.staffiqLocationConfig || {};
    if (config == null) delete current[location];
    else current[location] = config;

    const updated = await prisma.facility.update({
      where: { id: facilityId },
      data: { staffiqLocationConfig: current },
      select: { id: true, staffiqLocationConfig: true },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update StaffIQ location config' });
  }
});

// POST /staffiq/calibration/snapshot — record an ad-hoc snapshot run for all
// facilities (the monthly cron does this automatically on the 1st).
router.post('/staffiq/calibration/snapshot', adminAuth, async (req, res) => {
  try {
    const result = await require('../services/staffiqLearning').recordSavingsSnapshots();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record StaffIQ snapshots' });
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

// POST /staffiq/pitch-projection — live first-meeting projection from prospect
// inputs (the "2-minute baseline"). Runs the SAME savings engine as the facility
// dashboard (staffiqLearning.projectFromInputs — one authority), persists
// nothing, and never fabricates data: insufficient inputs return an explicit
// 'insufficient' basis. Replaces the old CAPA-hardcoded /staffiq/facility-pitch.
router.post('/staffiq/pitch-projection', adminAuth, async (req, res) => {
  try {
    const projection = require('../services/staffiqLearning').projectFromInputs(req.body || {});
    res.json(projection);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute pitch projection' });
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

// ── Test-era cleanup: purge ALL marketplace provider accounts ──────────────────
// One-shot tool for clearing May-era test providers before the CAPA pilot.
// Deletes every User with role=PROVIDER plus their ProviderProfile and the
// full dependency tree (applications, bookings, completions, ratings,
// messages, availability, VIP logs, credentials). Also un-links any
// InternalRosterEntry soft pointers (linkedProviderId has no FK constraint,
// so without this step roster rows would point at ghosts and My Schedule
// linking would silently break for re-registering providers).
//
// Guarded by an explicit confirm string — this is irreversible and must
// NEVER run after real providers exist. Remove this endpoint alongside the
// other temporary admin tools once the pilot is live (task: retire
// self-register).
router.post('/providers/purge-all', adminAuth, async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE ALL PROVIDERS') {
      return res.status(400).json({
        error: 'Confirmation required. Pass { "confirm": "DELETE ALL PROVIDERS" } in the body.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const profiles = await tx.providerProfile.findMany({
        select: { id: true, userId: true },
      });
      const profileIds = profiles.map((p) => p.id);
      const userIds = profiles.map((p) => p.userId);
      if (profileIds.length === 0) {
        return { providersDeleted: 0, rosterRowsUnlinked: 0 };
      }

      // Children first. Completions/ratings reference bookings, so they go
      // before bookings.
      await tx.shiftCompletion.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.providerRating.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.facilityRating.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.shiftBooking.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.shiftApplication.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.message.deleteMany({ where: { senderId: { in: profileIds } } });
      await tx.providerAvailability.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.availabilitySubmission.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.vIPPointsLog.deleteMany({ where: { providerId: { in: profileIds } } });
      await tx.preferredProvider.deleteMany({ where: { providerId: { in: profileIds } } });
      // Credentialing-portal rows that reference the marketplace profile:
      // providerId is optional on both — null it rather than delete the rows,
      // since the cred-portal records may be facility-owned data.
      await tx.providerCredential.updateMany({
        where: { providerId: { in: profileIds } },
        data: { providerId: null },
      });
      await tx.facilityRosterEntry.updateMany({
        where: { providerId: { in: profileIds } },
        data: { providerId: null },
      });

      // Un-link internal roster soft pointers BEFORE deleting profiles.
      const unlinked = await tx.internalRosterEntry.updateMany({
        where: { linkedProviderId: { in: profileIds } },
        data: { linkedProviderId: null, snapAccountLinked: false },
      });

      await tx.providerProfile.deleteMany({ where: { id: { in: profileIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds }, role: 'PROVIDER' } });

      return {
        providersDeleted: profileIds.length,
        rosterRowsUnlinked: unlinked.count,
      };
    }, { timeout: 30000 });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] provider purge failed:', err);
    res.status(500).json({ error: 'Provider purge failed', details: err.message });
  }
});

// ── Facility creation + invite (the proper enterprise onboarding flow) ────────
// Replaces /auth/facility/register. SNAP Admin creates the Facility in
// advance, then invites the coordinator(s). Full spec:
// snap-applications/capa-pilot/facility-invite-spec.md (locked 2026-06-09).

// Facility.facilityType is a FacilityType enum (HOSPITAL | SURGERY_CENTER |
// OUTPATIENT | DENTAL | OTHER). Normalize any incoming value — including legacy
// free-form labels like "ASC"/"OFFICE_BASED" still sent by older clients — to a
// valid enum member, so a stray value can never blow up the create with a Prisma
// validation error. Blank/unknown → null (the column is optional).
function normalizeFacilityType(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toUpperCase();
  if (['HOSPITAL'].includes(v)) return 'HOSPITAL';
  if (['SURGERY_CENTER', 'ASC', 'SURGERY', 'SURGICAL', 'AMBULATORY_SURGERY_CENTER'].includes(v)) return 'SURGERY_CENTER';
  if (['OUTPATIENT', 'OFFICE_BASED', 'OFFICE', 'CLINIC', 'AMBULATORY'].includes(v)) return 'OUTPATIENT';
  if (['DENTAL'].includes(v)) return 'DENTAL';
  if (['OTHER'].includes(v)) return 'OTHER';
  return 'OTHER'; // unrecognized but non-empty → bucket as OTHER rather than 500
}

// POST /admin/facilities — create a new facility (and its subscription).
// Atomic via $transaction so we can never produce orphan-facility-without-
// subscription states like the old /auth/facility/register could.
router.post('/facilities', adminAuth, async (req, res) => {
  try {
    const { name, facilityType, address, zipCode, state, tier, snapMode } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Facility name is required.' });
    }
    const VALID_SNAPMODE = ['MARKETPLACE', 'SHIFTS', 'BOTH'];
    const facility = await prisma.$transaction(async (tx) => {
      return tx.facility.create({
        data: {
          name: name.trim(),
          facilityType: normalizeFacilityType(facilityType),
          address: address || null,
          zipCode: zipCode || null,
          state: state || 'MA',
          // Default to BOTH so facilities have marketplace access unless an
          // admin restricts it.
          snapMode: VALID_SNAPMODE.includes(snapMode) ? snapMode : 'BOTH',
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

// PATCH /admin/facilities/:id — edit a facility's core details after creation.
// Only the fields present in the body are changed. Tier is managed separately
// via /facilities/:id/subscription.
router.patch('/facilities/:id', adminAuth, async (req, res) => {
  try {
    const { name, facilityType, address, zipCode, state, snapMode } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'Facility name cannot be blank.' });
    }
    if (snapMode !== undefined && !['MARKETPLACE', 'SHIFTS', 'BOTH'].includes(snapMode)) {
      return res.status(400).json({ error: 'snapMode must be MARKETPLACE, SHIFTS, or BOTH.' });
    }
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (facilityType !== undefined) data.facilityType = normalizeFacilityType(facilityType);
    if (address !== undefined) data.address = address || null;
    if (zipCode !== undefined) data.zipCode = zipCode || null;
    if (state !== undefined) data.state = state || null;
    if (snapMode !== undefined) data.snapMode = snapMode;

    const facility = await prisma.facility.update({
      where: { id: req.params.id },
      data,
      include: { subscription: true },
    });
    res.json({
      ok: true,
      facility: {
        id: facility.id,
        name: facility.name,
        facilityType: facility.facilityType,
        address: facility.address,
        zipCode: facility.zipCode,
        state: facility.state,
        snapMode: facility.snapMode,
        tier: facility.subscription?.tier || 'BASIC',
      },
    });
  } catch (err) {
    console.error('[admin] edit facility failed:', err);
    res.status(500).json({ error: 'Failed to update facility', details: err.message });
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


// ── EOR employer-of-record setup + backfill ─────────────────────────────────
//
// Wires the rate firewall: ensures Employer records exist and tags a facility's
// roster rows with an employerId so services/rosterLens.js can strip agency
// payroll rates from the facility's lens.
//
// POST /admin/eor/tag
//   {
//     facilityId,                        // whose roster to tag (e.g. CAPA)
//     agencyName,                        // staffing-agency employer name (e.g. "APNE")
//     agencyOwnerFacilityId?,            // the agency's own SNAP facility account (set once it exists)
//     matchEmployerNames?: ["APNE"],     // roster rows whose free-form `employer` matches → agency
//     matchIs1099?: false,               // also treat is1099 rows as agency-employed
//     tagOwnStaff?: true,                 // tag the remaining rows to the facility's FACILITY_SELF employer
//   }
router.post('/eor/tag', adminAuth, async (req, res) => {
  try {
    const {
      facilityId,
      agencyName,
      agencyOwnerFacilityId = null,
      matchEmployerNames = [],
      matchIs1099 = false,
      // Tag rows whose provider also appears on this OTHER facility's roster
      // (the agency's own roster) — i.e. cross-match the same people by name /
      // business, so CAPA's APNE providers get tagged without manual labeling.
      matchAgencyRosterFacilityId = null,
      // Explicit roster-entry IDs to force-tag to the agency employer (used to
      // fix name-mismatch stragglers the audit surfaces).
      forceAgencyRosterEntryIds = [],
      tagOwnStaff = true,
    } = req.body || {};

    if (!facilityId) return res.status(400).json({ error: 'facilityId is required.' });

    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true, name: true } });
    if (!facility) return res.status(404).json({ error: 'Facility not found.' });

    // 1. Resolve the staffing-agency employer FIRST (STAFFING_AGENCY), if
    //    requested — it may itself own a facility account (the agency tenant).
    let agencyEmployer = null;
    if (agencyName) {
      agencyEmployer = await prisma.employer.findFirst({ where: { name: agencyName, kind: 'STAFFING_AGENCY' } });
      if (!agencyEmployer) {
        agencyEmployer = await prisma.employer.create({
          data: { name: agencyName, kind: 'STAFFING_AGENCY', ownerFacilityId: agencyOwnerFacilityId || null },
        });
      } else if (agencyOwnerFacilityId && agencyEmployer.ownerFacilityId !== agencyOwnerFacilityId) {
        // Link the agency to its own SNAP account once it exists (one-to-one).
        agencyEmployer = await prisma.employer.update({
          where: { id: agencyEmployer.id },
          data: { ownerFacilityId: agencyOwnerFacilityId },
        });
      }
    }

    // 2. Resolve this facility's own employer-of-record. If the facility IS the
    //    agency tenant (the agency employer already owns it), reuse that — don't
    //    create a second employer for the same ownerFacilityId (@unique).
    let selfEmployer = await prisma.employer.findUnique({ where: { ownerFacilityId: facility.id } });
    if (!selfEmployer) {
      selfEmployer = await prisma.employer.create({
        data: { name: facility.name || 'Facility', kind: 'FACILITY_SELF', ownerFacilityId: facility.id },
      });
    }

    // 2b. Optionally build a key set from the agency's OWN roster so we can
    //     cross-match the same providers on this facility's roster by name /
    //     business (no manual labeling needed).
    let agencyKeys = null;
    if (matchAgencyRosterFacilityId && agencyEmployer) {
      const agencyRoster = await prisma.internalRosterEntry.findMany({
        where: { facilityId: matchAgencyRosterFacilityId },
        select: { providerName: true, businessName: true },
      });
      agencyKeys = new Set();
      for (const e of agencyRoster) {
        const nk = buildNameKey(e.providerName); if (nk) agencyKeys.add(nk);
        const pn = normBizName(e.providerName); if (pn) agencyKeys.add(pn);
        if (e.businessName) agencyKeys.add(normBizName(e.businessName));
      }
    }

    // 3. Backfill employerId on the facility's roster.
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: facility.id },
      select: { id: true, providerName: true, businessName: true, employer: true, is1099: true, employerId: true },
    });
    const names = matchEmployerNames.map((n) => String(n).trim().toLowerCase());
    const forceSet = new Set(Array.isArray(forceAgencyRosterEntryIds) ? forceAgencyRosterEntryIds : []);
    let taggedAgency = 0;
    let taggedSelf = 0;
    for (const e of entries) {
      const empName = (e.employer || '').trim().toLowerCase();
      let isAgency = !!agencyEmployer && (forceSet.has(e.id) || (empName && names.includes(empName)) || (matchIs1099 && e.is1099 === true));
      // Cross-match against the agency's own roster (by name / business).
      if (!isAgency && agencyKeys) {
        const nk = buildNameKey(e.providerName);
        const pn = normBizName(e.providerName);
        const bz = e.businessName ? normBizName(e.businessName) : null;
        if ((nk && agencyKeys.has(nk)) || (pn && agencyKeys.has(pn)) || (bz && agencyKeys.has(bz))) isAgency = true;
      }
      const targetId = isAgency ? agencyEmployer.id : (tagOwnStaff ? selfEmployer.id : null);
      if (!targetId || e.employerId === targetId) continue;
      // eslint-disable-next-line no-await-in-loop
      await prisma.internalRosterEntry.update({ where: { id: e.id }, data: { employerId: targetId } });
      if (isAgency) taggedAgency += 1; else taggedSelf += 1;
    }

    res.json({
      facility: facility.name,
      selfEmployerId: selfEmployer.id,
      agencyEmployer: agencyEmployer ? { id: agencyEmployer.id, name: agencyEmployer.name, ownerFacilityId: agencyEmployer.ownerFacilityId } : null,
      taggedAgency,
      taggedSelf,
      scanned: entries.length,
    });
  } catch (err) {
    console.error('[admin] eor/tag failed:', err);
    res.status(500).json({ error: 'Failed to tag employer-of-record.' });
  }
});


// GET /admin/eor/audit/:facilityId?agencyOwnerFacilityId=... — read-only
// firewall check for a facility. Reports whether any provider the facility
// would see still exposes a payroll rate that belongs to the agency (a leak),
// using the same lens rule as services/rosterLens.js (a card's payroll is
// hidden from this facility only when it's tagged to an employer the facility
// does NOT own).
router.get('/eor/audit/:facilityId', adminAuth, async (req, res) => {
  try {
    const facilityId = req.params.facilityId;
    const { agencyOwnerFacilityId } = req.query;
    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true, name: true } });
    if (!facility) return res.status(404).json({ error: 'Facility not found.' });

    const cards = await prisma.internalRosterEntry.findMany({
      where: { facilityId },
      select: {
        id: true, providerName: true, businessName: true,
        hourlyRate: true, annualRate: true, contractorPayRate: true,
        employerRef: { select: { name: true, kind: true, ownerFacilityId: true } },
      },
    });

    // Build the agency's roster fingerprints so we can spot agency providers on
    // this roster even if their card wasn't tagged (name-mismatch stragglers).
    let agencyKeys = null;
    if (agencyOwnerFacilityId) {
      const agencyRoster = await prisma.internalRosterEntry.findMany({
        where: { facilityId: agencyOwnerFacilityId },
        select: { providerName: true, businessName: true },
      });
      agencyKeys = new Set();
      for (const e of agencyRoster) {
        const nk = buildNameKey(e.providerName); if (nk) agencyKeys.add(nk);
        const pn = normBizName(e.providerName); if (pn) agencyKeys.add(pn);
        if (e.businessName) agencyKeys.add(normBizName(e.businessName));
      }
    }
    const hasPay = (c) => c.hourlyRate != null || c.annualRate != null || c.contractorPayRate != null;
    const matchesAgency = (c) => {
      if (!agencyKeys) return false;
      const nk = buildNameKey(c.providerName);
      const pn = normBizName(c.providerName);
      const bz = c.businessName ? normBizName(c.businessName) : null;
      return (nk && agencyKeys.has(nk)) || (pn && agencyKeys.has(pn)) || (bz && agencyKeys.has(bz));
    };
    // Firewalled = tagged to an employer this facility does NOT own (payroll hidden).
    const firewalled = (c) => !!c.employerRef && c.employerRef.ownerFacilityId !== facilityId;

    let taggedAgency = 0, taggedSelf = 0, untagged = 0;
    let cardsWithPayroll = 0, firewalledWithPayroll = 0;
    const leaks = [];
    for (const c of cards) {
      if (!c.employerRef) untagged += 1;
      else if (c.employerRef.ownerFacilityId === facilityId) taggedSelf += 1;
      else taggedAgency += 1;
      if (hasPay(c)) cardsWithPayroll += 1;
      if (firewalled(c) && hasPay(c)) firewalledWithPayroll += 1;
      // Leak: this facility WOULD see a payroll rate for someone who is actually
      // an agency provider.
      if (!firewalled(c) && hasPay(c) && matchesAgency(c)) {
        leaks.push({ id: c.id, name: c.businessName || c.providerName, hourlyRate: c.hourlyRate, annualRate: c.annualRate, contractorPayRate: c.contractorPayRate });
      }
    }

    res.json({
      facility: facility.name,
      totalCards: cards.length,
      taggedToAgency: taggedAgency,
      taggedToSelf: taggedSelf,
      untagged,
      cardsWithAnyPayrollRate: cardsWithPayroll,
      firewalledWithPayroll,
      leakCount: leaks.length,
      potentialLeaks: leaks,
    });
  } catch (err) {
    console.error('[admin] eor/audit failed:', err);
    res.status(500).json({ error: 'Audit failed', details: err.message });
  }
});


// ── Demo mode ─────────────────────────────────────────────────────────────────
// Seed a fictional "Maple Ridge ASC" facility with pre-loaded data so a rep
// can launch a polished 10-minute demo without touching any real onboarding.
// POST /demo/seed   — idempotent: wipes + recreates all demo data
// GET  /demo/status — is it seeded, and what does the savings number look like
// POST /demo/launch — returns a 24h facility token + portal URL

const DEMO_EMAILS = [
  'demo.coordinator@snapmedical.app',
  'demo.crna1@snapmedical.app',
  'demo.crna2@snapmedical.app',
  'demo.anes1@snapmedical.app',
];

function demoDay(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get('/demo/status', adminAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findFirst({ where: { isDemo: true } });
    if (!facility) return res.json({ seeded: false });
    const [shiftCount, recordCount, input] = await Promise.all([
      prisma.shift.count({ where: { facilityId: facility.id } }),
      prisma.schedulingRecord.count({ where: { facilityId: facility.id } }),
      prisma.staffIQInput.findFirst({ where: { facilityId: facility.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({
      seeded: true,
      facilityId: facility.id,
      shifts: shiftCount,
      schedulingRecords: recordCount,
      staffiqScore: input?.staffiqScore,
      projectedMonthlySavings: input
        ? Math.round((input.inefficiency1Cost + input.inefficiency2Cost) / 12)
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/demo/seed', adminAuth, async (req, res) => {
  try {
    // ── Teardown ──────────────────────────────────────────────────────────────
    const existing = await prisma.facility.findFirst({ where: { isDemo: true } });
    if (existing) {
      const fid = existing.id;
      const shifts = await prisma.shift.findMany({ where: { facilityId: fid }, select: { id: true } });
      const shiftIds = shifts.map((s) => s.id);
      const bookings = await prisma.shiftBooking.findMany({ where: { shiftId: { in: shiftIds } }, select: { id: true } });
      const bookingIds = bookings.map((b) => b.id);
      await prisma.providerRating.deleteMany({ where: { OR: [{ facilityId: fid }, { bookingId: { in: bookingIds } }] } });
      await prisma.shiftBooking.deleteMany({ where: { shiftId: { in: shiftIds } } });
      await prisma.shift.deleteMany({ where: { facilityId: fid } });
      await prisma.internalIncentiveShift.deleteMany({ where: { facilityId: fid } });
      await prisma.schedulingRecord.deleteMany({ where: { facilityId: fid } });
      await prisma.staffIQInput.deleteMany({ where: { facilityId: fid } });
      await prisma.scheduleAssignment.deleteMany({ where: { facilityId: fid } });
      await prisma.scheduleDay.deleteMany({ where: { facilityId: fid } });
      await prisma.internalRosterEntry.deleteMany({ where: { facilityId: fid } });
      await prisma.facilitySiteRate.deleteMany({ where: { facilityId: fid } });
      await prisma.facilityUser.deleteMany({ where: { facilityId: fid } });
      await prisma.credentialUser.deleteMany({ where: { facilityId: fid } });
      await prisma.facility.delete({ where: { id: fid } });
    }
    for (const email of DEMO_EMAILS) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.providerProfile.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }

    // ── Facility ──────────────────────────────────────────────────────────────
    const facility = await prisma.facility.create({
      data: {
        name: 'Maple Ridge ASC',
        facilityType: 'SURGERY_CENTER',
        address: '150 Cabot St',
        zipCode: '01915',
        state: 'MA',
        snapMode: 'BOTH',
        isDemo: true,
        description: 'A 10-OR ambulatory surgery center serving Boston\'s North Shore. Demo facility — seeded data only.',
      },
    });

    const pwHash = await bcrypt.hash('demo1234', 10);
    const coordUser = await prisma.user.create({
      data: { email: 'demo.coordinator@snapmedical.app', password: pwHash, role: 'FACILITY_USER' },
    });
    await prisma.facilityUser.create({
      data: { userId: coordUser.id, facilityId: facility.id, facilityRole: 'COORDINATOR' },
    });
    // Credentialing-portal login for the demo (same email + demo1234). A
    // stale row can survive from a prior demo facility whose teardown never
    // ran — email is unique, so clear it first.
    await prisma.credentialUser.deleteMany({ where: { email: 'demo.coordinator@snapmedical.app' } });
    await prisma.credentialUser.create({
      data: {
        facilityId: facility.id,
        name: 'Demo Coordinator',
        email: 'demo.coordinator@snapmedical.app',
        passwordHash: pwHash,
        permission: 'COORDINATOR',
        isActive: true,
        forcePasswordChange: false,
      },
    });

    // ── StaffIQ inputs ────────────────────────────────────────────────────────
    const inputData = {
      totalLocations: 1,
      avgRoomsPerDay: 10,
      ftAnesthesiologists: 4,
      ftCrnas: 8,
      pdAnesthesiologistsPerMonth: 2,
      pdCrnasPerMonth: 3,
      agencyAnesthesiologistsPerMonth: 3,
      agencyCrnasPerMonth: 5,
      avgAnesthesiologistRate: 390,
      avgCrnaRate: 260,
      avgShiftHours: 10,
      operatingDaysPerYear: 250,
      primaryTeamModel: '1:2',
    };
    const computed = calculateStaffIQScore(inputData);
    await prisma.staffIQInput.create({
      data: {
        facilityId: facility.id,
        ...inputData,
        staffiqScore: computed.score,
        inefficiency1Pct: computed.inefficiency1Pct,
        inefficiency2Pct: computed.inefficiency2Pct,
        inefficiency1Cost: computed.inefficiency1Cost,
        inefficiency2Cost: computed.inefficiency2Cost,
        totalBudget: computed.totalBudget,
      },
    });

    // ── Providers ─────────────────────────────────────────────────────────────
    const makeProvider = async (email, firstName, lastName, specialty, years, credentialed, vipPoints) => {
      const user = await prisma.user.create({ data: { email, password: pwHash, role: 'PROVIDER' } });
      return prisma.providerProfile.create({
        data: {
          userId: user.id, firstName, lastName, specialty, yearsExperience: years,
          state: 'MA', credentialed, vipPoints,
          vipStatus: vipPoints >= 200,
          personalStatement: credentialed
            ? `Board-certified with ${years} years of experience. Credentialed across 6 Massachusetts facilities.`
            : `${years} years of clinical experience. NBCRNA certified.`,
        },
      });
    };
    const sarah   = await makeProvider('demo.crna1@snapmedical.app',  'Sarah',   'Chen',    'CRNA',               8,  true,  720);
    const michael = await makeProvider('demo.crna2@snapmedical.app',  'Michael', 'Torres',  'CRNA',               5,  false, 340);
    /* const drPark = */ await makeProvider('demo.anes1@snapmedical.app', 'James',   'Park',    'ANESTHESIOLOGIST',  14, true,  890);

    // ── Marketplace shifts ────────────────────────────────────────────────────
    const mkShift = (specialty, offsetDays, startTime, hours, rate, status) =>
      prisma.shift.create({
        data: {
          facilityId: facility.id, specialty, status,
          date: demoDay(offsetDays), startTime, durationHours: hours,
          baseRate: rate, currentRate: rate, estimatedTotal: rate * hours,
        },
      });

    await mkShift('CRNA', 3, '07:00', 10, 270, 'LIVE');
    await mkShift('CRNA', 5, '07:00', 10, 260, 'LIVE');
    await mkShift('ANESTHESIOLOGIST', 8, '07:30', 9, 380, 'LIVE');

    const filledShift = await mkShift('CRNA', 1, '07:00', 10, 270, 'FILLED');
    const filledBooking = await prisma.shiftBooking.create({
      data: {
        shiftId: filledShift.id, providerId: sarah.id,
        providerHourlyRate: 270, shiftDurationHours: 10, totalShiftValue: 2700,
        platformFeePercent: 10, platformFeeAmount: 270, paymentStatus: 'PENDING',
        confirmedAt: new Date(),
      },
    });
    void filledBooking; // referenced by escalation below

    const completedShift = await mkShift('CRNA', -5, '07:00', 10, 260, 'COMPLETED');
    const completedBooking = await prisma.shiftBooking.create({
      data: {
        shiftId: completedShift.id, providerId: michael.id,
        providerHourlyRate: 260, shiftDurationHours: 10, totalShiftValue: 2600,
        platformFeePercent: 10, platformFeeAmount: 260, paymentStatus: 'PAID',
        confirmedAt: demoDay(-7), completedAt: demoDay(-5),
      },
    });
    await prisma.providerRating.create({
      data: {
        facilityId: facility.id, providerId: michael.id, bookingId: completedBooking.id,
        stars: 5, notes: 'Arrived on time, fit right in with our team. Would book again.',
      },
    });

    // ── Gap story: internal incentive that escalated → marketplace ────────────
    await prisma.internalIncentiveShift.create({
      data: {
        facilityId: facility.id,
        shiftDate: demoDay(-2), startTime: '07:00', durationHours: 10,
        facilityLocation: 'OR-3', incentiveRate: 285,
        isIncentive: true, providerTypeRequired: 'CRNA',
        responseDeadline: demoDay(-4), status: 'ESCALATED',
        escalatedToMarketplace: true, escalationApprovedAt: demoDay(-3),
        escalationApprovedBy: 'Coordinator', marketplaceShiftId: filledShift.id,
      },
    });

    // ── Scheduling records (30 weekdays) ──────────────────────────────────────
    const rosterNames = [
      { name: 'Chen, S.',      type: 'CRNA',      rate: 260 },
      { name: 'Torres, M.',    type: 'CRNA',      rate: 260 },
      { name: 'Williams, K.',  type: 'CRNA',      rate: 260 },
      { name: 'Johnson, L.',   type: 'CRNA',      rate: 260 },
      { name: 'Brown, A.',     type: 'CRNA',      rate: 260 },
      { name: 'Davis, P.',     type: 'CRNA',      rate: 260 },
      { name: 'Martinez, C.',  type: 'CRNA',      rate: 260 },
      { name: 'Park, J.',      type: 'Physician', rate: 390 },
      { name: 'Smith, R.',     type: 'Physician', rate: 390 },
      { name: 'Agency CRNA',   type: 'CRNA',      rate: 290 },
    ];
    const orLocations = ['OR-1','OR-2','OR-3','OR-4','OR-5','OR-6','OR-7','OR-8','OR-9','OR-10'];
    const caseTypes   = ['General','Ortho','GYN','ENT','Cardiac','Neuro'];
    const records = [];
    for (let day = -42; day <= -1; day++) {
      const d = demoDay(day);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const rooms = dow === 5 ? 6 : 10; // Fridays run lighter
      for (let r = 0; r < rooms; r++) {
        const p = rosterNames[r % rosterNames.length];
        records.push({
          facilityId: facility.id,
          providerName: p.name, providerType: p.type,
          shiftDate: d, startTime: '07:00', endTime: '17:00', durationHours: 10,
          facilityLocation: orLocations[r], caseType: caseTypes[r % caseTypes.length],
          rate: p.rate, dayOfWeek: dow,
        });
      }
    }
    await prisma.schedulingRecord.createMany({ data: records });

    // ── Site rates ────────────────────────────────────────────────────────────
    await prisma.facilitySiteRate.createMany({
      data: [
        { facilityId: facility.id, siteName: 'Main OR',    ratePerDay: 3900 },
        { facilityId: facility.id, siteName: 'Endo Suite', ratePerDay: 2800 },
      ],
    });

    // ── Internal roster ───────────────────────────────────────────────────────
    // Six providers carry reserved 9999… demo NPIs — the join key to the demo
    // passport cohort seeded on the credentialing side (see demoSeedPassports
    // below). Their credentialingStatus reflects the demo story: CLAIMED for
    // granted passports, INVITED for the request-access flow (Lee).
    const rosterDefs = [
      { providerName: 'Chen, Sarah',      providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 260, allInCostPerHour: 310, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000101', credentialingStatus: 'CLAIMED', snapAccountEmail: 'demo.passport.chen@snapmedical.app' },
      { providerName: 'Torres, Michael',  providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 260, allInCostPerHour: 310, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000102', credentialingStatus: 'CLAIMED', snapAccountEmail: 'demo.passport.torres@snapmedical.app' },
      { providerName: 'Williams, Karen',  providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 260, allInCostPerHour: 310, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000104', credentialingStatus: 'CLAIMED', snapAccountEmail: 'demo.passport.williams@snapmedical.app' },
      { providerName: 'Johnson, Lisa',    providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 255, allInCostPerHour: 305, employer: 'APNE', preferredShiftLength: '10hr' },
      { providerName: 'Brown, Amanda',    providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 255, allInCostPerHour: 305, employer: 'APNE', preferredShiftLength: '10hr' },
      { providerName: 'Davis, Patricia',  providerType: 'CRNA',             employmentCategory: 'PER_DIEM',  hourlyRate: 270, allInCostPerHour: 270, employer: 'APNE', preferredShiftLength: '10hr' },
      { providerName: 'Martinez, Carlos', providerType: 'CRNA',             employmentCategory: 'PER_DIEM',  hourlyRate: 270, allInCostPerHour: 270, employer: 'APNE', preferredShiftLength: '10hr' },
      { providerName: 'Thompson, David',  providerType: 'CRNA',             employmentCategory: 'FULL_TIME', hourlyRate: 258, allInCostPerHour: 308, employer: 'APNE', preferredShiftLength: '10hr' },
      { providerName: 'Anderson, Rachel', providerType: 'CRNA',             employmentCategory: 'LOCUMS',    hourlyRate: 285, allInCostPerHour: 420, employer: 'Agency', contractStart: demoDay(-60), contractEnd: demoDay(90) },
      { providerName: 'Park, James',      providerType: 'ANESTHESIOLOGIST', employmentCategory: 'FULL_TIME', hourlyRate: 390, allInCostPerHour: 460, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000103', credentialingStatus: 'CLAIMED', snapAccountEmail: 'demo.passport.park@snapmedical.app' },
      { providerName: 'Smith, Robert',    providerType: 'ANESTHESIOLOGIST', employmentCategory: 'FULL_TIME', hourlyRate: 390, allInCostPerHour: 460, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000105', credentialingStatus: 'CLAIMED', snapAccountEmail: 'demo.passport.smith@snapmedical.app' },
      { providerName: 'Lee, Jennifer',    providerType: 'ANESTHESIOLOGIST', employmentCategory: 'PER_DIEM',  hourlyRate: 400, allInCostPerHour: 400, employer: 'APNE', preferredShiftLength: '10hr', npi: '9999000106', credentialingStatus: 'INVITED', inviteSentAt: demoDay(-3), snapAccountEmail: 'demo.passport.lee@snapmedical.app' },
    ];
    const rosterEntries = [];
    for (const def of rosterDefs) {
      const entry = await prisma.internalRosterEntry.create({ data: { facilityId: facility.id, ...def } });
      rosterEntries.push(entry);
    }
    const crnas = rosterEntries.filter((e) => e.providerType === 'CRNA');
    const mds   = rosterEntries.filter((e) => e.providerType === 'ANESTHESIOLOGIST');

    // ── Schedule days + assignments (past 2 weeks + next week) ────────────────
    // Team model is 1:2 (what StaffIQ flags as suboptimal) — 1 MD per 2 CRNAs.
    // Main OR: 10 rooms = 5 MD + 10 CRNA slots; Endo Suite: 2 CRNA rooms.
    const weekdayOffsets = [];
    for (let d = -14; d <= 5; d++) {
      const dt = demoDay(d);
      const dow = dt.getDay();
      if (dow !== 0 && dow !== 6) weekdayOffsets.push(d);
    }

    for (const offset of weekdayOffsets) {
      const date = demoDay(offset);
      const isPast = offset < 0;

      // Main OR — 10 rooms, supervision ratio 2 (1:2 model)
      const mainDay = await prisma.scheduleDay.create({
        data: {
          facilityId: facility.id,
          date,
          location: 'Main OR',
          roomsRequired: 10,
          supervisionRatio: 2,
          publishedAt: isPast || offset <= 2 ? new Date() : null,
        },
      });
      const mainAssignments = [];
      for (let room = 1; room <= 10; room++) {
        mainAssignments.push({
          scheduleDayId: mainDay.id,
          facilityId: facility.id,
          roomNumber: room,
          rosterId: crnas[(room - 1) % crnas.length].id,
          role: 'CRNA_ROOM',
        });
      }
      // Supervising MDs at roomNumber 901-905 (5 MDs for 10 CRNA rooms at 1:2)
      for (let m = 0; m < 5; m++) {
        mainAssignments.push({
          scheduleDayId: mainDay.id,
          facilityId: facility.id,
          roomNumber: 900 + m + 1,
          rosterId: mds[m % mds.length].id,
          role: 'SUPERVISING_MD',
        });
      }
      await prisma.scheduleAssignment.createMany({ data: mainAssignments });

      // Endo Suite — 2 rooms, CRNA-only
      const endoDay = await prisma.scheduleDay.create({
        data: {
          facilityId: facility.id,
          date,
          location: 'Endo Suite',
          roomsRequired: 2,
          supervisionRatio: null,
          publishedAt: isPast || offset <= 2 ? new Date() : null,
        },
      });
      await prisma.scheduleAssignment.createMany({
        data: [
          { scheduleDayId: endoDay.id, facilityId: facility.id, roomNumber: 1, rosterId: crnas[5].id, role: 'CRNA_ROOM' },
          { scheduleDayId: endoDay.id, facilityId: facility.id, roomNumber: 2, rosterId: crnas[6].id, role: 'CRNA_ROOM' },
        ],
      });
    }

    // ── Credentialing demo cohort (passport side, via the bridge) ────────────
    // Seeds fake passports on the credentialing service granted to this demo
    // facility, so the credentialing portal demos populated (roster passports,
    // expiry watchlist, request-access flow). Non-fatal: an unconfigured or
    // down bridge still yields a working shifts/StaffIQ demo.
    let credentialing = { seeded: false };
    const passportClient = require('../services/passportClient');
    if (passportClient.isConfigured()) {
      try {
        const seedResult = await passportClient.demoSeedPassports(facility.id, facility.name);
        credentialing = { seeded: true, providers: seedResult.providers?.length ?? 0 };
      } catch (err) {
        console.error('[admin] demo passport seed failed (demo still usable):', err.message);
        credentialing = { seeded: false, error: err.message };
      }
    } else {
      credentialing = { seeded: false, error: 'passport bridge not configured' };
    }

    res.json({
      ok: true,
      facilityId: facility.id,
      staffiqScore: computed.score,
      projectedMonthlySavings: Math.round((computed.inefficiency1Cost + computed.inefficiency2Cost) / 12),
      schedulingRecords: records.length,
      rosterEntries: rosterEntries.length,
      scheduleDays: weekdayOffsets.length * 2,
      credentialing,
    });
  } catch (err) {
    console.error('[admin] demo/seed failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/demo/launch', adminAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findFirst({ where: { isDemo: true } });
    if (!facility) return res.status(404).json({ error: 'Demo not seeded — run POST /admin/demo/seed first' });
    const coordUser = await prisma.user.findUnique({ where: { email: 'demo.coordinator@snapmedical.app' } });
    if (!coordUser) return res.status(404).json({ error: 'Demo coordinator account not found' });
    // Session-backed like every other token (Security HIGH-1); 24h demo window.
    const { issueSession } = require('../services/authSessions');
    const { jti } = await issueSession({ audience: 'FACILITY', userId: coordUser.id, req, ttlMs: 24 * 60 * 60 * 1000 });
    const token = jwt.sign(
      { userId: coordUser.id, role: 'FACILITY_USER', jti },
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
    );
    const baseUrl = process.env.FACILITY_CLAIM_BASE || 'https://sublime-flexibility-production-4f52.up.railway.app';
    res.json({ token, url: `${baseUrl}/?demoToken=${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Revoke a user's sessions (support kill switch) ──────────────────────────────
// POST /admin/users/:id/revoke-sessions — signs the user out everywhere
// (all portals + mobile). Use when offboarding a coordinator or responding to
// a suspected credential compromise.
router.post('/users/:id/revoke-sessions', adminAuth, async (req, res) => {
  try {
    const { revokeAllForUser } = require('../services/authSessions');
    const revoked = await revokeAllForUser(req.params.id);
    res.json({ ok: true, revoked });
  } catch (err) {
    console.error('[admin] revoke-sessions failed:', err.message);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

module.exports = router;
