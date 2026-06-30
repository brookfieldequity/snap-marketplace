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
        rosterEntry: { select: { providerName: true } },
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

    const submissions = request.daySubmissions.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      available: s.available,
      note: s.note || null,
    }));

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

    const request = await prisma.availabilityRequest.findUnique({
      where: { token },
      select: {
        id: true,
        deadline: true,
        submittedAt: true,
        rosterEntry: { select: { providerName: true } },
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

    // Full replace: delete all existing day submissions, then bulk-create new ones.
    await prisma.$transaction(async (tx) => {
      await tx.availDaySubmission.deleteMany({
        where: { requestId: request.id },
      });

      if (dates.length > 0) {
        await tx.availDaySubmission.createMany({
          data: dates.map((d) => ({
            requestId: request.id,
            date: new Date(d.date + 'T00:00:00Z'),
            available: Boolean(d.available),
            note: d.note || null,
          })),
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

    res.json({ ok: true, count: dates.length });
  } catch (err) {
    console.error('[avail] POST submit failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
