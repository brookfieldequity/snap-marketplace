/**
 * The Living Month Draft (Wave 4, 2026-07-31) — allocation-driven auto-draft.
 * Locked design (Matt + Claude, 7/29 night):
 *
 *   Q1 — No pattern engine. The draft brains = roster location percentages
 *        (ProviderLocation.shiftSharePct) + PTO bible + room counts.
 *        FT/W2 = "available except PTO" (no availability needed); per-diems
 *        enter as GHOST/proposed slots until availability returns.
 *   Q3 — Touch = lock. Anything a coordinator touches (placedBy HUMAN, and
 *        every pre-engine row where placedBy is null) is IMMOVABLE. The
 *        machine is maximally calm: a re-run only FILLS empty slots and
 *        re-evaluates its own GHOSTS — it never moves a real placement,
 *        its own included. Every run emits a diff receipt.
 *   Q4 — Flag everything, fix nothing: contradictions the run discovers are
 *        left for the Wave 3.3 flag engine; the draft never deletes a real
 *        placement to resolve one.
 *
 * Ghost rules: ghosts are recomputed from scratch every run (they are
 * proposals, not commitments). A prior ghost that gets re-placed for real
 * (availability came back YES) is reported as CONFIRMED; a prior ghost whose
 * provider explicitly declined is reported as WITHDRAWN. Ghosts never count
 * against maxShiftsPerMonth, never leak to share/provider views, and are
 * never made real by publish.
 *
 * A slot is fillable when no assignment row exists for it, or the existing
 * row has rosterId null AND was not human-cleared (a coordinator emptying a
 * seat is a touch — the machine does not refill it; that graduates to a
 * suggestion in Wave 5).
 */

const prisma = require('../config/db');
const {
  loadProviderLocations,
  isEligibleForLocation,
  placementTierScore,
  SUPERVISOR_ROOM_BASE,
} = require('./scheduleBuilder');
const { assembleMonthSignals } = require('./scheduleSignals');

const isoOf = (d) => new Date(d).toISOString().slice(0, 10);

// Allocation dominates (Q1: percentages are the brains); employment
// preference expresses "FT must work anyway"; request tiers nudge.
const SHARE_WEIGHT = 3.0;
const EMP_PREF = { FULL_TIME: 0.6, PART_TIME: 0.4, PER_DIEM: 0.2, LOCUMS: 0.1 };
const TIER_WORK_BONUS = { 1: 0.9, 2: 0.6, 3: 0.35, 4: 0.15 };
const TIER_DAYOFF_PENALTY = { 2: 0.5, 3: 0.3, 4: 0.15 };

async function runMonthDraft(facilityId, year, month) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [days, roster] = await Promise.all([
    prisma.scheduleDay.findMany({
      where: { facilityId, date: { gte: monthStart, lt: monthEnd } },
      include: { assignments: { include: { rosterEntry: { select: { providerName: true } } } } },
    }),
    prisma.internalRosterEntry.findMany({ where: { facilityId } }),
  ]);
  if (days.length === 0) return { error: 'NO_DAYS' };
  if (roster.length === 0) return { error: 'NO_ROSTER' };

  const signals = await assembleMonthSignals({ facilityId, year, month, roster, scheduleDays: days });
  const { unavailableKeys, defaultOffKeys, explicitOffKeys, ptoSet, workRequestKeys, dayOffSoftKeys } = signals;

  // ── Wave 5: earned automation rules (per-type, facility opt-in) ────────
  // Enforcement lives HERE and only here: at draft time, on MACHINE-placed
  // rows only. A rule never touches a human placement. Every auto-action
  // lands in the diff receipt so nothing happens silently.
  const rules = await prisma.facilityFlagRule.findMany({
    where: { facilityId, enabled: true },
    select: { flagType: true, action: true },
  }).catch(() => []);
  const ruleSet = new Set(rules.map((r) => `${r.flagType}:${r.action}`));
  const autoFixed = [];

  // Rule: accept the site's returned card when it disagrees with a
  // NON-admin-set built day (admin-set counts are the coordinator's explicit
  // word — a rule never overrides them).
  if (ruleSet.has('ROOM_COUNT_MISMATCH:SET_ROOMS')) {
    const cards = await prisma.roomCountRequest.findMany({
      where: { facilityId, year, month, submittedAt: { not: null } },
      select: { location: true, dayCounts: { select: { date: true, roomsRequired: true } } },
    });
    const cardByKey = new Map();
    for (const c of cards) {
      for (const dc of c.dayCounts) cardByKey.set(`${isoOf(dc.date)}::${c.location}`, dc.roomsRequired);
    }
    for (const day of days) {
      // Pre-publish only: published days are Paula's, loud-flag territory.
      if (day.publishedAt) continue;
      const key = `${isoOf(day.date)}::${day.location}`;
      const cardRooms = cardByKey.get(key);
      if (cardRooms != null && cardRooms > 0 && !day.roomsAdminSet && day.roomsRequired !== cardRooms) {
        await prisma.scheduleDay.update({ where: { id: day.id }, data: { roomsRequired: cardRooms } });
        autoFixed.push({
          kind: 'AUTO_FIXED', date: isoOf(day.date), location: day.location,
          providerName: '', roomNumber: 0,
          detail: `room count ${day.roomsRequired} → ${cardRooms} (site's card; your rule)`,
        });
        day.roomsRequired = cardRooms;
      }
    }
  }

  // Rules: auto-unassign MACHINE-placed providers who are on PTO / said no.
  // Freed seats refill in the normal pass below with someone available.
  const unassignPto = ruleSet.has('PTO_CONFLICT:UNASSIGN');
  const unassignSaidNo = ruleSet.has('SAID_UNAVAILABLE:UNASSIGN');
  if (unassignPto || unassignSaidNo) {
    for (const day of days) {
      // Pre-publish only (locked pre/post split): a published day's conflict
      // is a LOUD flag for the coordinator, never a silent auto-removal —
      // notifications and judgment belong to a human there.
      if (day.publishedAt) continue;
      const dISO = isoOf(day.date);
      for (const a of day.assignments) {
        if (!a.rosterId || a.ghost || a.placedBy !== 'MACHINE') continue;
        const key = `${a.rosterId}::${dISO}`;
        const hitPto = unassignPto && ptoSet.has(key);
        const hitSaidNo = unassignSaidNo && explicitOffKeys.has(key);
        if (!hitPto && !hitSaidNo) continue;
        await prisma.scheduleAssignment.update({
          where: { id: a.id },
          data: { rosterId: null }, // stays placedBy MACHINE → machine may refill
        });
        autoFixed.push({
          kind: 'AUTO_FIXED', date: dISO, location: day.location,
          providerName: a.rosterEntry?.providerName || 'Provider', roomNumber: a.roomNumber,
          detail: hitPto ? 'removed — on PTO (your rule); refilling below' : 'removed — said unavailable (your rule); refilling below',
        });
        a.rosterId = null; // reflect in memory so the fill pass sees the free seat
      }
    }
  }
  const locationData = await loadProviderLocations(roster.map((r) => r.id));
  const { shareByRoster } = locationData;
  const rosterById = new Map(roster.map((r) => [r.id, r]));

  // ── Snapshot prior ghosts, then clear them (proposals are recomputed) ──
  const priorGhosts = [];
  for (const day of days) {
    for (const a of day.assignments) {
      if (a.ghost && a.rosterId) {
        priorGhosts.push({
          key: `${a.rosterId}::${isoOf(day.date)}`,
          rosterId: a.rosterId,
          date: isoOf(day.date),
          location: day.location,
          roomNumber: a.roomNumber,
          providerName: a.rosterEntry?.providerName || 'Provider',
        });
      }
    }
  }
  await prisma.scheduleAssignment.deleteMany({
    where: { facilityId, ghost: true, scheduleDay: { date: { gte: monthStart, lt: monthEnd } } },
  });

  // ── Kept (immovable) placements: everything real ───────────────────────
  const consumed = new Set(); // `${rosterId}::${iso}` — one seat per person per day
  const locCount = new Map(); // `${rosterId}::${location}` — includes kept rows
  const totCount = new Map();
  const shiftsThisMonth = new Map(); // rosterId → real day count (maxShiftsPerMonth)
  for (const day of days) {
    const dISO = isoOf(day.date);
    for (const a of day.assignments) {
      if (a.ghost || !a.rosterId) continue;
      consumed.add(`${a.rosterId}::${dISO}`);
      locCount.set(`${a.rosterId}::${day.location}`, (locCount.get(`${a.rosterId}::${day.location}`) || 0) + 1);
      totCount.set(a.rosterId, (totCount.get(a.rosterId) || 0) + 1);
      shiftsThisMonth.set(a.rosterId, (shiftsThisMonth.get(a.rosterId) || 0) + 1);
    }
  }

  const shareDeficit = (rosterId, location) => {
    const shares = shareByRoster.get(rosterId);
    if (!shares) return 0;
    const pct = shares.get(location);
    if (pct == null) return 0;
    const target = pct / 100;
    const tot = totCount.get(rosterId) || 0;
    const loc = locCount.get(`${rosterId}::${location}`) || 0;
    return Math.max(0, target - (tot > 0 ? loc / tot : 0));
  };
  const workBonus = (rosterId, dISO, location) => {
    const req = workRequestKeys.get(`${rosterId}::${dISO}`);
    if (!req) return 0;
    return (TIER_WORK_BONUS[req.tier] ?? 0.35) * (!req.siteName || req.siteName === location ? 1 : 0.4);
  };
  const offPenalty = (rosterId, dISO) => {
    const req = dayOffSoftKeys.get(`${rosterId}::${dISO}`);
    return req ? (TIER_DAYOFF_PENALTY[req.tier] || 0) : 0;
  };
  const overMonthlyCap = (r) =>
    r.maxShiftsPerMonth != null && (shiftsThisMonth.get(r.id) || 0) >= r.maxShiftsPerMonth;

  // ghostPass=false → real candidates (available); true → per-diems whose
  // only obstacle is the employment default (no explicit signal either way).
  const pickBest = (day, dISO, rolePredicate, ghostPass) => {
    const ranked = roster
      .filter((r) => r.providerType && !r.isNonClinical)
      .filter(rolePredicate)
      .filter((r) => !consumed.has(`${r.id}::${dISO}`))
      .filter((r) => (ghostPass
        ? defaultOffKeys.has(`${r.id}::${dISO}`)
        : !unavailableKeys.has(`${r.id}::${dISO}`)))
      .filter((r) => !overMonthlyCap(r))
      .filter((r) => isEligibleForLocation(r.id, day.location, locationData))
      .map((r) => ({
        entry: r,
        score:
          SHARE_WEIGHT * shareDeficit(r.id, day.location)
          + (EMP_PREF[r.employmentCategory] || 0.2)
          + 0.1 * placementTierScore(r)
          + workBonus(r.id, dISO, day.location)
          - offPenalty(r.id, dISO),
      }))
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    return ranked[0] || null;
  };

  // ── Fill ───────────────────────────────────────────────────────────────
  const receipt = [];
  const writes = [];
  const priorGhostByKey = new Map(priorGhosts.map((g) => [g.key, g]));

  const place = (day, dISO, pick, roomNumber, role, ghost) => {
    consumed.add(`${pick.entry.id}::${dISO}`);
    locCount.set(`${pick.entry.id}::${day.location}`, (locCount.get(`${pick.entry.id}::${day.location}`) || 0) + 1);
    totCount.set(pick.entry.id, (totCount.get(pick.entry.id) || 0) + 1);
    if (!ghost) shiftsThisMonth.set(pick.entry.id, (shiftsThisMonth.get(pick.entry.id) || 0) + 1);
    writes.push({ scheduleDayId: day.id, roomNumber, rosterId: pick.entry.id, role, ghost });
    const wasGhost = priorGhostByKey.get(`${pick.entry.id}::${dISO}`);
    receipt.push({
      kind: ghost ? 'PROPOSED' : wasGhost ? 'CONFIRMED' : 'FILLED',
      date: dISO,
      location: day.location,
      roomNumber,
      providerName: pick.entry.providerName,
    });
  };

  const sortedDays = [...days].sort((a, b) =>
    `${isoOf(a.date)}::${a.location}`.localeCompare(`${isoOf(b.date)}::${b.location}`));

  for (const day of sortedDays) {
    const dISO = isoOf(day.date);
    const isCrna = (r) => r.providerType === 'CRNA';
    const isMd = (r) => r.providerType === 'ANESTHESIOLOGIST';
    const ratio = day.supervisionRatio;

    // Real (non-ghost) rows currently occupying seats; human-cleared seats
    // are blocked (touch = lock applies to emptying a seat too).
    const realRows = day.assignments.filter((a) => !a.ghost);
    const occupied = new Set(realRows.filter((a) => a.rosterId).map((a) => a.roomNumber));
    const blocked = new Set(realRows.filter((a) => !a.rosterId && a.placedBy === 'HUMAN').map((a) => a.roomNumber));
    const fillableRooms = [];
    for (let n = 1; n <= (day.roomsRequired || 1); n++) {
      if (!occupied.has(n) && !blocked.has(n)) fillableRooms.push(n);
    }

    const fillRoom = (roomNumber, primaryPred, backfillPred, primaryRole, backfillRole) => {
      let pick = pickBest(day, dISO, primaryPred, false);
      let role = primaryRole;
      if (!pick && backfillPred) {
        pick = pickBest(day, dISO, backfillPred, false);
        role = backfillRole;
      }
      if (pick) { place(day, dISO, pick, roomNumber, role, false); return true; }
      // Ghost pass: propose a per-diem whose availability simply hasn't
      // come back yet — the "intended shape" of the month.
      pick = pickBest(day, dISO, primaryPred, true);
      role = primaryRole;
      if (!pick && backfillPred) {
        pick = pickBest(day, dISO, backfillPred, true);
        role = backfillRole;
      }
      if (pick) { place(day, dISO, pick, roomNumber, role, true); return true; }
      return false;
    };

    if (ratio === 3 || ratio === 4) {
      for (const n of fillableRooms) fillRoom(n, isCrna, isMd, 'CRNA_ROOM', 'SOLO_MD_ROOM');
      // Supervisors for ALL real CRNA rooms (kept + new), packed at 1:ratio.
      const crnaRooms = day.assignments.filter((a) => !a.ghost && a.rosterId && a.role === 'CRNA_ROOM').length
        + writes.filter((w) => w.scheduleDayId === day.id && !w.ghost && w.role === 'CRNA_ROOM').length;
      const needed = Math.ceil(crnaRooms / ratio);
      const haveSup = realRows.filter((a) => a.rosterId && a.role === 'SUPERVISING_MD').length;
      const supRoomsTaken = new Set(realRows.filter((a) => a.roomNumber >= SUPERVISOR_ROOM_BASE).map((a) => a.roomNumber));
      let nextSup = SUPERVISOR_ROOM_BASE;
      for (let s = haveSup; s < needed; s++) {
        while (supRoomsTaken.has(nextSup)) nextSup++;
        const pick = pickBest(day, dISO, isMd, false) || pickBest(day, dISO, isMd, true);
        if (!pick) break;
        const isGhost = unavailableKeys.has(`${pick.entry.id}::${dISO}`);
        place(day, dISO, pick, nextSup, 'SUPERVISING_MD', isGhost);
        supRoomsTaken.add(nextSup);
      }
    } else if (ratio === 0) {
      for (const n of fillableRooms) fillRoom(n, isMd, null, 'SOLO_MD_ROOM', null);
    } else {
      for (const n of fillableRooms) fillRoom(n, () => true, null, null, null);
    }
  }

  // Prior ghosts that did NOT come back: withdrawn (provider explicitly said
  // no / went on PTO) vs simply still-proposed-elsewhere or superseded.
  for (const g of priorGhosts) {
    const stillPlaced = writes.some((w) => w.rosterId === g.rosterId
      && days.find((d) => d.id === w.scheduleDayId && isoOf(d.date) === g.date));
    if (stillPlaced) continue;
    if (unavailableKeys.has(g.key) && !defaultOffKeys.has(g.key)) {
      receipt.push({
        kind: 'WITHDRAWN',
        date: g.date,
        location: g.location,
        roomNumber: g.roomNumber,
        providerName: g.providerName,
        detail: 'said no / became unavailable — proposal removed',
      });
    }
  }

  // ── Write ──────────────────────────────────────────────────────────────
  for (const w of writes) {
    await prisma.scheduleAssignment.upsert({
      where: { scheduleDayId_roomNumber: { scheduleDayId: w.scheduleDayId, roomNumber: w.roomNumber } },
      update: { rosterId: w.rosterId, role: w.role, placedBy: 'MACHINE', ghost: w.ghost },
      create: {
        scheduleDayId: w.scheduleDayId,
        roomNumber: w.roomNumber,
        rosterId: w.rosterId,
        facilityId,
        role: w.role,
        placedBy: 'MACHINE',
        ghost: w.ghost,
      },
    });
  }

  // Auto-fixed rule actions lead the receipt — they happened first and the
  // coordinator must see them before the fills that followed.
  receipt.unshift(...autoFixed);

  const filled = receipt.filter((r) => r.kind === 'FILLED').length;
  const ghosts = receipt.filter((r) => r.kind === 'PROPOSED').length;
  const confirmed = receipt.filter((r) => r.kind === 'CONFIRMED').length;
  const withdrawn = receipt.filter((r) => r.kind === 'WITHDRAWN').length;
  const auto = autoFixed.length;
  const parts = [];
  if (auto) parts.push(`auto-fixed ${auto} (your rules)`);
  if (filled) parts.push(`filled ${filled}`);
  if (confirmed) parts.push(`confirmed ${confirmed}`);
  if (ghosts) parts.push(`proposed ${ghosts}`);
  if (withdrawn) parts.push(`withdrew ${withdrawn}`);
  const summary = parts.length
    ? `${auto + filled + confirmed + ghosts + withdrawn} change(s): ${parts.join(', ')}`
    : 'No changes — the draft is already as good as the machine can make it.';

  const run = await prisma.monthDraftRun.create({
    data: {
      facilityId,
      year,
      month,
      receipt: { summary, entries: receipt.slice(0, 200) },
      filled,
      ghosts,
      confirmed,
      withdrawn,
    },
  });

  return { runId: run.id, summary, filled, ghosts, confirmed, withdrawn, entries: receipt };
}

module.exports = { runMonthDraft };
