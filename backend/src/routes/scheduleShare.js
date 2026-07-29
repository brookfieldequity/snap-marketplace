// Public, no-login shareable facility schedule — ONE site's monthly provider
// schedule, sent to that surgical center each month. The token in the URL is
// the credential (no auth).
//
// GET /api/schedule-share/:token — the site's month + per-day provider names.
const express = require('express');
const prisma = require('../config/db');

const router = express.Router();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthRange(year, month) {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

router.get('/:token', async (req, res) => {
  try {
    const share = await prisma.scheduleShare.findUnique({
      where: { token: req.params.token },
      include: { facility: { select: { name: true } } },
    });
    if (!share) return res.status(404).json({ error: 'Schedule link not found', code: 'NOT_FOUND' });

    const { start, end } = monthRange(share.year, share.month);
    const [days, timeOff, ptoAvail] = await Promise.all([
      prisma.scheduleDay.findMany({
        where: { facilityId: share.facilityId, location: share.location, date: { gte: start, lt: end } },
        include: {
          assignments: {
            where: { rosterId: { not: null } },
            include: { rosterEntry: { select: { providerName: true, providerType: true } } },
            orderBy: { roomNumber: 'asc' },
          },
        },
        orderBy: { date: 'asc' },
      }),
      // Granted PTO lives in two tables (PTO tab/import → RosterTimeOff;
      // approved PTO requests → RosterAvailability source 'PTO'). Union both
      // so an assignment whose provider was later granted PTO shows as a
      // coverage gap here instead of as false coverage.
      prisma.rosterTimeOff.findMany({
        where: { facilityId: share.facilityId, startDate: { lt: end }, endDate: { gte: start } },
        select: { rosterEntryId: true, startDate: true, endDate: true },
      }),
      prisma.rosterAvailability.findMany({
        where: { facilityId: share.facilityId, source: 'PTO', available: false, date: { gte: start, lt: end } },
        select: { rosterEntryId: true, date: true },
      }),
    ]);

    const offKeys = new Set();
    const DAY_MS = 86400000;
    for (const t of timeOff) {
      for (let ts = t.startDate.getTime(); ts <= t.endDate.getTime(); ts += DAY_MS) {
        offKeys.add(`${t.rosterEntryId}|${new Date(ts).toISOString().slice(0, 10)}`);
      }
    }
    for (const p of ptoAvail) {
      offKeys.add(`${p.rosterEntryId}|${p.date.toISOString().slice(0, 10)}`);
    }

    let updatedAt = null;
    const outDays = days.map((d) => {
      if (d.publishedAt && (!updatedAt || d.publishedAt > updatedAt)) updatedAt = d.publishedAt;
      const dateIso = d.date.toISOString().slice(0, 10);
      // A provider can hold multiple rooms — show each name once.
      const seen = new Set();
      const providers = [];
      let needsCoverage = 0;
      for (const a of d.assignments) {
        const name = a.rosterEntry?.providerName;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        // Assigned but since granted PTO — externally this is an open spot
        // being re-covered, not a person coming in. No name shown.
        if (a.rosterId && offKeys.has(`${a.rosterId}|${dateIso}`)) {
          needsCoverage++;
          continue;
        }
        providers.push({ name, type: a.rosterEntry?.providerType || null });
      }
      return { date: dateIso, providers, needsCoverage };
    });

    res.json({
      siteName: share.location,
      orgName: share.facility?.name || null,
      year: share.year,
      month: share.month,
      monthLabel: MONTH_NAMES[share.month - 1] || '',
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      days: outDays,
    });
  } catch (err) {
    console.error('[schedule-share] GET failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
