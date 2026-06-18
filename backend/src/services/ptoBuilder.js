// PTO Builder (Feature B) — week helpers + the annual ranked allocation engine.
// See pto-builder-spec. Weeks are Mon–Sun; weekStart is always the Monday
// (UTC). A granted week consumes 5 weekday allotment days.

const prisma = require('../config/db');
const { annualAllotment, isPtoEligible, summarizeYear, isWeekday } = require('./pto');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 5; // weekdays consumed by one granted week

// Note stamped on RosterAvailability rows the engine writes, so re-running
// allocation can clear ONLY builder-written PTO without touching ad-hoc PTO.
const builderNote = (year) => `PTO Builder ${year}`;

// Monday (UTC, midnight) of the week containing `d`.
function mondayOf(d) {
  const date = new Date(d);
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow; // back to Monday
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta));
}

// All Monday week-starts whose Monday falls in `year` (the pickable weeks).
function weeksOfYear(year) {
  const out = [];
  let d = mondayOf(new Date(Date.UTC(year, 0, 1)));
  // Ensure we start on/after Jan 1's week — include the first Monday >= Jan 1.
  if (d.getUTCFullYear() < year) d = new Date(d.getTime() + 7 * DAY_MS);
  while (d.getUTCFullYear() === year) {
    out.push(new Date(d));
    d = new Date(d.getTime() + 7 * DAY_MS);
  }
  return out;
}

// The five weekday dates (Mon–Fri) of a week given its Monday weekStart.
function weekdayDatesOf(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(weekStart).getTime() + i * DAY_MS);
    if (isWeekday(d)) days.push(d);
  }
  return days;
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);

// Seniority comparator: lower seniorityRank = more senior = wins. Nulls sort
// last (least senior). Deterministic tie-break by createdAt then id.
function bySeniority(a, b) {
  const ra = a.entry.seniorityRank, rb = b.entry.seniorityRank;
  if (ra != null && rb != null && ra !== rb) return ra - rb;
  if (ra != null && rb == null) return -1;
  if (ra == null && rb != null) return 1;
  const ta = new Date(a.bid.createdAt).getTime(), tb = new Date(b.bid.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.entry.id < b.entry.id ? -1 : 1;
}

// Run (or re-run) allocation for a window. Idempotent: clears prior builder
// allocations + builder-written PTO rows, then recomputes from current bids.
// Returns { granted, waitlisted } counts.
async function runAllocation(windowId) {
  const window = await prisma.ptoWindow.findUnique({
    where: { id: windowId },
    include: { capacities: true },
  });
  if (!window) throw new Error('Window not found');

  const bids = await prisma.ptoBid.findMany({
    where: { windowId },
    include: { rosterEntry: true },
  });

  // Per-week capacity: override row wins, else the window default.
  const capByWeek = new Map();
  for (const c of window.capacities) {
    if (c.mode === 'GLOBAL') capByWeek.set(iso(c.weekStart), c.capacity);
  }
  const capacityFor = (weekStart) => {
    const v = capByWeek.get(iso(weekStart));
    return v != null ? v : window.defaultWeeklyCapacity;
  };

  // Eligible bidders only; index their entries.
  const entriesById = new Map();
  for (const b of bids) {
    if (isPtoEligible(b.rosterEntry)) entriesById.set(b.rosterEntry.id, b.rosterEntry);
  }

  // Remaining annual allotment (in weekday-days) per provider. The annual
  // budget already-consumed by ad-hoc / prior PTO this year is subtracted so
  // the builder never over-grants. Computed BEFORE we write anything.
  const summary = await summarizeYear({
    facilityId: window.facilityId,
    entries: [...entriesById.values()],
    year: window.year,
    asOf: null,
  });
  const remainingDays = new Map();
  for (const [id, entry] of entriesById) {
    const used = summary.get(id)?.granted || 0;
    remainingDays.set(id, Math.max(0, annualAllotment(entry) - used));
  }

  const weekRemaining = new Map(); // weekStart iso -> seats left

  const granted = []; // { bid, entry }
  const waitlistByWeek = new Map(); // weekStart iso -> [{ bid, entry }] in want-order

  // Tier loop: grant everyone's rank-1 (within capacity) before any rank-2, etc.
  for (let r = 1; r <= window.maxRanks; r++) {
    // Group this tier's bids by week.
    const byWeek = new Map();
    for (const bid of bids) {
      if (bid.rank !== r) continue;
      const entry = entriesById.get(bid.rosterEntryId);
      if (!entry) continue; // ineligible bidder
      const k = iso(bid.weekStart);
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k).push({ bid, entry });
    }

    for (const [weekKey, candidates] of byWeek) {
      if (!weekRemaining.has(weekKey)) weekRemaining.set(weekKey, capacityFor(candidates[0].bid.weekStart));
      candidates.sort(bySeniority);
      for (const c of candidates) {
        const seats = weekRemaining.get(weekKey);
        const days = remainingDays.get(c.entry.id) || 0;
        if (seats > 0 && days >= WEEK_DAYS) {
          weekRemaining.set(weekKey, seats - 1);
          remainingDays.set(c.entry.id, days - WEEK_DAYS);
          granted.push(c);
        } else {
          if (!waitlistByWeek.has(weekKey)) waitlistByWeek.set(weekKey, []);
          waitlistByWeek.get(weekKey).push(c); // already in rank→seniority order
        }
      }
    }
  }

  // Persist: clear prior results, then write allocations + granted PTO rows.
  await prisma.$transaction(async (tx) => {
    await tx.ptoAllocation.deleteMany({ where: { windowId } });
    await tx.rosterAvailability.deleteMany({
      where: { facilityId: window.facilityId, source: 'PTO', note: builderNote(window.year) },
    });

    for (const g of granted) {
      await tx.ptoAllocation.create({
        data: {
          windowId, rosterEntryId: g.entry.id, weekStart: g.bid.weekStart,
          rank: g.bid.rank, status: 'GRANTED',
        },
      });
      for (const d of weekdayDatesOf(g.bid.weekStart)) {
        await tx.rosterAvailability.upsert({
          where: { rosterEntryId_date: { rosterEntryId: g.entry.id, date: d } },
          create: { rosterEntryId: g.entry.id, facilityId: window.facilityId, date: d, available: false, source: 'PTO', note: builderNote(window.year) },
          update: { available: false, source: 'PTO', note: builderNote(window.year) },
        });
      }
    }

    let waitCount = 0;
    for (const [, list] of waitlistByWeek) {
      list.forEach((w, i) => { w._pos = i + 1; });
      for (const w of list) {
        await tx.ptoAllocation.create({
          data: {
            windowId, rosterEntryId: w.entry.id, weekStart: w.bid.weekStart,
            rank: w.bid.rank, status: 'WAITLISTED', waitlistPos: w._pos,
          },
        });
        waitCount += 1;
      }
    }

    await tx.ptoWindow.update({ where: { id: windowId }, data: { status: 'ALLOCATED' } });
  });

  const waitlisted = [...waitlistByWeek.values()].reduce((n, l) => n + l.length, 0);
  return { granted: granted.length, waitlisted };
}

// Promote one waitlisted allocation to GRANTED (manual admin action, or called
// by auto-promote). Writes the week's PTO rows; renumbers the week's remaining
// waitlist. Guards capacity + the provider's remaining allotment.
async function promoteAllocation(allocationId, { force = false } = {}) {
  const alloc = await prisma.ptoAllocation.findUnique({
    where: { id: allocationId },
    include: { window: true, rosterEntry: true },
  });
  if (!alloc) throw new Error('Allocation not found');
  if (alloc.status === 'GRANTED') return { ok: true, already: true };

  const weekKey = iso(alloc.weekStart);
  const grantedThisWeek = await prisma.ptoAllocation.count({
    where: { windowId: alloc.windowId, weekStart: alloc.weekStart, status: 'GRANTED' },
  });
  const capRow = await prisma.ptoWeekCapacity.findFirst({
    where: { windowId: alloc.windowId, weekStart: alloc.weekStart, mode: 'GLOBAL' },
  });
  const capacity = capRow ? capRow.capacity : alloc.window.defaultWeeklyCapacity;
  if (!force && grantedThisWeek >= capacity) {
    throw new Error('Week is at capacity');
  }

  await prisma.$transaction(async (tx) => {
    await tx.ptoAllocation.update({
      where: { id: alloc.id },
      data: { status: 'GRANTED', waitlistPos: null, decidedAt: new Date() },
    });
    for (const d of weekdayDatesOf(alloc.weekStart)) {
      await tx.rosterAvailability.upsert({
        where: { rosterEntryId_date: { rosterEntryId: alloc.rosterEntryId, date: d } },
        create: { rosterEntryId: alloc.rosterEntryId, facilityId: alloc.window.facilityId, date: d, available: false, source: 'PTO', note: builderNote(alloc.window.year) },
        update: { available: false, source: 'PTO', note: builderNote(alloc.window.year) },
      });
    }
    // Renumber the rest of this week's waitlist.
    const rest = await tx.ptoAllocation.findMany({
      where: { windowId: alloc.windowId, weekStart: alloc.weekStart, status: 'WAITLISTED' },
      orderBy: { waitlistPos: 'asc' },
    });
    let pos = 1;
    for (const w of rest) {
      await tx.ptoAllocation.update({ where: { id: w.id }, data: { waitlistPos: pos++ } });
    }
  });
  return { ok: true };
}

// Cancel a GRANTED allocation (provider gives up the week). Clears its PTO
// rows and auto-promotes the top waitlisted provider for that week if any can
// take it (still has allotment). Returns the promoted allocation id or null.
async function cancelAllocation(allocationId) {
  const alloc = await prisma.ptoAllocation.findUnique({
    where: { id: allocationId },
    include: { window: true },
  });
  if (!alloc) throw new Error('Allocation not found');

  await prisma.$transaction(async (tx) => {
    await tx.ptoAllocation.delete({ where: { id: alloc.id } });
    for (const d of weekdayDatesOf(alloc.weekStart)) {
      await tx.rosterAvailability.deleteMany({
        where: { rosterEntryId: alloc.rosterEntryId, date: d, source: 'PTO', note: builderNote(alloc.window.year) },
      });
    }
  });

  // Auto-promote: top of this week's waitlist that still has allotment room.
  const waitlist = await prisma.ptoAllocation.findMany({
    where: { windowId: alloc.windowId, weekStart: alloc.weekStart, status: 'WAITLISTED' },
    orderBy: { waitlistPos: 'asc' },
    include: { rosterEntry: true },
  });
  for (const w of waitlist) {
    const summary = await summarizeYear({
      facilityId: alloc.window.facilityId, entries: [w.rosterEntry], year: alloc.window.year, asOf: null,
    });
    const used = summary.get(w.rosterEntryId)?.granted || 0;
    if (annualAllotment(w.rosterEntry) - used >= WEEK_DAYS) {
      await promoteAllocation(w.id, { force: true });
      return { canceled: alloc.id, promoted: w.id };
    }
  }
  return { canceled: alloc.id, promoted: null };
}

module.exports = {
  mondayOf, weeksOfYear, weekdayDatesOf, builderNote, iso,
  runAllocation, promoteAllocation, cancelAllocation,
};
