/**
 * Universal conflict flags (Wave 3.3, 2026-07-31) — FLAG EVERYTHING, FIX
 * NOTHING. One engine that surfaces every contradiction in a month's
 * schedule as a typed flag with a suggested fix. Nothing is stored and
 * nothing auto-changes (the locked 7/29 design): flags are render-time
 * reads of live data, so they appear the moment reality shifts and clear
 * the moment the coordinator resolves them. Suggested fixes route through
 * EXISTING mutation endpoints — the flag only tells the UI what to call.
 *
 * Flag types:
 *   PTO_CONFLICT        HIGH   assigned while on granted PTO/time-off
 *   UNAVAILABLE_ADMIN   HIGH   assigned on an admin-marked unavailable day
 *   DOUBLE_BOOKED       HIGH   same provider, two sites, same day (this practice)
 *   DOUBLE_BOOKED_XFAC  HIGH   also scheduled at ANOTHER practice that day
 *   SAID_UNAVAILABLE    MEDIUM assigned on a day the provider said no
 *                              (availability card, app calendar, or self-submit)
 *   ROOM_COUNT_MISMATCH MEDIUM site's returned card disagrees with the built day
 *   MISSING_DAY         MEDIUM site returned a count for a day that was never built
 *   HOLIDAY_STAFFED     MEDIUM assignments on an active practice holiday
 *   HOLIDAY_OPEN        INFO   an (empty) schedule day sits on a holiday
 *   MAYBE_ONLY          INFO   assigned on a day the provider only said "maybe"
 *   NOT_OFFERED         INFO   per-diem assigned on a day their returned card
 *                              didn't offer (per-diems default to unavailable)
 *
 * Pre/post-publish split (locked design): flags on published days carry
 * published=true — the UI renders those loud, drafting-time ones quiet.
 */

const prisma = require('../config/db');
const { getActiveHolidayDates } = require('../routes/holidays');
const { crossFacilityConflictKeys } = require('./scheduleBuilder');

const SEV_RANK = { HIGH: 0, MEDIUM: 1, INFO: 2 };

function iso(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function monthRange(year, month) {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

async function computeScheduleFlags(facilityId, year, month) {
  const { start, end } = monthRange(year, month);

  const [days, roster, timeOff, rosterAvail, requests, cards, holidayDates] = await Promise.all([
    prisma.scheduleDay.findMany({
      where: { facilityId, date: { gte: start, lt: end } },
      include: {
        assignments: {
          include: {
            rosterEntry: {
              select: { id: true, providerName: true, providerType: true, employmentCategory: true, linkedProviderId: true },
            },
          },
        },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.internalRosterEntry.findMany({
      where: { facilityId },
      select: { id: true, providerName: true, employmentCategory: true, linkedProviderId: true },
    }),
    prisma.rosterTimeOff.findMany({
      where: { facilityId, startDate: { lt: end }, endDate: { gte: start } },
      select: { rosterEntryId: true, startDate: true, endDate: true, reason: true },
    }),
    prisma.rosterAvailability.findMany({
      where: { facilityId, date: { gte: start, lt: end } },
      select: { rosterEntryId: true, date: true, available: true, source: true, note: true },
    }),
    prisma.availabilityRequest.findMany({
      where: { facilityId, year, month, submittedAt: { not: null } },
      select: { rosterEntryId: true, daySubmissions: { select: { date: true, available: true, maybe: true } } },
    }),
    prisma.roomCountRequest.findMany({
      where: { facilityId, year, month, submittedAt: { not: null } },
      select: { location: true, dayCounts: { select: { date: true, roomsRequired: true } } },
    }),
    getActiveHolidayDates(facilityId, year).catch(() => new Set()),
  ]);

  // App-calendar (ProviderAvailability) unavailability for linked providers.
  const linked = roster.filter((r) => r.linkedProviderId);
  const appUnavail = linked.length
    ? await prisma.providerAvailability.findMany({
        where: { providerId: { in: linked.map((r) => r.linkedProviderId) }, date: { gte: start, lt: end }, available: false },
        select: { providerId: true, date: true },
      })
    : [];
  const rosterIdByProviderId = new Map(linked.map((r) => [r.linkedProviderId, r.id]));

  const xfacKeys = await crossFacilityConflictKeys({ facilityId, roster, monthStart: start, monthEnd: end }).catch(() => new Set());

  // ── Index the signals by `${rosterId}|${iso}` ──────────────────────────
  const ptoByKey = new Map(); // → reason
  for (const t of timeOff) {
    const s = new Date(t.startDate);
    const e = new Date(t.endDate);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const dIso = iso(d);
      if (dIso >= iso(start) && dIso < iso(end)) ptoByKey.set(`${t.rosterEntryId}|${dIso}`, t.reason || 'Time off');
    }
  }
  const adminOffKeys = new Map(); // admin-marked unavailable → note
  const saidOffKeys = new Map(); // provider-sourced unavailable → source label
  const positiveKeys = new Set(); // any explicit "available" signal
  for (const a of rosterAvail) {
    const key = `${a.rosterEntryId}|${iso(a.date)}`;
    if (a.source === 'PTO' && a.available === false) {
      if (!ptoByKey.has(key)) ptoByKey.set(key, a.note || 'Approved PTO request');
    } else if (a.available === false) {
      if (a.source === 'ADMIN') adminOffKeys.set(key, a.note || null);
      else saidOffKeys.set(key, 'marked unavailable');
    } else if (a.available === true) {
      positiveKeys.add(key);
    }
  }
  for (const a of appUnavail) {
    const rid = rosterIdByProviderId.get(a.providerId);
    if (rid) {
      const key = `${rid}|${iso(a.date)}`;
      if (!saidOffKeys.has(key)) saidOffKeys.set(key, 'marked unavailable in their app');
    }
  }
  // Tokenized availability-card submissions (the big CAPA population).
  const cardSubmitted = new Set(); // rosterIds that returned a card this month
  const cardDayState = new Map(); // `${rosterId}|${iso}` → 'YES' | 'NO' | 'MAYBE'
  for (const r of requests) {
    cardSubmitted.add(r.rosterEntryId);
    for (const s of r.daySubmissions) {
      const key = `${r.rosterEntryId}|${iso(s.date)}`;
      cardDayState.set(key, s.maybe ? 'MAYBE' : s.available ? 'YES' : 'NO');
      if (s.available) positiveKeys.add(key);
    }
  }
  const cardCountByKey = new Map(); // `${iso}::${location}` → rooms
  for (const c of cards) {
    for (const dc of c.dayCounts) cardCountByKey.set(`${iso(dc.date)}::${c.location}`, dc.roomsRequired);
  }
  // getActiveHolidayDates returns a Set of 'YYYY-MM-DD' strings.
  const holidaySet = new Set(holidayDates);

  // ── Walk the schedule ──────────────────────────────────────────────────
  const flags = [];
  const push = (f) => flags.push(f);
  const byProviderDay = new Map(); // `${rosterId}|${iso}` → [{ day, a }]
  const builtLocations = new Set(days.map((d) => d.location));
  const dayByKey = new Map(); // `${iso}::${location}` → day

  for (const day of days) {
    const dIso = iso(day.date);
    dayByKey.set(`${dIso}::${day.location}`, day);
    const published = Boolean(day.publishedAt);

    // Holiday collisions (holidays are only consulted at generate time —
    // a holiday added later leaves live days behind; nothing re-checks).
    if (holidaySet.has(dIso)) {
      const staffed = day.assignments.filter((a) => a.rosterId).length;
      push({
        id: `HOLIDAY:${dIso}:${day.location}`,
        type: staffed ? 'HOLIDAY_STAFFED' : 'HOLIDAY_OPEN',
        severity: staffed ? 'MEDIUM' : 'INFO',
        date: dIso,
        location: day.location,
        dayId: day.id,
        published,
        title: staffed
          ? `${day.location} is staffed on a practice holiday`
          : `${day.location} has a schedule day on a practice holiday`,
        detail: staffed
          ? `${staffed} provider(s) assigned on ${dIso}, which is marked as a holiday.`
          : `The day was built before ${dIso} became a holiday. Remove it or keep it deliberately.`,
        fix: staffed ? { action: 'REVIEW_DAY', date: dIso, location: day.location } : { action: 'DELETE_DAY', dayId: day.id },
      });
    }

    // Room-count disagreement: the site's returned card vs the built day.
    const cardRooms = cardCountByKey.get(`${dIso}::${day.location}`);
    if (cardRooms != null && cardRooms !== day.roomsRequired) {
      push({
        id: `ROOMS:${dIso}:${day.location}`,
        type: 'ROOM_COUNT_MISMATCH',
        severity: 'MEDIUM',
        date: dIso,
        location: day.location,
        dayId: day.id,
        published,
        title: `${day.location} ${dIso}: site said ${cardRooms} room(s), schedule has ${day.roomsRequired}`,
        detail: day.roomsAdminSet
          ? 'An admin-set count is overriding the site\'s returned card. Keep it, or accept the site\'s number.'
          : 'The site\'s card changed after this day was built. Accept the site\'s number or keep the built count.',
        fix: { action: 'SET_ROOMS', date: dIso, location: day.location, rooms: cardRooms },
      });
    }

    // Per-assignment conflicts.
    for (const a of day.assignments) {
      if (!a.rosterId) continue;
      const key = `${a.rosterId}|${dIso}`;
      if (!byProviderDay.has(key)) byProviderDay.set(key, []);
      byProviderDay.get(key).push({ day, a });

      const name = a.rosterEntry?.providerName || 'Provider';
      const base = {
        date: dIso,
        location: day.location,
        dayId: day.id,
        roomNumber: a.roomNumber,
        rosterId: a.rosterId,
        providerName: name,
        published,
        fix: { action: 'UNASSIGN', dayId: day.id, roomNumber: a.roomNumber },
      };

      if (ptoByKey.has(key)) {
        push({
          ...base,
          id: `PTO:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'PTO_CONFLICT',
          severity: 'HIGH',
          title: `${name} is on PTO but assigned at ${day.location}`,
          detail: `${ptoByKey.get(key)} — needs coverage on ${dIso}.`,
        });
      } else if (adminOffKeys.has(key)) {
        push({
          ...base,
          id: `ADMOFF:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'UNAVAILABLE_ADMIN',
          severity: 'HIGH',
          title: `${name} is marked unavailable but assigned at ${day.location}`,
          detail: adminOffKeys.get(key) || `An admin marked ${dIso} unavailable for ${name}.`,
        });
      } else if (saidOffKeys.has(key) || cardDayState.get(key) === 'NO') {
        push({
          ...base,
          id: `SAIDOFF:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'SAID_UNAVAILABLE',
          severity: 'MEDIUM',
          title: `${name} said they're unavailable ${dIso} but is assigned at ${day.location}`,
          detail: saidOffKeys.get(key) === 'marked unavailable in their app'
            ? 'Their app calendar says unavailable for this day.'
            : 'Their returned availability says no for this day.',
        });
      } else if (cardDayState.get(key) === 'MAYBE') {
        push({
          ...base,
          id: `MAYBE:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'MAYBE_ONLY',
          severity: 'INFO',
          title: `${name} only said "maybe" for ${dIso}`,
          detail: `Assigned at ${day.location} on a soft yes — worth confirming.`,
        });
      } else if (
        cardSubmitted.has(a.rosterId)
        && !cardDayState.has(key)
        && !positiveKeys.has(key)
        && ['PER_DIEM', 'LOCUMS'].includes(a.rosterEntry?.employmentCategory)
      ) {
        push({
          ...base,
          id: `NOTOFFERED:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'NOT_OFFERED',
          severity: 'INFO',
          title: `${name} didn't offer ${dIso} on their availability card`,
          detail: `Per-diem assigned at ${day.location} on a day their returned card left blank.`,
        });
      }

      // Cross-practice double-booking (linked providers only).
      if (xfacKeys.has(`${a.rosterId}::${dIso}`)) {
        push({
          ...base,
          id: `XFAC:${dIso}:${a.rosterId}:${a.roomNumber}`,
          type: 'DOUBLE_BOOKED_XFAC',
          severity: 'HIGH',
          title: `${name} is also scheduled at another practice on ${dIso}`,
          detail: `Assigned at ${day.location} here while another SNAP practice has them the same day.`,
        });
      }
    }
  }

  // Same-practice, cross-site double-booking — fully legal in the schema
  // (@@unique is per-day-per-room), so the flag is the only guard.
  for (const [key, list] of byProviderDay) {
    const locations = [...new Set(list.map((x) => x.day.location))];
    if (locations.length < 2) continue;
    const [rosterId, dIso] = key.split('|');
    const name = list[0].a.rosterEntry?.providerName || 'Provider';
    push({
      id: `DBL:${dIso}:${rosterId}`,
      type: 'DOUBLE_BOOKED',
      severity: 'HIGH',
      date: dIso,
      rosterId,
      providerName: name,
      location: locations.join(' + '),
      published: list.some((x) => Boolean(x.day.publishedAt)),
      title: `${name} is booked at ${locations.length} sites on ${dIso}`,
      detail: `${locations.join(' and ')} both have ${name} that day. Unassign one.`,
      slots: list.map((x) => ({ dayId: x.day.id, location: x.day.location, roomNumber: x.a.roomNumber })),
      fix: { action: 'REVIEW_DAY', date: dIso, location: locations[0] },
    });
  }

  // Card returned for days that were never built (card came back after
  // generate). Only for locations that HAVE a built schedule this month —
  // an ungenerated month isn't a conflict, it's just early.
  for (const [ckey, rooms] of cardCountByKey) {
    if (!rooms) continue; // 0 = site closed, nothing to build
    const [dIso, location] = ckey.split('::');
    if (!builtLocations.has(location)) continue;
    if (dayByKey.has(ckey)) continue;
    push({
      id: `MISSDAY:${dIso}:${location}`,
      type: 'MISSING_DAY',
      severity: 'MEDIUM',
      date: dIso,
      location,
      published: false,
      title: `${location} ${dIso}: site asked for ${rooms} room(s) but the day was never built`,
      detail: 'The site\'s card includes this day, but the schedule has no day row for it (card returned after generate, or the day was deleted).',
      fix: { action: 'CREATE_DAY', date: dIso, location, rooms },
    });
  }

  flags.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || a.date.localeCompare(b.date));

  const counts = {
    total: flags.length,
    high: flags.filter((f) => f.severity === 'HIGH').length,
    medium: flags.filter((f) => f.severity === 'MEDIUM').length,
    info: flags.filter((f) => f.severity === 'INFO').length,
    postPublish: flags.filter((f) => f.published).length,
  };

  return { year, month, flags, counts };
}

module.exports = { computeScheduleFlags };
