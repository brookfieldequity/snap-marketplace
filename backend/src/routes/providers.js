const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const { aggregateProviderRatings, deriveProviderBadges } = require('../services/trust');
const { deleteProviderAccount } = require('../services/accountDeletion');
const { searchByName: nppesSearchByName } = require('../services/nppesLookup');
const { reverseLinkForProvider } = require('../services/rosterLink');
const passportClient = require('../services/passportClient');
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
    // hasRosterLink — whether any facility roster entry is linked to this
    // provider. The app uses it to pick the landing tab (roster-linked
    // providers land on My Schedule; marketplace-only providers on the feed).
    const rosterLink = await prisma.internalRosterEntry.findFirst({
      where: { linkedProviderId: profile.id },
      select: { id: true },
    });
    res.json({
      ...profile,
      rating: ratingMap.get(profile.id) || { avg: null, count: 0 },
      badges: deriveProviderBadges(profile, { completedShifts: profile._count?.bookings }),
      hasRosterLink: !!rosterLink,
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
      'expoPushToken', 'npiNumber',
    ];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    // NPI is the canonical cross-product identity key — validate and check
    // it isn't already claimed by another account before writing.
    if (updates.npiNumber !== undefined && updates.npiNumber !== null && updates.npiNumber !== '') {
      const npi = String(updates.npiNumber).replace(/\D/g, '');
      if (!/^\d{10}$/.test(npi)) {
        return res.status(400).json({ error: 'NPI must be a 10-digit number.' });
      }
      const taken = await prisma.providerProfile.findUnique({ where: { npiNumber: npi }, select: { userId: true } });
      if (taken && taken.userId !== req.user.userId) {
        return res.status(409).json({ error: 'This NPI is already on another SNAP account. Contact support if this is yours.' });
      }
      updates.npiNumber = npi;
    } else if (updates.npiNumber === '') {
      updates.npiNumber = null;
    }

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

    // A newly-added NPI may match roster rows imported before this account
    // existed — stitch immediately rather than waiting for the next login.
    if (updates.npiNumber) {
      reverseLinkForProvider({
        id: updated.id,
        userEmail: req.user.email,
        npiNumber: updated.npiNumber,
      }).catch((e) => console.error('[providers] reverse-link after NPI update failed:', e.message));
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── NPI self-lookup (NPPES) ───────────────────────────────────────────────────
//
// Providers rarely know their NPI by heart. Search the public NPPES registry
// by name so registration/profile completion can autofill it — the same
// service the roster importer uses, provider-facing. Unauthenticated on
// purpose: the Register wizard needs it before a token exists, NPPES data is
// public, and the service applies its own global throttle upstream.
router.get('/npi-lookup', async (req, res) => {
  try {
    const { firstName, lastName, state } = req.query;
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    const matches = await nppesSearchByName({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      state: state ? String(state).trim().toUpperCase() : 'MA',
      limit: 8,
    });
    res.json({ matches });
  } catch (err) {
    console.error('[providers] npi-lookup failed:', err.message);
    res.status(500).json({ error: 'NPI lookup failed. You can enter your NPI manually.' });
  }
});

// ── Claim a roster spot with an invite code ───────────────────────────────────
//
// POST /me/claim-roster { code } — self-service half of the identity bridge.
// The coordinator mints the code (roster routes POST /:id/generate-claim-code)
// and hands/texts it to the provider; entering it here links this account's
// ProviderProfile to that InternalRosterEntry.

router.post('/me/claim-roster', auth, async (req, res) => {
  try {
    const raw = typeof req.body?.code === 'string' ? req.body.code : '';
    const code = raw.replace(/[\s-]/g, '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'Enter your invite code.' });

    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      return res.status(400).json({ error: 'No provider profile found — complete your profile before linking a practice.' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true },
    });

    // No unique constraint on claimCode (Railway db-push safety) — findFirst
    // on code + unexpired expiry is the lookup.
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { claimCode: code, claimCodeExpiresAt: { gt: new Date() } },
      include: { facility: { select: { id: true, name: true } } },
    });
    if (!entry) {
      return res.status(404).json({ error: 'That code is invalid or has expired. Ask your coordinator for a new one.' });
    }

    if (entry.linkedProviderId && entry.linkedProviderId === profile.id) {
      // Idempotent: already linked to this account — just retire the code.
      await prisma.internalRosterEntry.update({
        where: { id: entry.id },
        data: { snapAccountLinked: true, claimCode: null, claimCodeExpiresAt: null },
      });
      return res.json({
        ok: true,
        alreadyLinked: true,
        facility: entry.facility,
        entry: { id: entry.id, providerName: entry.providerName },
      });
    }
    if (entry.linkedProviderId && entry.linkedProviderId !== profile.id) {
      return res.status(409).json({ error: 'This roster spot is already linked to a different SNAP account. Contact your coordinator.' });
    }

    // Sanity check: code possession alone is enough only when the roster row
    // carries no identity fields (the coordinator handed the code out
    // directly). Otherwise the row's NPI or email must match this account.
    const rosterNpi = (entry.npi || '').trim();
    const rosterEmail = (entry.snapAccountEmail || '').trim().toLowerCase();
    const npiMatch = !!(rosterNpi && profile.npiNumber && rosterNpi === profile.npiNumber.trim());
    const emailMatch = !!(rosterEmail && user?.email && rosterEmail === user.email.trim().toLowerCase());
    const neitherSet = !rosterNpi && !rosterEmail;
    if (!npiMatch && !emailMatch && !neitherSet) {
      return res.status(403).json({
        error: "This code doesn't match your account. Ask your coordinator to check the email or NPI on your roster entry.",
      });
    }

    const updated = await prisma.internalRosterEntry.update({
      where: { id: entry.id },
      data: {
        linkedProviderId: profile.id,
        snapAccountLinked: true,
        snapAccountEmail: user?.email || entry.snapAccountEmail,
        claimCode: null,
        claimCodeExpiresAt: null,
      },
    });

    res.json({
      ok: true,
      facility: entry.facility,
      entry: { id: updated.id, providerName: updated.providerName },
    });
  } catch (err) {
    console.error('[claim-roster] failed:', err);
    res.status(500).json({ error: 'Could not link your account. Try again.' });
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

    // Availability-request window status for the provider's linked roster
    // entries (the coordinator's monthly submission windows, normally reached
    // via the SMS token link). Lets the app show "Submitted ✓ — editable until
    // <deadline>" vs "Closes <date>" per facility. Non-critical — never fail
    // the availability load over it.
    let requestWindows = [];
    try {
      const rosterEntries = await prisma.internalRosterEntry.findMany({
        where: { linkedProviderId: profile.id },
        select: { id: true },
      });
      if (rosterEntries.length > 0) {
        // Every (year, month) pair the loaded date span touches.
        const months = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cursor <= end) {
          months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
          cursor.setMonth(cursor.getMonth() + 1);
        }
        const requests = await prisma.availabilityRequest.findMany({
          where: { rosterEntryId: { in: rosterEntries.map((r) => r.id) }, OR: months },
          include: { facility: { select: { id: true, name: true } } },
          orderBy: { deadline: 'asc' },
        });
        requestWindows = requests.map((r) => ({
          id: r.id,
          facility: r.facility,
          year: r.year,
          month: r.month,
          deadline: r.deadline,
          submittedAt: r.submittedAt,
          lastUpdatedAt: r.lastUpdatedAt,
        }));
      }
    } catch (winErr) {
      console.error('[availability] window status load failed:', winErr.message);
    }

    // NOTE: response used to be the bare array; the app already tolerates
    // { availability } (see mobile AvailabilityScreen loadAvailability).
    res.json({ availability, requestWindows });
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

    // Availability unification dual-write: mirror this app submission into any
    // open AvailabilityRequest (the SMS-link staging store) for the provider's
    // linked roster entries, so the coordinator's window tracking counts an
    // app save as "responded". Non-critical — never fail the save over it.
    try {
      await mirrorAvailabilityToRequests(profile.id, dates, clearDates);
    } catch (mirrorErr) {
      console.error('[availability] request mirror failed (availability still saved):', mirrorErr.message);
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

// ── My credentials (passport bridge) ─────────────────────────────────────────
// Read-only credential/expiry summary from the snap-credentialing passport for
// the mobile "My Credentials" card. Informational only — every "can't show it"
// case is a 200 with { available: false, reason } so the card degrades quietly
// instead of erroring the Profile screen:
//   no-npi               → provider hasn't added their NPI yet (card prompts)
//   no-passport          → NPI has no passport on the credentialing platform
//   bridge-unconfigured  → CREDENTIALING_API_KEY unset (local dev) — no-op
//   bridge-error         → cred backend unreachable / returned an error

router.get('/me/credentials', auth, async (req, res) => {
  try {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { npiNumber: true },
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (!profile.npiNumber) return res.json({ available: false, reason: 'no-npi' });
    if (!passportClient.isConfigured()) {
      return res.json({ available: false, reason: 'bridge-unconfigured' });
    }

    const summary = await passportClient.getProviderCredentialSummary(profile.npiNumber);
    if (!summary?.found) return res.json({ available: false, reason: 'no-passport' });

    res.json({
      available: true,
      provider: summary.provider,
      credentials: summary.credentials || [],
      completeness: summary.completeness || null,
      generatedAt: summary.generatedAt,
    });
  } catch (err) {
    console.error('[providers/me/credentials] bridge error:', err.message);
    res.json({ available: false, reason: 'bridge-error' });
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

/**
 * Availability unification (app → SMS-link staging store).
 *
 * For each InternalRosterEntry linked to this provider, find the
 * AvailabilityRequest rows (unique per facility+rosterEntry+year+month) that
 * cover the months the posted dates touch, and mirror the day-level values
 * into AvailDaySubmission. First mirror stamps submittedAt; every mirror
 * bumps lastUpdatedAt — so an app save counts as "responded" in the
 * coordinator's window tracking. Requests past their deadline are skipped
 * (matches the token link's own 410-after-deadline behavior).
 *
 * The app has no "maybe" concept: `maybe` is left untouched on rows we
 * update and set false on rows we create.
 */
async function mirrorAvailabilityToRequests(providerId, dates = [], clearDates = []) {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const cleanDates = dates
    .filter((d) => d && typeof d.date === 'string' && typeof d.available === 'boolean')
    .map((d) => ({ date: d.date.slice(0, 10), available: d.available, note: d.note }))
    .filter((d) => dateRe.test(d.date));
  const cleanClears = clearDates
    .filter((d) => typeof d === 'string')
    .map((d) => d.slice(0, 10))
    .filter((d) => dateRe.test(d));
  if (cleanDates.length === 0 && cleanClears.length === 0) return;

  const rosterEntries = await prisma.internalRosterEntry.findMany({
    where: { linkedProviderId: providerId },
    select: { id: true },
  });
  if (rosterEntries.length === 0) return;

  // Every (year, month) pair the posted dates touch.
  const monthKeys = new Set(
    [...cleanDates.map((d) => d.date), ...cleanClears].map((d) => d.slice(0, 7))
  );
  const monthPairs = [...monthKeys].map((k) => ({
    year: Number(k.slice(0, 4)),
    month: Number(k.slice(5, 7)),
  }));

  const requests = await prisma.availabilityRequest.findMany({
    where: { rosterEntryId: { in: rosterEntries.map((r) => r.id) }, OR: monthPairs },
  });
  if (requests.length === 0) return;

  const now = new Date();
  for (const request of requests) {
    if (new Date(request.deadline) < now) continue; // window closed — link would 410 too
    const inMonth = (ds) =>
      Number(ds.slice(0, 4)) === request.year && Number(ds.slice(5, 7)) === request.month;
    const upserts = cleanDates.filter((d) => inMonth(d.date));
    const clears = cleanClears.filter(inMonth);
    if (upserts.length === 0 && clears.length === 0) continue;

    const ops = upserts.map(({ date, available, note }) =>
      prisma.availDaySubmission.upsert({
        where: { requestId_date: { requestId: request.id, date: new Date(date + 'T00:00:00.000Z') } },
        create: {
          requestId: request.id,
          date: new Date(date + 'T00:00:00.000Z'),
          available,
          maybe: false,
          note: note ?? null,
        },
        update: { available, ...(note !== undefined ? { note: note || null } : {}) },
      })
    );
    if (clears.length > 0) {
      ops.push(
        prisma.availDaySubmission.deleteMany({
          where: {
            requestId: request.id,
            date: { in: clears.map((d) => new Date(d + 'T00:00:00.000Z')) },
          },
        })
      );
    }
    ops.push(
      prisma.availabilityRequest.update({
        where: { id: request.id },
        data: { submittedAt: request.submittedAt ?? now, lastUpdatedAt: now },
      })
    );
    // eslint-disable-next-line no-await-in-loop
    await prisma.$transaction(ops);
  }
}

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
