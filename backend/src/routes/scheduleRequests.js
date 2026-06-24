// Provider schedule requests (Task #21).
//
// Provider side (auth.js — req.user):
//   POST   /schedule-requests          → create a DAY_OFF or WORK request
//   GET    /schedule-requests/mine      → my requests across facilities
//   DELETE /schedule-requests/:id       → cancel my own pending request
//
// Facility side (facilityAuth — req.facility):
//   GET    /schedule-requests          → this facility's requests (?status=)
//   POST   /schedule-requests/:id/decide → accept | decline
//
// Accepted requests become builder constraints:
//   - DAY_OFF accepted → also writes a RosterTimeOff row so the builder hard-
//     excludes the provider that date (auto-build already honors RosterTimeOff).
//   - WORK accepted → a strong preference the builder reads (see scheduleBuilder).

const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const facilityAuth = require('../middleware/facilityAuth');
const { recordNotification } = require('../services/notifications');

const router = express.Router();

const VALID_TYPES = ['DAY_OFF', 'WORK', 'PTO'];
const DAY_MS = 24 * 60 * 60 * 1000;

const dateOnly = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00.000Z`);

// Priority tier the builder consumes (see ScheduleRequest.tier). When an admin
// accepts without naming a tier, WORK defaults to Strong (2 — matches the
// pre-tier builder weight) and DAY_OFF defaults to Locked (1 — an accepted day
// off should be honored). PTO has no tier (it runs through the PTO Builder).
function resolveTier(type, tier) {
  if (type === 'PTO') return null;
  const t = tier == null ? (type === 'WORK' ? 2 : 1) : Number(tier);
  if (![1, 2, 3, 4].includes(t)) return type === 'WORK' ? 2 : 1;
  return t;
}

// A Tier-1 DAY_OFF is a HARD exclude — materialize/refresh its RosterTimeOff so
// the builder never schedules the provider across the span. Any other state
// (declined, downgraded to a soft tier 2–4, or a non-DAY_OFF) clears the
// request-managed time-off so a re-triage doesn't leave a stale hard block.
async function syncDayOffTimeOff(tx, request, facilityId) {
  const isHardOff =
    request.status === 'ACCEPTED' && request.type === 'DAY_OFF' && request.tier === 1;
  if (isHardOff) {
    const spanEnd = request.endDate || request.date;
    await tx.rosterTimeOff.upsert({
      where: { scheduleRequestId: request.id },
      create: {
        facilityId,
        rosterEntryId: request.rosterEntryId,
        startDate: request.date,
        endDate: spanEnd,
        reason: 'Approved day-off request (Tier 1 — locked)',
        scheduleRequestId: request.id,
      },
      update: {
        startDate: request.date,
        endDate: spanEnd,
        reason: 'Approved day-off request (Tier 1 — locked)',
      },
    });
  } else {
    await tx.rosterTimeOff.deleteMany({ where: { scheduleRequestId: request.id } });
  }
}

// PTO accept → write source='PTO' RosterAvailability rows across the span (shows
// on the calendar, counts toward the allotment, hard-excludes in the builder).
async function writePtoAvailability(tx, request, facilityId) {
  const spanEnd = request.endDate || request.date;
  for (let d = new Date(request.date); d <= spanEnd; d = new Date(d.getTime() + DAY_MS)) {
    const dateObj = new Date(d);
    await tx.rosterAvailability.upsert({
      where: { rosterEntryId_date: { rosterEntryId: request.rosterEntryId, date: dateObj } },
      create: {
        rosterEntryId: request.rosterEntryId,
        facilityId,
        date: dateObj,
        available: false,
        source: 'PTO',
        note: 'Approved PTO request',
      },
      update: { available: false, source: 'PTO', note: 'Approved PTO request' },
    });
  }
}

// Notify the provider their request was answered (no-op if not app-linked).
async function notifyDecision(request, newStatus, facilityName) {
  if (!request.rosterEntry?.linkedProviderId) return;
  const fmt = (d) =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const dateStr =
    request.endDate && request.endDate > request.date
      ? `${fmt(request.date)} – ${fmt(request.endDate)}`
      : fmt(request.date);
  const verb =
    request.type === 'DAY_OFF' ? 'day off' : request.type === 'PTO' ? 'PTO' : 'request to work';
  const past = newStatus === 'ACCEPTED' ? 'approved' : 'declined';
  await recordNotification(request.rosterEntry.linkedProviderId, {
    type: 'REQUEST_ANSWERED',
    title: `Your ${verb} for ${dateStr} was ${past}`,
    body: `${facilityName} ${past} your ${verb} request for ${dateStr}.`,
    data: {
      scheduleRequestId: request.id,
      status: newStatus,
      date: request.date,
      endDate: request.endDate,
    },
  });
}

async function resolveProfileId(req) {
  if (req.user?.profileId) return req.user.profileId;
  if (!req.user?.userId) return null;
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: req.user.userId },
    select: { id: true },
  });
  return profile?.id || null;
}

// Find the roster entry linking this provider to a facility. Requests are
// scoped to a roster membership so the builder can join on rosterId.
async function findRosterEntry(facilityId, providerId) {
  return prisma.internalRosterEntry.findFirst({
    where: { facilityId, linkedProviderId: providerId },
    select: { id: true, providerName: true, facility: { select: { name: true } } },
  });
}

// ── Provider: create a request ────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });

    const { facilityId, type, date, endDate, siteName, note } = req.body || {};
    if (!facilityId || !type || !date) {
      return res.status(400).json({ error: 'facilityId, type, and date are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    // endDate (optional) makes the request a span [date, endDate]. Used for PTO
    // (e.g. a Mon–Fri week) but allowed for any type. Must not precede date.
    let end = null;
    if (endDate) {
      end = dateOnly(endDate);
      if (end < dateOnly(date)) {
        return res.status(400).json({ error: 'endDate must be on or after date' });
      }
      if ((end - dateOnly(date)) / DAY_MS > 366) {
        return res.status(400).json({ error: 'Range too large (max 1 year)' });
      }
    }

    const roster = await findRosterEntry(facilityId, providerId);
    if (!roster) {
      return res.status(403).json({ error: 'You are not on this facility roster' });
    }

    const request = await prisma.scheduleRequest.create({
      data: {
        facilityId,
        rosterEntryId: roster.id,
        type,
        date: dateOnly(date),
        endDate: end,
        siteName: siteName || null,
        note: note || null,
      },
    });
    res.status(201).json(request);
  } catch (err) {
    console.error('[schedule-requests] create failed:', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// ── Provider: my requests ─────────────────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.json({ requests: [] });
    const requests = await prisma.scheduleRequest.findMany({
      where: { rosterEntry: { linkedProviderId: providerId } },
      orderBy: { date: 'desc' },
      include: { facility: { select: { name: true } } },
    });
    res.json({ requests });
  } catch (err) {
    console.error('[schedule-requests] mine failed:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// ── Provider: cancel own pending request ──────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });
    const result = await prisma.scheduleRequest.deleteMany({
      where: {
        id: req.params.id,
        status: 'PENDING',
        rosterEntry: { linkedProviderId: providerId },
      },
    });
    res.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error('[schedule-requests] cancel failed:', err);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

// ── Facility: list requests ───────────────────────────────────────────────────
router.get('/', facilityAuth, async (req, res) => {
  try {
    const status = req.query.status; // optional PENDING | ACCEPTED | DECLINED
    const requests = await prisma.scheduleRequest.findMany({
      where: { facilityId: req.facility.id, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { date: 'asc' }],
      include: { rosterEntry: { select: { providerName: true, providerType: true, seniorityRank: true } } },
    });
    res.json({ requests });
  } catch (err) {
    console.error('[schedule-requests] facility list failed:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// ── Facility: decide a single request (accept | decline), with optional tier ──
// Body: { decision: "accept" | "decline", tier?: 1|2|3|4 }
// On accept, WORK/DAY_OFF get a priority tier (see resolveTier). DAY_OFF Tier-1
// materializes a hard RosterTimeOff; tiers 2–4 stay soft (builder-weighted).
router.post('/:id/decide', facilityAuth, async (req, res) => {
  try {
    const { decision, tier } = req.body || {}; // "accept" | "decline"
    if (!['accept', 'decline'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "accept" or "decline"' });
    }

    const request = await prisma.scheduleRequest.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      include: {
        rosterEntry: { select: { id: true, linkedProviderId: true, providerName: true } },
      },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: `Request already ${request.status.toLowerCase()}` });
    }

    const newStatus = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
    const newTier = decision === 'accept' ? resolveTier(request.type, tier) : null;

    await prisma.$transaction(async (tx) => {
      await tx.scheduleRequest.update({
        where: { id: request.id },
        data: { status: newStatus, tier: newTier, decidedAt: new Date(), decidedBy: req.user?.userId || null },
      });
      const updated = { ...request, status: newStatus, tier: newTier };
      if (request.type === 'PTO') {
        if (newStatus === 'ACCEPTED') await writePtoAvailability(tx, request, req.facility.id);
      } else {
        await syncDayOffTimeOff(tx, updated, req.facility.id);
      }
    });

    await notifyDecision(request, newStatus, req.facility.name);
    res.json({ ok: true, status: newStatus, tier: newTier });
  } catch (err) {
    console.error('[schedule-requests] decide failed:', err);
    res.status(500).json({ error: 'Failed to decide request' });
  }
});

// ── Facility: bulk triage (the tier board's Save) ─────────────────────────────
// Body: { items: [{ id, status: "ACCEPTED"|"DECLINED"|"PENDING", tier?, manualOrder? }] }
// Applies the admin's tier assignment + within-tier manual order in one save.
// WORK/DAY_OFF only — PTO is decided via /decide. Notifies on PENDING→decided.
router.put('/triage', facilityAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: 'items array required' });
    if (items.length > 500) return res.status(400).json({ error: 'Too many items (max 500)' });

    const ids = items.map((i) => i.id).filter(Boolean);
    const existing = await prisma.scheduleRequest.findMany({
      where: { id: { in: ids }, facilityId: req.facility.id, type: { in: ['WORK', 'DAY_OFF'] } },
      include: { rosterEntry: { select: { linkedProviderId: true, providerName: true } } },
    });
    const byId = new Map(existing.map((r) => [r.id, r]));

    const toNotify = []; // { request, newStatus }
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const current = byId.get(item.id);
        if (!current) continue; // unknown id, wrong facility, or PTO — skip
        const status = ['ACCEPTED', 'DECLINED', 'PENDING'].includes(item.status)
          ? item.status
          : current.status;
        const tier = status === 'ACCEPTED' ? resolveTier(current.type, item.tier) : null;
        const manualOrder =
          item.manualOrder == null ? null : Math.max(0, Math.trunc(Number(item.manualOrder)));
        const decided = status !== 'PENDING';

        await tx.scheduleRequest.update({
          where: { id: current.id },
          data: {
            status,
            tier,
            manualOrder,
            decidedAt: decided ? new Date() : null,
            decidedBy: decided ? req.user?.userId || null : null,
          },
        });
        await syncDayOffTimeOff(tx, { ...current, status, tier }, req.facility.id);

        if (current.status === 'PENDING' && (status === 'ACCEPTED' || status === 'DECLINED')) {
          toNotify.push({ request: current, newStatus: status });
        }
      }
    });

    for (const { request, newStatus } of toNotify) {
      await notifyDecision(request, newStatus, req.facility.name);
    }
    res.json({ ok: true, updated: toNotify.length, processed: items.length });
  } catch (err) {
    console.error('[schedule-requests] triage failed:', err);
    res.status(500).json({ error: 'Failed to save triage' });
  }
});

module.exports = router;
