/**
 * Month signal assembly (Wave 4 extraction) — the ONE place that resolves
 * "who is available on which day" plus the tiered request weightings, shared
 * by POST /schedule/build and the Living Month Draft engine. Extracted
 * verbatim from the /build route (2026-07-31) so the two consumers can never
 * drift; the only addition is `defaultOffKeys` (see below).
 *
 * Resolution ladder (services/availability.js): admin override > PTO >
 * provider self-submit > default-by-employment (FULL_TIME/PART_TIME
 * available; PER_DIEM/LOCUMS unavailable unless they opt in).
 */

const prisma = require('../config/db');
const { resolveDayAvailability } = require('./availability');
const { crossFacilityConflictKeys } = require('./scheduleBuilder');

const DAY_MS = 24 * 60 * 60 * 1000;
const isoOf = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * @returns {
 *   monthStart, monthEnd,
 *   unavailableKeys:  Set<`${rosterId}::${iso}`>   hard-excluded days
 *   defaultOffKeys:   Set<`${rosterId}::${iso}`>   unavailable ONLY because of
 *                     the employment default (no explicit signal) — these are
 *                     the draft engine's ghost-eligible per-diem days. Always
 *                     a subset of unavailableKeys.
 *   workRequestKeys:  Map<key, {siteName, tier, order}>
 *   dayOffSoftKeys:   Map<key, {tier, order}>
 *   triagedRequests:  raw ACCEPTED WORK/DAY_OFF requests for the month
 * }
 */
async function assembleMonthSignals({ facilityId, year, month, roster, scheduleDays }) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const linkedProviderIds = roster.map((r) => r.linkedProviderId).filter(Boolean);
  const providerIdToRosterId = Object.fromEntries(
    roster.filter((r) => r.linkedProviderId).map((r) => [r.linkedProviderId, r.id])
  );

  const [timeOff, providerRows, adminRows] = await Promise.all([
    prisma.rosterTimeOff.findMany({
      where: { facilityId, startDate: { lt: monthEnd }, endDate: { gte: monthStart } },
      select: { rosterEntryId: true, startDate: true, endDate: true },
    }),
    linkedProviderIds.length > 0
      ? prisma.providerAvailability.findMany({
          where: { date: { gte: monthStart, lt: monthEnd }, providerId: { in: linkedProviderIds } },
          select: { providerId: true, date: true, available: true },
        })
      : Promise.resolve([]),
    prisma.rosterAvailability.findMany({
      where: { facilityId, date: { gte: monthStart, lt: monthEnd } },
      select: { rosterEntryId: true, date: true, available: true, source: true },
    }),
  ]);

  // PTO coverage: `${rid}::${date}`
  const ptoSet = new Set();
  for (const t of timeOff) {
    let d = new Date(Math.max(new Date(t.startDate).getTime(), monthStart.getTime()));
    const last = Math.min(new Date(t.endDate).getTime(), monthEnd.getTime() - DAY_MS);
    while (d.getTime() <= last) {
      ptoSet.add(`${t.rosterEntryId}::${isoOf(d)}`);
      d = new Date(d.getTime() + DAY_MS);
    }
  }

  // Admin overrides (authoritative) and provider/self-submitted signals.
  const adminMap = new Map();
  const providerMap = new Map();
  for (const a of adminRows) {
    // ADMIN and admin-set PTO are both authoritative (PTO rows are available:false).
    if (a.source === 'ADMIN' || a.source === 'PTO') adminMap.set(`${a.rosterEntryId}::${isoOf(a.date)}`, a.available);
    else providerMap.set(`${a.rosterEntryId}::${isoOf(a.date)}`, a.available);
  }
  for (const p of providerRows) {
    const rid = providerIdToRosterId[p.providerId];
    if (rid) providerMap.set(`${rid}::${isoOf(p.date)}`, p.available);
  }

  // Tokenized availability-request submissions: a signal, not an override.
  const availSubmissions = await prisma.availDaySubmission.findMany({
    where: {
      request: { facilityId, year, month },
      date: { gte: monthStart, lt: monthEnd },
    },
    include: { request: { select: { rosterEntryId: true } } },
  });
  for (const sub of availSubmissions) {
    const key = `${sub.request.rosterEntryId}::${isoOf(sub.date)}`;
    if (!adminMap.has(key) && !providerMap.has(key)) {
      providerMap.set(key, sub.available);
    }
  }

  const unavailableKeys = new Set();
  const defaultOffKeys = new Set();
  // Why-off classification for Wave-5 rule enforcement: PTO-covered days vs
  // explicit non-PTO "said no" days (admin-marked or provider-declared).
  const explicitOffKeys = new Set();
  const uniqueDayISOs = [...new Set(scheduleDays.map((d) => isoOf(d.date)))];
  for (const r of roster) {
    for (const dISO of uniqueDayISOs) {
      const key = `${r.id}::${dISO}`;
      const { available, source } = resolveDayAvailability({
        employmentCategory: r.employmentCategory,
        adminAvailable: adminMap.has(key) ? adminMap.get(key) : null,
        ptoCovers: ptoSet.has(key),
        providerAvailable: providerMap.has(key) ? providerMap.get(key) : null,
      });
      if (!available) {
        unavailableKeys.add(key);
        if (source === 'DEFAULT') defaultOffKeys.add(key);
        else if (!ptoSet.has(key)) explicitOffKeys.add(key);
      }
    }
  }

  // Cross-facility double-booking guard: hard-unavailable here.
  const conflictKeys = await crossFacilityConflictKeys({ facilityId, roster, monthStart, monthEnd });
  for (const k of conflictKeys) {
    unavailableKeys.add(k);
    defaultOffKeys.delete(k); // booked elsewhere ≠ ghost-eligible
  }

  // Tiered ACCEPTED requests: WORK biases in, soft DAY_OFF (tiers 2–4) biases
  // out. Tier-1 DAY_OFFs arrive as RosterTimeOff → unavailableKeys already.
  const triagedRequests = await prisma.scheduleRequest.findMany({
    where: {
      facilityId,
      type: { in: ['WORK', 'DAY_OFF'] },
      status: 'ACCEPTED',
      date: { gte: monthStart, lt: monthEnd },
    },
    select: {
      id: true,
      rosterEntryId: true,
      type: true,
      date: true,
      endDate: true,
      siteName: true,
      tier: true,
      manualOrder: true,
      createdAt: true,
      rosterEntry: { select: { providerName: true, seniorityRank: true } },
    },
  });

  // Stable within-tier order: manual override first, else most-senior, else
  // earliest request; 0-based index per (type, tier) bucket.
  const orderByRequestId = new Map();
  const buckets = new Map();
  for (const r of triagedRequests) {
    const key = `${r.type}:${r.tier ?? 'X'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  for (const list of buckets.values()) {
    list
      .sort((a, b) => {
        const am = a.manualOrder, bm = b.manualOrder;
        if (am != null || bm != null) return (am ?? 1e9) - (bm ?? 1e9);
        const as = a.rosterEntry?.seniorityRank, bs = b.rosterEntry?.seniorityRank;
        if (as != null || bs != null) return (as ?? 1e9) - (bs ?? 1e9);
        return new Date(a.createdAt) - new Date(b.createdAt);
      })
      .forEach((r, i) => orderByRequestId.set(r.id, i));
  }

  const workRequestKeys = new Map();
  const dayOffSoftKeys = new Map();
  for (const r of triagedRequests) {
    const dISO = isoOf(r.date);
    const key = `${r.rosterEntryId}::${dISO}`;
    const order = orderByRequestId.get(r.id) ?? 0;
    if (r.type === 'WORK') {
      workRequestKeys.set(key, { siteName: r.siteName || null, tier: r.tier ?? null, order });
    } else if (r.type === 'DAY_OFF' && (r.tier === 2 || r.tier === 3 || r.tier === 4)) {
      dayOffSoftKeys.set(key, { tier: r.tier, order });
    }
  }

  return { monthStart, monthEnd, unavailableKeys, defaultOffKeys, explicitOffKeys, ptoSet, workRequestKeys, dayOffSoftKeys, triagedRequests };
}

module.exports = { assembleMonthSignals };
