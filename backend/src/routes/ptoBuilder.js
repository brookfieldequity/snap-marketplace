// PTO Builder (Feature B) — annual ranked PTO bidding. See pto-builder-spec.
//
// Facility/admin side (facilityAuth — req.facility):
//   POST   /pto-builder/windows                 create a window for a year
//   GET    /pto-builder/windows?year=            get the window for a year (+counts)
//   GET    /pto-builder/windows/:id              window detail (weeks, capacities)
//   PATCH  /pto-builder/windows/:id              edit dates / capacity / maxRanks
//   POST   /pto-builder/windows/:id/status       { status: OPEN | CLOSED | DRAFT }
//   PUT    /pto-builder/windows/:id/capacity     per-week overrides [{weekStart,capacity}]
//   POST   /pto-builder/windows/:id/allocate     run the allocation engine
//   GET    /pto-builder/windows/:id/calendar     per-week bids + capacity + granted
//   GET    /pto-builder/windows/:id/results      granted + waitlist
//   GET    /pto-builder/windows/:id/rank-links   signed ranking links per eligible provider
//   POST   /pto-builder/allocations/:id/cancel   give up a granted week (auto-promotes)
//   POST   /pto-builder/allocations/:id/promote  manually grant a waitlisted week
//
// Provider side (signed token, no login — works for non-app providers):
//   GET    /pto-builder/rank/:token              window + my current bids + weeks
//   PUT    /pto-builder/rank/:token              submit my ranked weeks [{weekStart,rank}]

const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { requireFlag } = require('../config/featureFlags');
const pto = require('../services/pto');
const builder = require('../services/ptoBuilder');

const router = express.Router();
// Facility/admin routes are gated by the pto_builder flag (off until a SNAP
// admin enables it per facility). Public /rank/:token routes are NOT gated —
// they have no facility auth context and only resolve if a window/link exists.
const flag = requireFlag('pto_builder');
const JWT_SECRET = process.env.JWT_SECRET;
const iso = builder.iso;
const dateOnly = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00.000Z`);

// Sign / verify a per-provider ranking token (no login; long-lived for the window).
const signRankToken = (windowId, rosterEntryId) =>
  jwt.sign({ type: 'pto-rank', windowId, rosterEntryId }, JWT_SECRET, { expiresIn: '120d' });

// Confirm a window belongs to the requesting facility.
async function ownedWindow(id, facilityId) {
  const w = await prisma.ptoWindow.findUnique({ where: { id } });
  return w && w.facilityId === facilityId ? w : null;
}

// Eligible roster entries for PTO bidding at a facility (schedulable clinicians
// that are PTO-eligible — W-2 / full-time, or admin-flagged).
async function eligibleEntries(facilityId) {
  const rows = await prisma.internalRosterEntry.findMany({
    where: { facilityId, isNonClinical: { not: true } },
    select: { id: true, providerName: true, providerType: true, ptoEligible: true, is1099: true, isFullTime: true, employmentCategory: true, ptoDaysAnnual: true, seniorityRank: true },
    orderBy: { providerName: 'asc' },
  });
  return rows.filter((r) => pto.isPtoEligible(r));
}

// ── Create a window ───────────────────────────────────────────────────────────
router.post('/windows', facilityAuth, flag, async (req, res) => {
  try {
    const { year, openDate, closeDate, defaultWeeklyCapacity, maxRanks } = req.body || {};
    if (!year || !openDate || !closeDate) {
      return res.status(400).json({ error: 'year, openDate, closeDate are required' });
    }
    const existing = await prisma.ptoWindow.findUnique({
      where: { facilityId_year: { facilityId: req.facility.id, year: parseInt(year) } },
    });
    if (existing) return res.status(409).json({ error: `A window already exists for ${year}` });

    const win = await prisma.ptoWindow.create({
      data: {
        facilityId: req.facility.id,
        year: parseInt(year),
        openDate: dateOnly(openDate),
        closeDate: dateOnly(closeDate),
        defaultWeeklyCapacity: defaultWeeklyCapacity != null ? parseInt(defaultWeeklyCapacity) : 1,
        maxRanks: maxRanks != null ? parseInt(maxRanks) : 15,
      },
    });
    res.status(201).json(win);
  } catch (err) {
    console.error('[pto-builder] create window failed:', err);
    res.status(500).json({ error: 'Failed to create window' });
  }
});

// ── Get the window for a year (with bid/allocation counts) ────────────────────
router.get('/windows', facilityAuth, flag, async (req, res) => {
  try {
    const where = { facilityId: req.facility.id };
    if (req.query.year) where.year = parseInt(req.query.year);
    const windows = await prisma.ptoWindow.findMany({
      where,
      orderBy: { year: 'desc' },
      include: { _count: { select: { bids: true, allocations: true } } },
    });
    res.json({ windows });
  } catch (err) {
    console.error('[pto-builder] list windows failed:', err);
    res.status(500).json({ error: 'Failed to load windows' });
  }
});

// ── Window detail — weeks + capacity map ──────────────────────────────────────
router.get('/windows/:id', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const capacities = await prisma.ptoWeekCapacity.findMany({
      where: { windowId: win.id, mode: 'GLOBAL' },
      select: { weekStart: true, capacity: true },
    });
    const capMap = {};
    for (const c of capacities) capMap[iso(c.weekStart)] = c.capacity;
    const weeks = builder.weeksOfYear(win.year).map((d) => iso(d));
    res.json({ window: win, weeks, capacityOverrides: capMap });
  } catch (err) {
    console.error('[pto-builder] window detail failed:', err);
    res.status(500).json({ error: 'Failed to load window' });
  }
});

// ── Edit window (dates / default capacity / maxRanks) ─────────────────────────
router.patch('/windows/:id', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const { openDate, closeDate, defaultWeeklyCapacity, maxRanks } = req.body || {};
    const updated = await prisma.ptoWindow.update({
      where: { id: win.id },
      data: {
        ...(openDate !== undefined && { openDate: dateOnly(openDate) }),
        ...(closeDate !== undefined && { closeDate: dateOnly(closeDate) }),
        ...(defaultWeeklyCapacity !== undefined && { defaultWeeklyCapacity: parseInt(defaultWeeklyCapacity) }),
        ...(maxRanks !== undefined && { maxRanks: parseInt(maxRanks) }),
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('[pto-builder] edit window failed:', err);
    res.status(500).json({ error: 'Failed to update window' });
  }
});

// ── Set window status (DRAFT / OPEN / CLOSED) ─────────────────────────────────
router.post('/windows/:id/status', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const { status } = req.body || {};
    if (!['DRAFT', 'OPEN', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'status must be DRAFT, OPEN, or CLOSED' });
    }
    const updated = await prisma.ptoWindow.update({ where: { id: win.id }, data: { status } });
    res.json(updated);
  } catch (err) {
    console.error('[pto-builder] set status failed:', err);
    res.status(500).json({ error: 'Failed to set status' });
  }
});

// ── Per-week capacity overrides ───────────────────────────────────────────────
router.put('/windows/:id/capacity', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
    const ops = [];
    for (const o of overrides) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.weekStart || ''))) continue;
      const weekStart = dateOnly(o.weekStart);
      if (o.capacity == null || o.capacity === '') {
        // Clearing an override → fall back to the window default.
        ops.push(prisma.ptoWeekCapacity.deleteMany({ where: { windowId: win.id, weekStart, mode: 'GLOBAL' } }));
      } else {
        const capacity = parseInt(o.capacity);
        ops.push(prisma.ptoWeekCapacity.upsert({
          where: { windowId_weekStart_mode_role_siteName: { windowId: win.id, weekStart, mode: 'GLOBAL', role: null, siteName: null } },
          create: { windowId: win.id, weekStart, capacity, mode: 'GLOBAL' },
          update: { capacity },
        }));
      }
    }
    await prisma.$transaction(ops);
    res.json({ ok: true, count: ops.length });
  } catch (err) {
    console.error('[pto-builder] set capacity failed:', err);
    res.status(500).json({ error: 'Failed to set capacity' });
  }
});

// ── Run allocation ────────────────────────────────────────────────────────────
router.post('/windows/:id/allocate', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const result = await builder.runAllocation(win.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[pto-builder] allocate failed:', err);
    res.status(500).json({ error: err.message || 'Allocation failed' });
  }
});

// ── Calendar — for each week: capacity, who ranked it (+rank), granted ────────
router.get('/windows/:id/calendar', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });

    const [bids, caps, allocs] = await Promise.all([
      prisma.ptoBid.findMany({
        where: { windowId: win.id },
        include: { rosterEntry: { select: { providerName: true, providerType: true, seniorityRank: true } } },
      }),
      prisma.ptoWeekCapacity.findMany({ where: { windowId: win.id, mode: 'GLOBAL' }, select: { weekStart: true, capacity: true } }),
      prisma.ptoAllocation.findMany({
        where: { windowId: win.id },
        include: { rosterEntry: { select: { providerName: true } } },
      }),
    ]);
    const capMap = {};
    for (const c of caps) capMap[iso(c.weekStart)] = c.capacity;

    const weeks = {};
    const ensure = (k) => (weeks[k] = weeks[k] || { weekStart: k, capacity: capMap[k] != null ? capMap[k] : win.defaultWeeklyCapacity, bids: [], granted: [], waitlist: [] });
    for (const k of builder.weeksOfYear(win.year).map(iso)) ensure(k);
    for (const b of bids) {
      ensure(iso(b.weekStart)).bids.push({ name: b.rosterEntry.providerName, providerType: b.rosterEntry.providerType, rank: b.rank, seniorityRank: b.rosterEntry.seniorityRank });
    }
    for (const a of allocs) {
      const w = ensure(iso(a.weekStart));
      if (a.status === 'GRANTED') w.granted.push({ name: a.rosterEntry.providerName, rank: a.rank });
      else w.waitlist.push({ name: a.rosterEntry.providerName, rank: a.rank, waitlistPos: a.waitlistPos });
    }
    for (const k of Object.keys(weeks)) {
      weeks[k].bids.sort((x, y) => x.rank - y.rank);
      weeks[k].waitlist.sort((x, y) => (x.waitlistPos || 0) - (y.waitlistPos || 0));
    }
    res.json({ window: win, weeks: Object.values(weeks).sort((a, b) => a.weekStart.localeCompare(b.weekStart)) });
  } catch (err) {
    console.error('[pto-builder] calendar failed:', err);
    res.status(500).json({ error: 'Failed to load calendar' });
  }
});

// ── Results — granted + waitlist, grouped by provider and by week ─────────────
router.get('/windows/:id/results', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const allocs = await prisma.ptoAllocation.findMany({
      where: { windowId: win.id },
      include: { rosterEntry: { select: { providerName: true, providerType: true } } },
      orderBy: [{ weekStart: 'asc' }, { status: 'asc' }, { waitlistPos: 'asc' }],
    });
    res.json({
      window: win,
      granted: allocs.filter((a) => a.status === 'GRANTED'),
      waitlisted: allocs.filter((a) => a.status === 'WAITLISTED'),
    });
  } catch (err) {
    console.error('[pto-builder] results failed:', err);
    res.status(500).json({ error: 'Failed to load results' });
  }
});

// ── Ranking links — one signed URL token per eligible provider ────────────────
router.get('/windows/:id/rank-links', facilityAuth, flag, async (req, res) => {
  try {
    const win = await ownedWindow(req.params.id, req.facility.id);
    if (!win) return res.status(404).json({ error: 'Window not found' });
    const entries = await eligibleEntries(req.facility.id);
    const links = entries.map((e) => ({
      rosterEntryId: e.id,
      name: e.providerName,
      providerType: e.providerType,
      seniorityRank: e.seniorityRank,
      token: signRankToken(win.id, e.id),
    }));
    res.json({ links });
  } catch (err) {
    console.error('[pto-builder] rank-links failed:', err);
    res.status(500).json({ error: 'Failed to generate links' });
  }
});

// ── Cancel a granted allocation (auto-promotes the waitlist) ──────────────────
router.post('/allocations/:id/cancel', facilityAuth, flag, async (req, res) => {
  try {
    const alloc = await prisma.ptoAllocation.findUnique({ where: { id: req.params.id }, include: { window: true } });
    if (!alloc || alloc.window.facilityId !== req.facility.id) return res.status(404).json({ error: 'Not found' });
    const result = await builder.cancelAllocation(alloc.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[pto-builder] cancel failed:', err);
    res.status(500).json({ error: err.message || 'Cancel failed' });
  }
});

// ── Manually promote a waitlisted allocation to granted ───────────────────────
router.post('/allocations/:id/promote', facilityAuth, flag, async (req, res) => {
  try {
    const alloc = await prisma.ptoAllocation.findUnique({ where: { id: req.params.id }, include: { window: true } });
    if (!alloc || alloc.window.facilityId !== req.facility.id) return res.status(404).json({ error: 'Not found' });
    const result = await builder.promoteAllocation(alloc.id, { force: !!req.body?.force });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[pto-builder] promote failed:', err);
    res.status(400).json({ error: err.message || 'Promote failed' });
  }
});

// ── Provider ranking (token) — verify + load ──────────────────────────────────
function verifyRankToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.type !== 'pto-rank') throw new Error('Wrong token type');
  return payload; // { windowId, rosterEntryId }
}

router.get('/rank/:token', async (req, res) => {
  try {
    const { windowId, rosterEntryId } = verifyRankToken(req.params.token);
    const win = await prisma.ptoWindow.findUnique({ where: { id: windowId } });
    const entry = await prisma.internalRosterEntry.findUnique({
      where: { id: rosterEntryId },
      select: { id: true, providerName: true, facilityId: true, facility: { select: { name: true } } },
    });
    if (!win || !entry || entry.facilityId !== win.facilityId) {
      return res.status(404).json({ error: 'Invalid ranking link' });
    }
    const myBids = await prisma.ptoBid.findMany({
      where: { windowId, rosterEntryId },
      orderBy: { rank: 'asc' },
      select: { weekStart: true, rank: true },
    });
    res.json({
      window: { id: win.id, year: win.year, status: win.status, maxRanks: win.maxRanks, openDate: win.openDate, closeDate: win.closeDate },
      provider: { name: entry.providerName },
      facility: { name: entry.facility?.name || 'Facility' },
      weeks: builder.weeksOfYear(win.year).map(iso),
      myBids: myBids.map((b) => ({ weekStart: iso(b.weekStart), rank: b.rank })),
      editable: win.status === 'OPEN',
    });
  } catch (err) {
    console.error('[pto-builder] rank GET failed:', err.message);
    res.status(401).json({ error: 'Invalid or expired ranking link' });
  }
});

router.put('/rank/:token', async (req, res) => {
  try {
    const { windowId, rosterEntryId } = verifyRankToken(req.params.token);
    const win = await prisma.ptoWindow.findUnique({ where: { id: windowId } });
    if (!win) return res.status(404).json({ error: 'Invalid ranking link' });
    if (win.status !== 'OPEN') return res.status(409).json({ error: 'Ranking is closed for this window' });

    const bids = Array.isArray(req.body?.bids) ? req.body.bids : [];
    const validWeeks = new Set(builder.weeksOfYear(win.year).map(iso));
    const seenWeek = new Set();
    const seenRank = new Set();
    const clean = [];
    for (const b of bids) {
      const wk = iso(b.weekStart);
      const rank = parseInt(b.rank);
      if (!validWeeks.has(wk)) return res.status(400).json({ error: `Invalid week ${wk}` });
      if (!(rank >= 1 && rank <= win.maxRanks)) return res.status(400).json({ error: `Rank must be 1–${win.maxRanks}` });
      if (seenWeek.has(wk)) return res.status(400).json({ error: 'A week was ranked twice' });
      if (seenRank.has(rank)) return res.status(400).json({ error: `Rank ${rank} used twice` });
      seenWeek.add(wk); seenRank.add(rank);
      clean.push({ weekStart: dateOnly(wk), rank });
    }

    await prisma.$transaction([
      prisma.ptoBid.deleteMany({ where: { windowId, rosterEntryId } }),
      ...clean.map((c) => prisma.ptoBid.create({ data: { windowId, rosterEntryId, weekStart: c.weekStart, rank: c.rank } })),
    ]);
    res.json({ ok: true, count: clean.length });
  } catch (err) {
    console.error('[pto-builder] rank PUT failed:', err.message);
    res.status(401).json({ error: 'Invalid or expired ranking link' });
  }
});

module.exports = router;
