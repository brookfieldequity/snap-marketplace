// Provider worked-hours entry — provider self-service routes (Stage 2).
// The "one-tap hours" surface for the mobile app: a linked provider confirms
// the days they worked (pre-filled from per-site defaults), which lands as
// SUBMITTED ProviderHourEntry rows — exactly what the Payroll Builder + Agency
// Invoice already consume for 1099s. Coordinator routes live in hourEntry.js
// (facilityAuth); these use the provider `auth` audience and are gated per
// facility on the same payroll_builder flag.

const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const { isFlagEnabled } = require('../config/featureFlags');
const { minutesOf } = require('../services/hourEntry');

const router = express.Router();
router.use(auth);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// Hours between two "HH:MM" times. Unlike the coordinator-side hoursFromWindow
// (same-day only), an end before the start is treated as an overnight span.
function hoursBetween(start, end) {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s == null || e == null) return 0;
  const mins = e >= s ? e - s : e + 24 * 60 - s;
  return Math.round((mins / 60) * 100) / 100;
}

// The provider's roster memberships, restricted to facilities where the
// payroll_builder flag is on (hours entry is part of that product surface).
async function hourEntryMemberships(userId) {
  const provider = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!provider) return [];
  const entries = await prisma.internalRosterEntry.findMany({
    where: { linkedProviderId: provider.id },
    select: { id: true, facilityId: true, facility: { select: { id: true, name: true } } },
  });
  const enabledByFacility = new Map();
  for (const e of entries) {
    if (!enabledByFacility.has(e.facilityId)) {
      enabledByFacility.set(e.facilityId, await isFlagEnabled(e.facilityId, 'payroll_builder'));
    }
  }
  return entries.filter((e) => enabledByFacility.get(e.facilityId));
}

// Default-times resolution for a worked day, in priority order:
//   1. the existing hour entry's own times
//   2. SiteHourDefault for (facility, location)
//   3. the provider's most recent SUBMITTED entry at that (facility, location)
//   4. the coverage-template default window for (location, weekday)
//   5. "07:00"–"15:00"
function resolveDefaults({ entry, siteDefault, lastSubmitted, templateWin }) {
  if (entry?.startTime && entry?.endTime) return { start: entry.startTime, end: entry.endTime };
  if (siteDefault) return { start: siteDefault.startTime, end: siteDefault.endTime };
  if (lastSubmitted?.startTime && lastSubmitted?.endTime) {
    return { start: lastSubmitted.startTime, end: lastSubmitted.endTime };
  }
  if (templateWin) return { start: templateWin.start, end: templateWin.end };
  return { start: '07:00', end: '15:00' };
}

// GET /?start=YYYY-MM-DD&end=YYYY-MM-DD — the provider's confirmable days.
// Defaults to the last 14 days through today. A day appears when the provider
// had a ScheduleAssignment OR already has a ProviderHourEntry in the range.
router.get('/', async (req, res) => {
  try {
    let { start, end } = req.query;
    if (!end) end = ymd(new Date());
    if (!start) start = ymd(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
    if (!YMD.test(start) || !YMD.test(end)) {
      return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    }
    const rangeStart = new Date(start + 'T00:00:00.000Z');
    const rangeEnd = new Date(end + 'T23:59:59.999Z');

    const memberships = await hourEntryMemberships(req.user.userId);
    if (memberships.length === 0) return res.json({ facilities: [], days: [] });
    const rosterIds = memberships.map((m) => m.id);
    const byRosterId = new Map(memberships.map((m) => [m.id, m]));
    const facilityIds = [...new Set(memberships.map((m) => m.facilityId))];

    const [assignments, entries, siteDefaults, templates] = await Promise.all([
      prisma.scheduleAssignment.findMany({
        where: { rosterId: { in: rosterIds }, scheduleDay: { date: { gte: rangeStart, lte: rangeEnd } } },
        include: { scheduleDay: { select: { date: true, location: true } } },
      }),
      prisma.providerHourEntry.findMany({
        where: { rosterEntryId: { in: rosterIds }, date: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.siteHourDefault.findMany({ where: { facilityId: { in: facilityIds } } }),
      prisma.coverageTemplate.findMany({
        where: { facilityId: { in: facilityIds }, isDefault: true },
        include: { days: true },
      }),
    ]);

    // Lookup maps. Keys use `facilityId::location` (location '' when null).
    const siteDefaultByKey = new Map(siteDefaults.map((d) => [`${d.facilityId}::${d.location}`, d]));
    const templateWinByKey = new Map();
    for (const t of templates) {
      for (const d of t.days) {
        if (d.defaultStartTime && d.defaultEndTime) {
          templateWinByKey.set(`${t.facilityId}::${d.location}::${d.dayOfWeek}`, {
            start: d.defaultStartTime,
            end: d.defaultEndTime,
          });
        }
      }
    }

    // Most recent SUBMITTED entry per (rosterEntry, location) — one query,
    // newest-first, first hit wins.
    const priorSubmitted = await prisma.providerHourEntry.findMany({
      where: { rosterEntryId: { in: rosterIds }, status: 'SUBMITTED' },
      orderBy: { date: 'desc' },
      select: { rosterEntryId: true, location: true, startTime: true, endTime: true },
      take: 500,
    });
    const lastSubmittedByKey = new Map();
    for (const p of priorSubmitted) {
      const k = `${p.rosterEntryId}::${p.location || ''}`;
      if (!lastSubmittedByKey.has(k)) lastSubmittedByKey.set(k, p);
    }

    // Merge assignments + existing entries into day items keyed by
    // rosterEntryId::date::location.
    const items = new Map();
    for (const a of assignments) {
      if (!a.rosterId) continue;
      const date = ymd(a.scheduleDay.date);
      const location = a.scheduleDay.location || null;
      items.set(`${a.rosterId}::${date}::${location || ''}`, { rosterEntryId: a.rosterId, date, location, entry: null });
    }
    for (const e of entries) {
      const date = ymd(e.date);
      const k = `${e.rosterEntryId}::${date}::${e.location || ''}`;
      const item = items.get(k) || { rosterEntryId: e.rosterEntryId, date, location: e.location || null, entry: null };
      item.entry = e;
      items.set(k, item);
    }

    const days = [...items.values()].map((item) => {
      const m = byRosterId.get(item.rosterEntryId);
      const dow = new Date(item.date + 'T00:00:00.000Z').getUTCDay();
      const def = resolveDefaults({
        entry: item.entry,
        siteDefault: siteDefaultByKey.get(`${m.facilityId}::${item.location || ''}`),
        lastSubmitted: lastSubmittedByKey.get(`${item.rosterEntryId}::${item.location || ''}`),
        templateWin: templateWinByKey.get(`${m.facilityId}::${item.location}::${dow}`),
      });
      const startTime = item.entry?.startTime || def.start;
      const endTime = item.entry?.endTime || def.end;
      return {
        date: item.date,
        facilityId: m.facilityId,
        facilityName: m.facility?.name || null,
        rosterEntryId: item.rosterEntryId,
        location: item.location,
        status: item.entry?.status === 'SUBMITTED' ? 'submitted' : 'unconfirmed',
        defaultStartTime: def.start,
        defaultEndTime: def.end,
        startTime,
        endTime,
        hours: item.entry?.hours != null && item.entry.status === 'SUBMITTED'
          ? item.entry.hours
          : hoursBetween(startTime, endTime),
        entryId: item.entry?.id || null,
      };
    });
    days.sort((a, b) => (a.date === b.date ? (a.location || '').localeCompare(b.location || '') : b.date.localeCompare(a.date)));

    res.json({
      facilities: [...new Map(memberships.map((m) => [m.facilityId, { id: m.facilityId, name: m.facility?.name || null }])).values()],
      days,
    });
  } catch (err) {
    console.error('[provider-hours/list]', err.message);
    res.status(500).json({ error: 'Failed to load hours' });
  }
});

// POST /confirm { entries: [{ date, rosterEntryId, location, startTime, endTime }] }
// — one-tap confirm. Upserts each day's ProviderHourEntry as SUBMITTED with
// enteredBy 'provider'; hours are recomputed server-side. Days already
// captured in an EXPORTED contractor payroll run are rejected.
router.post('/confirm', async (req, res) => {
  try {
    const list = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (list.length === 0) return res.status(400).json({ error: 'entries is required' });
    if (list.length > 100) return res.status(400).json({ error: 'Too many entries (max 100)' });

    const memberships = await hourEntryMemberships(req.user.userId);
    const byRosterId = new Map(memberships.map((m) => [m.id, m]));

    // Validate shape + ownership up front — reject the whole batch on any bad
    // row so a partial confirm can't silently drop days.
    for (const item of list) {
      if (!item || !YMD.test(item.date || '') || !item.rosterEntryId) {
        return res.status(400).json({ error: 'Each entry needs a date (YYYY-MM-DD) and rosterEntryId' });
      }
      if (!byRosterId.has(item.rosterEntryId)) {
        return res.status(403).json({ error: 'One or more entries are not on your roster' });
      }
      if ((item.startTime && minutesOf(item.startTime) == null) ||
          (item.endTime && minutesOf(item.endTime) == null)) {
        return res.status(400).json({ error: 'startTime/endTime must be "HH:MM" 24h' });
      }
    }

    // Finalized-payroll guard: EXPORTED contractor runs covering any of these
    // dates for any of these providers freeze those days.
    const dates = list.map((i) => i.date).sort();
    const minDate = new Date(dates[0] + 'T00:00:00.000Z');
    const maxDate = new Date(dates[dates.length - 1] + 'T23:59:59.999Z');
    const exportedRuns = await prisma.payrollRun.findMany({
      where: {
        facilityId: { in: [...new Set(list.map((i) => byRosterId.get(i.rosterEntryId).facilityId))] },
        payClass: 'CONTRACTOR',
        status: 'EXPORTED',
        periodStart: { lte: maxDate },
        periodEnd: { gte: minDate },
      },
      select: {
        facilityId: true, periodStart: true, periodEnd: true,
        lineItems: { select: { rosterEntryId: true } },
      },
    });
    const isFinalized = (rosterEntryId, facilityId, date) =>
      exportedRuns.some((r) =>
        r.facilityId === facilityId &&
        ymd(r.periodStart) <= date && date <= ymd(r.periodEnd) &&
        r.lineItems.some((li) => li.rosterEntryId === rosterEntryId));

    const updated = [];
    const rejected = [];
    for (const item of list) {
      const m = byRosterId.get(item.rosterEntryId);
      const location = item.location ? String(item.location) : null;
      if (isFinalized(item.rosterEntryId, m.facilityId, item.date)) {
        rejected.push({ date: item.date, rosterEntryId: item.rosterEntryId, location, reason: 'Already included in a finalized payroll run' });
        continue;
      }
      const dateObj = new Date(item.date + 'T00:00:00.000Z');
      const existing = await prisma.providerHourEntry.findFirst({
        where: { rosterEntryId: item.rosterEntryId, date: dateObj, location },
      });
      const startTime = item.startTime || existing?.startTime || null;
      const endTime = item.endTime || existing?.endTime || null;
      const data = {
        startTime,
        endTime,
        hours: hoursBetween(startTime, endTime),
        status: 'SUBMITTED',
        enteredBy: 'provider',
      };
      const row = existing
        ? await prisma.providerHourEntry.update({ where: { id: existing.id }, data })
        : await prisma.providerHourEntry.create({
            data: {
              facilityId: m.facilityId, rosterEntryId: item.rosterEntryId,
              date: dateObj, location, source: 'MANUAL', ...data,
            },
          });
      updated.push({
        entryId: row.id, date: ymd(row.date), rosterEntryId: row.rosterEntryId,
        location: row.location, startTime: row.startTime, endTime: row.endTime,
        hours: row.hours, status: 'submitted',
      });
    }

    res.json({ updated, rejected });
  } catch (err) {
    console.error('[provider-hours/confirm]', err.message);
    res.status(500).json({ error: 'Failed to confirm hours' });
  }
});

module.exports = router;
