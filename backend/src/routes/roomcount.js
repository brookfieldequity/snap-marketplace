// Public facility room-count self-submission route.
// No authentication — the token embedded in the URL is the credential.
//
// GET  /api/roomcount/:token          — load request + existing day counts
// POST /api/roomcount/:token/submit   — save/replace room counts for the month
//
// Mirrors avail.js (provider availability). The recipient here is a SITE's own
// scheduler declaring how many anesthetizing rooms run each day next month.
const express = require('express');
const prisma = require('../config/db');

const router = express.Router();

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A single site rarely runs more than a handful of rooms; cap defensively since
// this route is unauthenticated (bad input can't drive absurd values).
const MAX_ROOMS_PER_DAY = 50;

// Load request + existing day-level counts.
// Returns 404 when the token is unknown, 200 with isLocked when past deadline.
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const request = await prisma.roomCountRequest.findUnique({
      where: { token },
      include: {
        facility: { select: { name: true } },
        dayCounts: { orderBy: { date: 'asc' } },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' });
    }

    const now = new Date();
    const isLocked = now > new Date(request.deadline);

    const counts = request.dayCounts.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      roomsRequired: d.roomsRequired,
      note: d.note || null,
    }));

    res.json({
      location: request.location,
      facilityName: request.facility?.name || '',
      month: request.month,
      year: request.year,
      monthName: MONTH_NAMES[request.month] || '',
      deadline: request.deadline.toISOString(),
      isLocked,
      submittedAt: request.submittedAt?.toISOString() || null,
      counts,
    });
  } catch (err) {
    console.error('[roomcount] GET failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit (full-replace) room counts for the month.
// Body: { days: [{ date: "YYYY-MM-DD", roomsRequired: int, note?: string }] }
// Returns 410 Gone if past deadline.
router.post('/:token/submit', async (req, res) => {
  try {
    const { token } = req.params;
    const { days } = req.body || {};

    if (!Array.isArray(days)) {
      return res.status(400).json({ error: 'days array is required' });
    }
    // A month has at most 31 days; cap well below that so a malformed/hostile
    // body (this route is unauthenticated) can't drive a huge delete+insert.
    if (days.length > 40) {
      return res.status(400).json({ error: 'Too many days submitted.' });
    }

    const request = await prisma.roomCountRequest.findUnique({
      where: { token },
      select: { id: true, year: true, month: true, deadline: true, submittedAt: true },
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

    // Validate each element: well-formed YYYY-MM-DD inside the request's own
    // target month/year, roomsRequired a bounded non-negative integer, note a
    // bounded string. Invalid rows are dropped (not 500'd); duplicates collapse
    // by date so the delete+recreate can't hit a unique collision.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const byDate = new Map();
    for (const d of days) {
      if (!d || typeof d !== 'object') continue;
      const ds = typeof d.date === 'string' ? d.date.trim() : '';
      if (!dateRe.test(ds)) continue;
      const dt = new Date(ds + 'T00:00:00Z');
      if (isNaN(dt.getTime())) continue;
      if (dt.getUTCFullYear() !== request.year || (dt.getUTCMonth() + 1) !== request.month) continue;
      const rooms = Number(d.roomsRequired);
      if (!Number.isFinite(rooms) || rooms < 0) continue;
      byDate.set(ds, {
        requestId: request.id,
        date: dt,
        roomsRequired: Math.min(MAX_ROOMS_PER_DAY, Math.round(rooms)),
        note: typeof d.note === 'string' ? d.note.slice(0, 500) : null,
      });
    }
    const cleanDays = [...byDate.values()];

    // Full replace: delete existing day counts, then bulk-create.
    await prisma.$transaction(async (tx) => {
      await tx.roomCountDay.deleteMany({ where: { requestId: request.id } });
      if (cleanDays.length > 0) {
        await tx.roomCountDay.createMany({ data: cleanDays });
      }
      // Set submittedAt on first submission; always update lastUpdatedAt.
      await tx.roomCountRequest.update({
        where: { id: request.id },
        data: {
          submittedAt: request.submittedAt ?? now,
          lastUpdatedAt: now,
        },
      });
    });

    res.json({ ok: true, count: cleanDays.length });
  } catch (err) {
    console.error('[roomcount] POST submit failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
