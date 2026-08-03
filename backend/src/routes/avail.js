// Public provider-availability self-submission route.
// No authentication — the token embedded in the URL is the credential.
//
// GET  /api/avail/:token          — load request + existing submissions
// POST /api/avail/:token/submit   — save/replace submissions for the month
const express = require('express');
const prisma = require('../config/db');

const router = express.Router();

// Month names for display
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Load request + existing day-level submissions.
// Returns 404 when the token is unknown, 200 with isLocked when past deadline.
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const request = await prisma.availabilityRequest.findUnique({
      where: { token },
      include: {
        facility: { select: { name: true } },
        rosterEntry: { select: { providerName: true, linkedProviderId: true } },
        daySubmissions: {
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' });
    }

    const now = new Date();
    const isLocked = now > new Date(request.deadline);

    // Derive a friendly first name from providerName. Rosters store
    // "Last, First" — greet with the part AFTER the comma ("Hi Rachel"),
    // never "Hi Anderson," (E2E finding, 8/3).
    const fullName = request.rosterEntry?.providerName || '';
    const providerFirstName = (fullName.includes(',')
      ? (fullName.split(',')[1] || '').trim().split(/\s+/)[0]
      : fullName.split(/\s+/)[0]) || fullName.replace(/,/g, '').trim();

    let submissions = request.daySubmissions.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      available: s.available,
      maybe: s.maybe || false,
      note: s.note || null,
    }));

    // Availability unification: if this roster row is linked to a SNAP app
    // account, prefill from the provider's app calendar too, so both surfaces
    // show the same month. The link's own staged submissions win where both
    // exist for a date.
    if (request.rosterEntry?.linkedProviderId) {
      const monthStart = new Date(Date.UTC(request.year, request.month - 1, 1));
      const monthEnd = new Date(Date.UTC(request.year, request.month, 1));
      const appRows = await prisma.providerAvailability.findMany({
        where: {
          providerId: request.rosterEntry.linkedProviderId,
          date: { gte: monthStart, lt: monthEnd },
        },
      });
      if (appRows.length > 0) {
        const byDate = new Map(
          appRows.map((r) => [
            r.date.toISOString().slice(0, 10),
            {
              date: r.date.toISOString().slice(0, 10),
              available: r.available,
              maybe: false,
              note: r.note || null,
            },
          ])
        );
        for (const s of submissions) byDate.set(s.date, s); // link submissions win
        submissions = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
      }
    }

    // Facility-entered PTO (RosterTimeOff — the authoritative time-off table)
    // covering this month. These days render as locked "PTO" cells on the
    // link page: the coordinator's PTO calendar is the source of truth, so a
    // provider can't accidentally re-mark a booked PTO day as available.
    let ptoDates = [];
    try {
      const mStart = new Date(Date.UTC(request.year, request.month - 1, 1));
      const mEnd = new Date(Date.UTC(request.year, request.month, 1));
      const pto = await prisma.rosterTimeOff.findMany({
        where: { rosterEntryId: request.rosterEntryId, startDate: { lt: mEnd }, endDate: { gte: mStart } },
        select: { startDate: true, endDate: true, reason: true },
      });
      const DAY_MS = 24 * 60 * 60 * 1000;
      const seen = new Map();
      for (const t of pto) {
        const from = Math.max(t.startDate.getTime(), mStart.getTime());
        const to = Math.min(t.endDate.getTime(), mEnd.getTime() - DAY_MS);
        for (let ts = from; ts <= to; ts += DAY_MS) {
          seen.set(new Date(ts).toISOString().slice(0, 10), t.reason || null);
        }
      }
      ptoDates = [...seen.entries()].sort().map(([date, reason]) => ({ date, reason }));
      // PTO wins over any staged/app submission for the same date.
      if (ptoDates.length > 0) {
        const ptoSet = new Set(ptoDates.map((p) => p.date));
        submissions = submissions.filter((s) => !ptoSet.has(s.date));
      }
    } catch (ptoErr) {
      console.error('[avail] PTO overlay failed (page still served):', ptoErr.message);
    }

    res.json({
      providerName: fullName,
      providerFirstName,
      facilityName: request.facility?.name || '',
      month: request.month,
      year: request.year,
      monthName: MONTH_NAMES[request.month] || '',
      deadline: request.deadline.toISOString(),
      isLocked,
      submittedAt: request.submittedAt?.toISOString() || null,
      submissions,
      ptoDates,
    });
  } catch (err) {
    console.error('[avail] GET failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit (full-replace) availability for the month.
// Body: { dates: [{ date: "YYYY-MM-DD", available: bool, note?: string }] }
// Returns 410 Gone if past deadline.
router.post('/:token/submit', async (req, res) => {
  // The public reviewer demo page never accepts submissions.
  if (req.params.token === 'demo') {
    return res.status(400).json({ error: 'This is a demo page — submissions are disabled.' });
  }
  try {
    const { token } = req.params;
    const { dates, consent } = req.body || {};

    if (!Array.isArray(dates)) {
      return res.status(400).json({ error: 'dates array is required' });
    }
    // A month has at most 31 days; cap well below that so a malformed/hostile
    // body (this route is unauthenticated) can't drive a huge delete+insert.
    if (dates.length > 40) {
      return res.status(400).json({ error: 'Too many days submitted.' });
    }

    const request = await prisma.availabilityRequest.findUnique({
      where: { token },
      select: {
        id: true,
        year: true,
        month: true,
        deadline: true,
        submittedAt: true,
        smsConsentAt: true,
        rosterEntryId: true,
        rosterEntry: { select: { providerName: true, linkedProviderId: true, phoneNumber: true } },
        facility: { select: { name: true } },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' });
    }

    const now = new Date();
    if (now > new Date(request.deadline)) {
      return res.status(410).json({
        error: 'Submissions are closed — the deadline has passed.',
        code: 'DEADLINE_PASSED',
      });
    }

    // Validate each element: a well-formed YYYY-MM-DD inside the request's own
    // target month/year, note coerced to a bounded string. Invalid rows are
    // dropped (not 500'd), and duplicates are collapsed by date so the
    // delete+recreate can't hit a unique collision.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const byDate = new Map();
    for (const d of dates) {
      if (!d || typeof d !== 'object') continue;
      const ds = typeof d.date === 'string' ? d.date.trim() : '';
      if (!dateRe.test(ds)) continue;
      const dt = new Date(ds + 'T00:00:00Z');
      if (isNaN(dt.getTime())) continue;
      if (dt.getUTCFullYear() !== request.year || (dt.getUTCMonth() + 1) !== request.month) continue;
      // A "maybe" day is stored with available=false so the builder never
      // hard-places it; the flag + note carry the soft signal to the coordinator.
      const isMaybe = Boolean(d.maybe);
      byDate.set(ds, {
        requestId: request.id,
        date: dt,
        available: isMaybe ? false : Boolean(d.available),
        maybe: isMaybe,
        note: typeof d.note === 'string' ? d.note.slice(0, 500) : null,
      });
    }
    let cleanDates = [...byDate.values()];

    // Facility PTO is authoritative — drop any submission that lands on a
    // booked RosterTimeOff day so the link can't flip a PTO day back to
    // available (mirrors the locked cells on the page).
    try {
      const mStart = new Date(Date.UTC(request.year, request.month - 1, 1));
      const mEnd = new Date(Date.UTC(request.year, request.month, 1));
      const pto = await prisma.rosterTimeOff.findMany({
        where: { rosterEntryId: request.rosterEntryId, startDate: { lt: mEnd }, endDate: { gte: mStart } },
        select: { startDate: true, endDate: true },
      });
      if (pto.length > 0) {
        cleanDates = cleanDates.filter((d) => !pto.some((t) => t.startDate <= d.date && t.endDate >= d.date));
      }
    } catch (ptoErr) {
      console.error('[avail] PTO submit guard failed (submission continues):', ptoErr.message);
    }

    // Full replace: delete all existing day submissions, then bulk-create new ones.
    await prisma.$transaction(async (tx) => {
      await tx.availDaySubmission.deleteMany({
        where: { requestId: request.id },
      });

      if (cleanDates.length > 0) {
        await tx.availDaySubmission.createMany({
          data: cleanDates,
        });
      }

      // Set submittedAt on first submission; always update lastUpdatedAt.
      // Record the provider's SMS opt-in the first time they affirm it (the
      // consent checkbox on the availability page — kept for the audit trail /
      // toll-free verification evidence).
      await tx.availabilityRequest.update({
        where: { id: request.id },
        data: {
          submittedAt: request.submittedAt ?? now,
          lastUpdatedAt: now,
          ...(consent && !request.smsConsentAt ? { smsConsentAt: now } : {}),
        },
      });
    });

    // Record the consent in the SMS opt-in ledger keyed by phone number —
    // sendSMS() only texts numbers with an active SmsOptIn row, so without
    // this write the checkbox wouldn't actually enable texts. Non-fatal: the
    // availability submission is already saved.
    if (consent && request.rosterEntry?.phoneNumber) {
      try {
        const { normalizePhone } = require('../services/notifications');
        const e164 = normalizePhone(request.rosterEntry.phoneNumber);
        if (e164) {
          const consentText =
            'I agree to receive scheduling text messages from SNAP at this number. ' +
            'Message frequency varies; message & data rates may apply. Reply STOP to ' +
            'opt out, HELP for help. Consent is not a condition of employment or service.';
          await prisma.smsOptIn.upsert({
            where: { phoneNumber: e164 },
            create: {
              phoneNumber: e164,
              source: 'AVAIL_PAGE',
              firstName: null,
              lastName: request.rosterEntry.providerName?.slice(0, 100) || null,
              ipAddress: (req.ip || '').slice(0, 100) || null,
              userAgent: (req.headers['user-agent'] || '').slice(0, 300) || null,
              consentText,
            },
            update: {
              consentedAt: now,
              source: 'AVAIL_PAGE',
              ipAddress: (req.ip || '').slice(0, 100) || null,
              userAgent: (req.headers['user-agent'] || '').slice(0, 300) || null,
              consentText,
              revokedAt: null,
              revokedVia: null,
            },
          });
        }
      } catch (optInErr) {
        console.error('[avail] SMS opt-in write failed (submission still saved):', optInErr.message);
      }
    }

    // Availability unification: mirror the submitted days into the provider's
    // app calendar (ProviderAvailability) when this roster row is linked to a
    // SNAP account, so the app instantly reflects the link submission.
    // Non-critical — the staging write above is the canonical link-side store.
    if (request.rosterEntry?.linkedProviderId && cleanDates.length > 0) {
      const providerId = request.rosterEntry.linkedProviderId;
      try {
        await prisma.$transaction(
          cleanDates.map((d) =>
            prisma.providerAvailability.upsert({
              where: { providerId_date: { providerId, date: d.date } },
              create: { providerId, date: d.date, available: d.available, note: d.note },
              update: { available: d.available, note: d.note },
            })
          )
        );
      } catch (mirrorErr) {
        console.error('[avail] provider mirror failed (submission still saved):', mirrorErr.message);
      }
    }

    res.json({ ok: true, count: dates.length });
  } catch (err) {
    console.error('[avail] POST submit failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
