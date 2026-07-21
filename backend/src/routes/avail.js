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

    // Derive a friendly first name from providerName (first word).
    const fullName = request.rosterEntry?.providerName || '';
    const providerFirstName = fullName.split(/\s+/)[0] || fullName;

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
  try {
    const { token } = req.params;
    const { dates } = req.body || {};

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
        rosterEntry: { select: { providerName: true, linkedProviderId: true } },
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
    const cleanDates = [...byDate.values()];

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
      await tx.availabilityRequest.update({
        where: { id: request.id },
        data: {
          submittedAt: request.submittedAt ?? now,
          lastUpdatedAt: now,
        },
      });
    });

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
