// Provider worked-hours entry — service layer (Stage 1: coordinator surface).
// See the provider hour-entry feature + eor-model-spec.md.
//
// 1099/per-diem providers must have SUBMITTED hours before payroll/invoicing.
// Entries are seeded from the schedule (SNAP scheduler ScheduleAssignment +
// ingested SchedulingRecord), pre-filled with each location's default shift
// window (CoverageTemplateDay), and adjusted/added by hand. SUBMITTED rows are
// what the Payroll Builder + Agency Invoice consume for 1099s.

const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');

// "HH:MM" → minutes since midnight, or null.
function minutesOf(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Hours between two "HH:MM" times (same day; no midnight crossing for OR shifts).
function hoursFromWindow(start, end) {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s == null || e == null) return 0;
  return Math.max(0, Math.round(((e - s) / 60) * 100) / 100);
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// The facility's default shift windows, keyed `${location}::${dayOfWeek}` →
// { start, end }. Uses the default coverage template (else any template).
async function getDefaultWindows(facilityId) {
  const template =
    (await prisma.coverageTemplate.findFirst({ where: { facilityId, isDefault: true }, include: { days: true } })) ||
    (await prisma.coverageTemplate.findFirst({ where: { facilityId }, include: { days: true } }));
  const map = {};
  for (const d of template?.days || []) {
    if (d.defaultStartTime && d.defaultEndTime) {
      map[`${d.location}::${d.dayOfWeek}`] = { start: d.defaultStartTime, end: d.defaultEndTime };
    }
  }
  return map;
}

// Gather the (rosterEntryId, date, location, ...) a 1099 worked in the period,
// from the SNAP scheduler AND ingested SchedulingRecords. Returns seed rows.
async function gatherWorkedDays({ facilityId, periodStart, periodEnd, roster }) {
  const start = new Date(periodStart);
  const end = new Date(new Date(periodEnd).getTime() + 86399999); // inclusive end-of-day
  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const rosterByKey = new Map();
  for (const r of roster) {
    const k = buildNameKey(r.providerName);
    if (k) rosterByKey.set(k, r.id);
  }

  const seeds = []; // { rosterEntryId, date(YYYY-MM-DD), location, startTime?, endTime?, hours?, source }

  // 1) SNAP scheduler assignments (have location + date, no times → use default window).
  const assignments = await prisma.scheduleAssignment.findMany({
    where: { facilityId, rosterId: { in: [...rosterById.keys()] }, scheduleDay: { date: { gte: start, lte: end } } },
    include: { scheduleDay: true },
  });
  for (const a of assignments) {
    if (!a.rosterId) continue;
    seeds.push({ rosterEntryId: a.rosterId, date: ymd(a.scheduleDay.date), location: a.scheduleDay.location || null, source: 'SCHEDULE' });
  }

  // 2) Ingested schedule rows (matched by name; may carry times/hours already).
  const records = await prisma.schedulingRecord.findMany({
    where: { facilityId, shiftDate: { gte: start, lte: end } },
  });
  for (const rec of records) {
    const rid = rosterByKey.get(buildNameKey(rec.providerName));
    if (!rid || !rec.shiftDate) continue;
    seeds.push({
      rosterEntryId: rid,
      date: ymd(rec.shiftDate),
      location: rec.facilityLocation || null,
      startTime: rec.startTime || null,
      endTime: rec.endTime || null,
      hours: rec.durationHours != null ? Number(rec.durationHours) : null,
      source: 'UPLOAD',
    });
  }
  return seeds;
}

// Seed DRAFT entries for the period. Never overwrites an existing entry (so
// coordinator/provider edits + SUBMITTED rows are preserved). Returns counts.
async function seedHourEntries({ facilityId, periodStart, periodEnd }) {
  const roster = await prisma.internalRosterEntry.findMany({
    // Pure 1099s AND dual-employment providers need hour entry (their 1099 side).
    where: { facilityId, OR: [{ is1099: true }, { dualEmployment: true }] },
    select: { id: true, providerName: true },
  });
  if (!roster.length) return { seeded: 0, skipped: 0 };

  const [windows, seeds] = await Promise.all([
    getDefaultWindows(facilityId),
    gatherWorkedDays({ facilityId, periodStart, periodEnd, roster }),
  ]);

  // Dedup seeds by rosterEntryId+date+location (UPLOAD wins — it carries times).
  const byKey = new Map();
  for (const s of seeds) {
    const k = `${s.rosterEntryId}::${s.date}::${s.location || ''}`;
    const prev = byKey.get(k);
    if (!prev || (s.source === 'UPLOAD' && prev.source !== 'UPLOAD')) byKey.set(k, s);
  }

  let seeded = 0;
  let skipped = 0;
  for (const s of byKey.values()) {
    const dateObj = new Date(s.date);
    const existing = await prisma.providerHourEntry.findFirst({
      where: { rosterEntryId: s.rosterEntryId, date: dateObj, location: s.location },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    const dow = dateObj.getUTCDay();
    const win = windows[`${s.location}::${dow}`];
    const startTime = s.startTime || win?.start || null;
    const endTime = s.endTime || win?.end || null;
    const hours = s.hours != null ? s.hours : hoursFromWindow(startTime, endTime);

    await prisma.providerHourEntry.create({
      data: {
        facilityId, rosterEntryId: s.rosterEntryId, date: dateObj,
        location: s.location, startTime, endTime, hours,
        status: 'DRAFT', source: s.source, enteredBy: 'coordinator',
      },
    });
    seeded++;
  }
  return { seeded, skipped };
}

// List entries for the period (1099 providers only), grouped by provider, with
// readiness. Used by the coordinator hour-entry page.
async function getEntries({ facilityId, periodStart, periodEnd }) {
  const start = new Date(periodStart);
  const end = new Date(new Date(periodEnd).getTime() + 86399999);
  const entries = await prisma.providerHourEntry.findMany({
    where: { facilityId, date: { gte: start, lte: end } },
    include: { rosterEntry: { select: { id: true, providerName: true, is1099: true, hourlyRate: true } } },
    orderBy: [{ date: 'asc' }],
  });
  const byProvider = {};
  for (const e of entries) {
    const rid = e.rosterEntryId;
    const g = (byProvider[rid] = byProvider[rid] || {
      rosterEntryId: rid,
      providerName: e.rosterEntry?.providerName || '',
      rows: [],
      totalHours: 0,
      submittedHours: 0,
      pendingCount: 0,
    });
    g.rows.push({
      id: e.id, date: ymd(e.date), location: e.location,
      startTime: e.startTime, endTime: e.endTime, hours: e.hours,
      status: e.status, source: e.source,
    });
    g.totalHours = Math.round((g.totalHours + e.hours) * 100) / 100;
    if (e.status === 'SUBMITTED') g.submittedHours = Math.round((g.submittedHours + e.hours) * 100) / 100;
    else g.pendingCount += 1;
  }
  const providers = Object.values(byProvider).sort((a, b) => a.providerName.localeCompare(b.providerName));
  const pendingProviders = providers.filter((p) => p.pendingCount > 0).length;
  return { periodStart, periodEnd, providers, pendingProviders };
}

// rosterEntryId → [{ date, hours }] of SUBMITTED entries in the period. Consumed
// by eorCost (invoice) + payroll seedLineItems to override raw schedule hours
// for 1099s. Empty map → no submitted entries → callers fall back to schedule.
async function submittedShiftDetailByRoster({ facilityId, periodStart, periodEnd }) {
  const start = new Date(periodStart);
  const end = new Date(new Date(periodEnd).getTime() + 86399999);
  const [rows, sites] = await Promise.all([
    prisma.providerHourEntry.findMany({
      where: { facilityId, status: 'SUBMITTED', date: { gte: start, lte: end } },
      select: { rosterEntryId: true, date: true, hours: true, location: true },
    }),
    prisma.facilityLocation.findMany({ where: { facilityId, isExternal: true }, select: { siteName: true } }),
  ]);
  // Non-CAPA (external) site names — hours there are excluded from the facility's
  // agency invoice (the agency pays them), but still count for agency payroll.
  const externalSites = new Set(sites.map((s) => s.siteName));
  const map = {};
  for (const r of rows) {
    (map[r.rosterEntryId] = map[r.rosterEntryId] || []).push({
      date: ymd(r.date),
      hours: Number(r.hours || 0),
      location: r.location || null,
      isExternal: r.location ? externalSites.has(r.location) : false,
    });
  }
  return map;
}

module.exports = {
  minutesOf,
  hoursFromWindow,
  getDefaultWindows,
  seedHourEntries,
  getEntries,
  submittedShiftDetailByRoster,
};
