const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { resolveDayAvailability } = require('../services/availability');

const router = express.Router();

const isoOf = (d) => new Date(d).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

// Parse "YYYY-MM" into UTC [start, end) bounds. Returns null if invalid.
function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { start: new Date(Date.UTC(yr, mo - 1, 1)), end: new Date(Date.UTC(yr, mo, 1)) };
}

// Confirm a roster entry belongs to the requesting facility.
async function ownedEntry(rosterEntryId, facilityId) {
  if (!rosterEntryId) return null;
  const entry = await prisma.internalRosterEntry.findUnique({ where: { id: rosterEntryId } });
  return entry && entry.facilityId === facilityId ? entry : null;
}

// ── GET / — roster + explicit availability signals for a month ────────────────
// Returns schedulable members and, per member, only the dates that have an
// explicit signal (admin override, PTO, or provider submission), each resolved
// to { available, source, note }. The client renders the default (FULL_TIME =
// available, PER_DIEM/LOCUMS = unavailable) for any unmarked weekday.
router.get('/', facilityAuth, async (req, res) => {
  try {
    const bounds = monthBounds(req.query.month);
    if (!bounds) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const facilityId = req.facility.id;

    const roster = await prisma.internalRosterEntry.findMany({
      where: { facilityId, providerType: { not: null }, isNonClinical: { not: true } },
      select: { id: true, providerName: true, providerType: true, employmentCategory: true, linkedProviderId: true },
      orderBy: { providerName: 'asc' },
    });
    const linkedProviderIds = roster.map((r) => r.linkedProviderId).filter(Boolean);
    const providerIdToRosterId = Object.fromEntries(
      roster.filter((r) => r.linkedProviderId).map((r) => [r.linkedProviderId, r.id])
    );

    const [timeOff, providerRows, adminRows] = await Promise.all([
      prisma.rosterTimeOff.findMany({
        where: { facilityId, startDate: { lt: bounds.end }, endDate: { gte: bounds.start } },
        select: { rosterEntryId: true, startDate: true, endDate: true, reason: true },
      }),
      linkedProviderIds.length > 0
        ? prisma.providerAvailability.findMany({
            where: { date: { gte: bounds.start, lt: bounds.end }, providerId: { in: linkedProviderIds } },
            select: { providerId: true, date: true, available: true, note: true },
          })
        : Promise.resolve([]),
      prisma.rosterAvailability.findMany({
        where: { facilityId, date: { gte: bounds.start, lt: bounds.end } },
        select: { rosterEntryId: true, date: true, available: true, note: true, source: true },
      }),
    ]);

    // Build signal maps keyed `${rid}::${date}`.
    const ptoSet = new Set();
    const ptoNote = new Map();
    for (const t of timeOff) {
      let d = new Date(Math.max(new Date(t.startDate).getTime(), bounds.start.getTime()));
      const last = Math.min(new Date(t.endDate).getTime(), bounds.end.getTime() - DAY_MS);
      while (d.getTime() <= last) {
        const k = `${t.rosterEntryId}::${isoOf(d)}`;
        ptoSet.add(k);
        if (t.reason) ptoNote.set(k, t.reason);
        d = new Date(d.getTime() + DAY_MS);
      }
    }
    const adminMap = new Map(); // key -> { available, note, src }
    const providerMap = new Map();
    for (const a of adminRows) {
      const k = `${a.rosterEntryId}::${isoOf(a.date)}`;
      // ADMIN and PTO are both admin-set (authoritative); PROVIDER is self-submit.
      if (a.source === 'ADMIN' || a.source === 'PTO') adminMap.set(k, { available: a.available, note: a.note, src: a.source });
      else providerMap.set(k, { available: a.available, note: a.note });
    }
    for (const p of providerRows) {
      const rid = providerIdToRosterId[p.providerId];
      if (rid) providerMap.set(`${rid}::${isoOf(p.date)}`, { available: p.available, note: p.note });
    }

    // Provider self-submissions from the tokenized availability link
    // (AvailDaySubmission). The schedule builder already merges these
    // (schedule.js); without this, link submissions were invisible to the
    // coordinator-facing availability/notes views. Same precedence as the
    // builder: admin rows win, then RosterAvailability PROVIDER rows, then
    // link submissions.
    const mQ = /^(\d{4})-(\d{2})$/.exec(String(req.query.month));
    const availSubs = await prisma.availDaySubmission.findMany({
      where: {
        request: { facilityId, year: Number(mQ[1]), month: Number(mQ[2]) },
        date: { gte: bounds.start, lt: bounds.end },
      },
      include: { request: { select: { rosterEntryId: true } } },
    });
    for (const sub of availSubs) {
      const key = `${sub.request.rosterEntryId}::${isoOf(sub.date)}`;
      if (!providerMap.has(key)) {
        providerMap.set(key, { available: sub.available, note: sub.note });
      }
    }

    // Resolve every key that has any signal.
    const overrides = {};
    const allKeys = new Set([...adminMap.keys(), ...ptoSet, ...providerMap.keys()]);
    for (const key of allKeys) {
      const [rid, date] = key.split('::');
      const member = roster.find((r) => r.id === rid);
      if (!member) continue; // signal for a non-schedulable / filtered entry
      const adminEntry = adminMap.get(key);
      const providerEntry = providerMap.get(key);
      const { available } = resolveDayAvailability({
        employmentCategory: member.employmentCategory,
        adminAvailable: adminEntry ? adminEntry.available : null,
        ptoCovers: ptoSet.has(key),
        providerAvailable: providerEntry ? providerEntry.available : null,
      });
      // Display source: an admin row reports its own source (ADMIN or PTO);
      // otherwise a RosterTimeOff range = PTO, then provider, then default.
      let source, note;
      if (adminEntry) { source = adminEntry.src; note = adminEntry.note; }
      else if (ptoSet.has(key)) { source = 'PTO'; note = ptoNote.get(key) || null; }
      else if (providerEntry) { source = 'PROVIDER'; note = providerEntry.note; }
      else { source = 'DEFAULT'; note = null; }
      if (!overrides[rid]) overrides[rid] = {};
      overrides[rid][date] = { available, source, note: note || null };
    }

    const members = roster.map((r) => ({
      rosterEntryId: r.id,
      name: r.providerName,
      providerType: r.providerType,
      employmentCategory: r.employmentCategory,
      defaultAvailable: r.employmentCategory === 'FULL_TIME',
      linked: !!r.linkedProviderId,
    }));

    res.json({ month: req.query.month, members, overrides });
  } catch (err) {
    console.error('[roster-availability] GET failed:', err);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// ── POST / — set one date (admin override) ────────────────────────────────────
router.post('/', facilityAuth, async (req, res) => {
  try {
    const { rosterEntryId, date, available, note, pto } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    // PTO implies unavailable; otherwise an explicit available boolean is required.
    if (!pto && typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available (boolean) is required' });
    }
    const entry = await ownedEntry(rosterEntryId, req.facility.id);
    if (!entry) return res.status(404).json({ error: 'Roster member not found' });

    const dateObj = new Date(`${date}T00:00:00.000Z`);
    const source = pto ? 'PTO' : 'ADMIN';
    const avail = pto ? false : available;
    const row = await prisma.rosterAvailability.upsert({
      where: { rosterEntryId_date: { rosterEntryId, date: dateObj } },
      create: { rosterEntryId, facilityId: req.facility.id, date: dateObj, available: avail, note: note || null, source },
      update: { available: avail, note: note || null, source },
    });
    res.json(row);
  } catch (err) {
    console.error('[roster-availability] POST failed:', err);
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

// ── POST /range — set every date in [startDate, endDate] (e.g. a vacation week) ─
router.post('/range', facilityAuth, async (req, res) => {
  try {
    const { rosterEntryId, startDate, endDate, available, note, pto } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) {
      return res.status(400).json({ error: 'startDate and endDate must be YYYY-MM-DD' });
    }
    if (!pto && typeof available !== 'boolean') {
      return res.status(400).json({ error: 'available (boolean) is required' });
    }
    const entry = await ownedEntry(rosterEntryId, req.facility.id);
    if (!entry) return res.status(404).json({ error: 'Roster member not found' });

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (end < start) return res.status(400).json({ error: 'endDate must be on or after startDate' });
    if ((end - start) / DAY_MS > 366) return res.status(400).json({ error: 'Range too large (max 1 year)' });

    const source = pto ? 'PTO' : 'ADMIN';
    const avail = pto ? false : available;
    const ops = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      const dateObj = new Date(d);
      ops.push(prisma.rosterAvailability.upsert({
        where: { rosterEntryId_date: { rosterEntryId, date: dateObj } },
        create: { rosterEntryId, facilityId: req.facility.id, date: dateObj, available: avail, note: note || null, source },
        update: { available: avail, note: note || null, source },
      }));
    }
    const result = await prisma.$transaction(ops);
    res.json({ ok: true, count: result.length });
  } catch (err) {
    console.error('[roster-availability] POST /range failed:', err);
    res.status(500).json({ error: 'Failed to save availability range' });
  }
});

// ── DELETE / — clear an admin override for one date (revert to default/provider) ─
router.delete('/', facilityAuth, async (req, res) => {
  try {
    const { rosterEntryId, date } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const entry = await ownedEntry(rosterEntryId, req.facility.id);
    if (!entry) return res.status(404).json({ error: 'Roster member not found' });

    await prisma.rosterAvailability.deleteMany({
      where: { rosterEntryId, date: new Date(`${date}T00:00:00.000Z`), source: { in: ['ADMIN', 'PTO'] } },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[roster-availability] DELETE failed:', err);
    res.status(500).json({ error: 'Failed to clear availability' });
  }
});

// ── POST /copy-month — copy a member's admin overrides to another month ───────
router.post('/copy-month', facilityAuth, async (req, res) => {
  try {
    const { rosterEntryId, fromMonth, toMonth } = req.body || {};
    const from = monthBounds(fromMonth);
    const to = monthBounds(toMonth);
    if (!from || !to) return res.status(400).json({ error: 'fromMonth and toMonth must be YYYY-MM' });
    const entry = await ownedEntry(rosterEntryId, req.facility.id);
    if (!entry) return res.status(404).json({ error: 'Roster member not found' });

    const rows = await prisma.rosterAvailability.findMany({
      where: { rosterEntryId, source: 'ADMIN', date: { gte: from.start, lt: from.end } },
      select: { date: true, available: true, note: true },
    });

    const toYear = to.start.getUTCFullYear();
    const toMon = to.start.getUTCMonth();
    const lastDayOfToMonth = new Date(Date.UTC(toYear, toMon + 1, 0)).getUTCDate();

    const ops = [];
    for (const r of rows) {
      const day = new Date(r.date).getUTCDate();
      if (day > lastDayOfToMonth) continue; // e.g. Jan 31 → Feb has no 31st; skip
      const dateObj = new Date(Date.UTC(toYear, toMon, day));
      ops.push(prisma.rosterAvailability.upsert({
        where: { rosterEntryId_date: { rosterEntryId, date: dateObj } },
        create: { rosterEntryId, facilityId: req.facility.id, date: dateObj, available: r.available, note: r.note, source: 'ADMIN' },
        update: { available: r.available, note: r.note, source: 'ADMIN' },
      }));
    }
    const result = ops.length ? await prisma.$transaction(ops) : [];
    res.json({ ok: true, count: result.length });
  } catch (err) {
    console.error('[roster-availability] POST /copy-month failed:', err);
    res.status(500).json({ error: 'Failed to copy availability' });
  }
});

module.exports = router;
