// Provider worked-hours entry — service layer (Stage 1: coordinator surface).
// See the provider hour-entry feature + eor-model-spec.md.
//
// 1099/per-diem providers must have SUBMITTED hours before payroll/invoicing.
// Entries are seeded from the schedule (SNAP scheduler ScheduleAssignment +
// ingested SchedulingRecord), pre-filled with each location's default shift
// window (CoverageTemplateDay), and adjusted/added by hand. SUBMITTED rows are
// what the Payroll Builder + Agency Invoice consume for 1099s.

const XLSX = require('xlsx');
const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');

// Normalize a business name for matching (ignore case/punctuation/spacing).
function normBiz(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

// rosterEntryId → { reimbursement, bonus } of SUBMITTED entries in the period.
// reimbursement is CAPA-billable (added to the invoice); bonus is APNE-site
// (separate bucket, never on the invoice).
async function submittedExtrasByRoster({ facilityId, periodStart, periodEnd }) {
  const start = new Date(periodStart);
  const end = new Date(new Date(periodEnd).getTime() + 86399999);
  const rows = await prisma.providerHourEntry.findMany({
    where: { facilityId, status: 'SUBMITTED', date: { gte: start, lte: end } },
    select: { rosterEntryId: true, reimbursementAmount: true, bonusAmount: true },
  });
  const map = {};
  for (const r of rows) {
    const g = (map[r.rosterEntryId] = map[r.rosterEntryId] || { reimbursement: 0, bonus: 0 });
    g.reimbursement = Math.round((g.reimbursement + Number(r.reimbursementAmount || 0)) * 100) / 100;
    g.bonus = Math.round((g.bonus + Number(r.bonusAmount || 0)) * 100) / 100;
  }
  return map;
}

// ── APNE Gusto-format 1099 payroll-sheet ingest (the bridge) ────────────────────
// Parses an APNE-style payroll sheet (contractor_type / first_name / last_name /
// business_name / ein / hours_worked / reimbursement / bonus). The `bonus` cell is
// a FORMULA (APNE-site hours×rate) — we capture both the value and the formula
// text. hours_worked = CAPA-billable hours; reimbursement → CAPA invoice; bonus →
// APNE-site bucket. See eor-model-spec.md / APNE bridge.
function parseApnePayrollSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' }); // default keeps formulas in cell.f
  // Pick the sheet whose header row has a contractor-type + hours column
  // (synonym-tolerant, same lists as the column matcher below).
  const TYPE_SYNS = ['contractor_type', 'contractor type', 'type'];
  const HOURS_SYNS = ['hours_worked', 'hours worked', 'hours', 'regular_hours', 'regular hours'];
  let ws = null;
  for (const name of wb.SheetNames) {
    const s = wb.Sheets[name];
    const hdr = (XLSX.utils.sheet_to_json(s, { header: 1, defval: '', raw: false })[0] || [])
      .map((h) => String(h).trim().toLowerCase());
    if (TYPE_SYNS.some((x) => hdr.includes(x)) && HOURS_SYNS.some((x) => hdr.includes(x))) { ws = s; break; }
  }
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const hdr = rows[0].map((h) => String(h).trim().toLowerCase());
  // Header synonyms — exact-match-only silently imported zeros when a sheet
  // was edited (e.g. "reimbursements" instead of "reimbursement"), which is
  // invisible until payroll/invoice totals come up short.
  const findCol = (names) => {
    for (const n of names) {
      const i = hdr.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const ci = {
    type: findCol(TYPE_SYNS),
    first: findCol(['first_name', 'first name', 'firstname']),
    last: findCol(['last_name', 'last name', 'lastname']),
    business: findCol(['business_name', 'business name', 'businessname']),
    ein: findCol(['ein', 'tax_id', 'tax id']),
    hours: findCol(HOURS_SYNS),
    reimb: findCol(['reimbursement', 'reimbursements', 'reimb', 'expense_reimbursement', 'expense reimbursement', 'expenses', 'expense', 'mileage']),
    bonus: findCol(['bonus', 'bonuses', 'bonus_pay', 'bonus pay', 'bonus_amount', 'bonus amount']),
  };
  // Optional money columns the sheet didn't have — surfaced in the import
  // response so a renamed column can't silently zero out payroll/invoices.
  const columnsMissing = [
    ...(ci.reimb < 0 ? ['reimbursement'] : []),
    ...(ci.bonus < 0 ? ['bonus'] : []),
    ...(ci.ein < 0 ? ['ein'] : []),
  ];
  const cell = (r, c) => (c >= 0 ? rows[r][c] : '');
  // Money/number columns are often currency-formatted; sheet_to_json with
  // raw:false hands back the DISPLAY string ("$1,250.00"), which Number()
  // turns into NaN → silently 0. Prefer the raw numeric cell value, then
  // fall back to a tolerant parse (strip $ , spaces; (x) = negative).
  const numCell = (r, c) => {
    if (c < 0) return 0;
    const rc = ws[XLSX.utils.encode_cell({ c, r })];
    if (rc && typeof rc.v === 'number') return rc.v;
    const s = String(cell(r, c) ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const businessName = String(cell(r, ci.business) || '').trim();
    const firstName = String(cell(r, ci.first) || '').trim();
    const lastName = String(cell(r, ci.last) || '').trim();
    if (!businessName && !firstName && !lastName) continue; // blank row

    const payeeType = String(cell(r, ci.type) || '').trim() || (businessName ? 'Business' : 'Individual');
    const hoursWorked = numCell(r, ci.hours);
    const reimbursement = ci.reimb >= 0 ? numCell(r, ci.reimb) : 0;

    // Bonus: capture the computed value AND the source formula from the cell.
    let bonusAmount = 0;
    let bonusDetail = null;
    if (ci.bonus >= 0) {
      const addr = XLSX.utils.encode_cell({ c: ci.bonus, r });
      const bc = ws[addr];
      if (bc) {
        if (typeof bc.v === 'number') bonusAmount = bc.v;
        else bonusAmount = numCell(r, ci.bonus);
        if (bc.f) bonusDetail = String(bc.f);
      }
    }

    out.push({
      payeeType,
      firstName,
      lastName,
      businessName,
      ein: String(cell(r, ci.ein) || '').trim(),
      hoursWorked,
      reimbursement,
      bonusAmount,
      bonusDetail,
    });
  }
  out.columnsMissing = columnsMissing;
  // Read-back totals: the import response echoes what the parser actually got
  // out of the sheet, so a formatting/header problem is visible immediately
  // instead of surfacing later as a short payroll or invoice.
  const r2 = (n) => Math.round(n * 100) / 100;
  out.sheetTotals = {
    hours: r2(out.reduce((s, x) => s + (x.hoursWorked || 0), 0)),
    reimbursement: r2(out.reduce((s, x) => s + (x.reimbursement || 0), 0)),
    bonus: r2(out.reduce((s, x) => s + (x.bonusAmount || 0), 0)),
  };
  return out;
}

// Ingest a parsed APNE payroll sheet: match/seed roster cards, then upsert one
// SUBMITTED ProviderHourEntry per provider for the period (CAPA hours + bonus +
// reimbursement). Returns a summary.
async function importApnePayrollSheet({ facilityId, buffer, periodStart, periodEnd, enteredBy = 'coordinator' }) {
  const parsed = parseApnePayrollSheet(buffer);
  if (!parsed.length) throw new Error('No payroll rows found (need contractor_type + hours_worked columns).');
  const periodDate = new Date(periodEnd);

  const roster = await prisma.internalRosterEntry.findMany({
    where: { facilityId },
    select: { id: true, providerName: true, businessName: true },
  });
  const byNameKey = new Map();
  const byBiz = new Map();
  for (const e of roster) {
    const nk = buildNameKey(e.providerName);
    if (nk) byNameKey.set(nk, e.id);
    if (e.businessName) byBiz.set(normBiz(e.businessName), e.id);
  }

  let seeded = 0;
  let matched = 0;
  let recorded = 0;
  for (const row of parsed) {
    const isBiz = row.payeeType === 'Business' && row.businessName;
    const displayName = isBiz ? row.businessName : `${row.firstName} ${row.lastName}`.trim();
    if (!displayName) continue;

    let rosterId = isBiz ? byBiz.get(normBiz(row.businessName)) : null;
    if (!rosterId) rosterId = byNameKey.get(buildNameKey(displayName)) || null;

    if (!rosterId) {
      const created = await prisma.internalRosterEntry.create({
        data: {
          facilityId,
          providerName: displayName,
          is1099: true,
          payeeType: row.payeeType || null,
          businessName: row.businessName || null,
          useBusinessNameForPayroll: !!isBiz,
          ein: row.ein || null,
        },
      });
      rosterId = created.id;
      seeded += 1;
      const nk = buildNameKey(displayName);
      if (nk) byNameKey.set(nk, rosterId);
      if (row.businessName) byBiz.set(normBiz(row.businessName), rosterId);
    } else {
      matched += 1;
    }

    const data = {
      hours: row.hoursWorked,
      // Import as DRAFT so the coordinator reviews on Provider Hours and then
      // hits Submit — payroll/invoice only count submitted hours.
      status: 'DRAFT',
      source: 'PAYROLL_SHEET',
      enteredBy,
      reimbursementAmount: row.reimbursement || null,
      bonusAmount: row.bonusAmount || null,
      bonusDetail: row.bonusDetail || null,
    };
    const existing = await prisma.providerHourEntry.findFirst({
      where: { rosterEntryId: rosterId, date: periodDate, location: null },
      select: { id: true },
    });
    if (existing) await prisma.providerHourEntry.update({ where: { id: existing.id }, data });
    else await prisma.providerHourEntry.create({ data: { facilityId, rosterEntryId: rosterId, date: periodDate, location: null, ...data } });
    recorded += 1;
  }

  return {
    rows: parsed.length,
    seeded,
    matched,
    recorded,
    periodStart,
    periodEnd,
    columnsMissing: parsed.columnsMissing || [],
    sheetTotals: parsed.sheetTotals || null,
  };
}

// ── All-in (CAPA) rate bulk import ───────────────────────────────────────────
// Parse a sheet of per-provider all-in rates and set each roster card's
// allInCostPerHour. Accepts the APNE "all in hourly" layout: a header row with
// contractor_type / first_name / last_name / business_name and a rate column
// labelled "CAPA rate" (or all_in / all-in rate / bill rate). The header row may
// sit a few rows down (title + date rows above it).
const ALL_IN_RATE_HEADERS = new Set([
  'caparate', 'caparatehr', 'allin', 'allinrate', 'allinhourly', 'allinhourlyrate',
  'allincost', 'allincostperhour', 'billrate',
]);
// Payroll PAY rate (what the employer pays the provider) → hourlyRate.
const PAY_RATE_HEADERS = new Set([
  'rate', 'payrate', 'payratehr', 'payrollrate', 'hourlyrate', 'hourlyratehr',
  'contractorrate', 'contractorpayrate',
]);
function normHeader(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseRateSheet(buffer, rateHeaders) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
    // Scan the first several rows for a header that has a rate column + a
    // name/business column (the title/date rows sit above it).
    for (let h = 0; h < Math.min(grid.length, 10); h++) {
      const hdr = (grid[h] || []).map(normHeader);
      const ci = {
        headerRow: h,
        rate: hdr.findIndex((x) => rateHeaders.has(x)),
        type: hdr.indexOf('contractortype'),
        first: hdr.indexOf('firstname'),
        last: hdr.indexOf('lastname'),
        business: hdr.indexOf('businessname'),
      };
      if (ci.rate < 0 || (ci.type < 0 && ci.first < 0 && ci.business < 0)) continue;

      const cell = (r, c) => (c >= 0 ? (grid[r][c] ?? '') : '');
      const out = [];
      for (let r = h + 1; r < grid.length; r++) {
        const businessName = String(cell(r, ci.business) || '').trim();
        const firstName = String(cell(r, ci.first) || '').trim();
        const lastName = String(cell(r, ci.last) || '').trim();
        if (!businessName && !firstName && !lastName) continue; // blank / total row
        const raw = cell(r, ci.rate);
        const rate = raw === '' || raw == null ? null : Number(String(raw).replace(/[^0-9.]/g, ''));
        const payeeType = String(cell(r, ci.type) || '').trim() || (businessName ? 'Business' : 'Individual');
        out.push({ payeeType, firstName, lastName, businessName, rate: Number.isFinite(rate) ? rate : null });
      }
      return out;
    }
  }
  return [];
}

// Match each parsed row to an existing roster card (Business by business name,
// Individual by name fingerprint) and set ONE rate field. Update-only — never
// seeds, so a name typo can't create a duplicate card and unrecognized
// (inactive) providers are skipped; unmatched rows are reported so the
// coordinator can reconcile.
async function importRates({ facilityId, buffer, rateHeaders, field }) {
  const parsed = parseRateSheet(buffer, rateHeaders);
  if (!parsed.length) {
    throw new Error('No rate rows found — need a name/business column and a rate column.');
  }

  const roster = await prisma.internalRosterEntry.findMany({
    where: { facilityId },
    select: { id: true, providerName: true, businessName: true },
  });
  // Build several lookups per card so matching survives how the name is stored:
  //   byNameKey   — first-initial+last fingerprint of the provider name (people)
  //   byBiz       — normalized businessName field (when populated)
  //   byProvNorm  — normalized provider name (catches businesses whose name
  //                 lives in providerName rather than the businessName field)
  const byNameKey = new Map();
  const byBiz = new Map();
  const byProvNorm = new Map();
  for (const e of roster) {
    const nk = buildNameKey(e.providerName);
    if (nk) byNameKey.set(nk, e.id);
    const pn = normBiz(e.providerName);
    if (pn) byProvNorm.set(pn, e.id);
    if (e.businessName) byBiz.set(normBiz(e.businessName), e.id);
  }

  let updated = 0;
  let skippedNoRate = 0;
  const unmatched = [];
  for (const row of parsed) {
    const isBiz = row.payeeType === 'Business' && row.businessName;
    const displayName = isBiz ? row.businessName : `${row.firstName} ${row.lastName}`.trim();
    if (!displayName) continue;
    if (row.rate == null) { skippedNoRate += 1; continue; }

    let rosterId = null;
    if (isBiz) {
      const k = normBiz(row.businessName);
      rosterId = byBiz.get(k) || byProvNorm.get(k) || byNameKey.get(buildNameKey(row.businessName)) || null;
    } else {
      rosterId = byNameKey.get(buildNameKey(displayName)) || byProvNorm.get(normBiz(displayName)) || null;
    }

    if (!rosterId) { unmatched.push(displayName); continue; }
    await prisma.internalRosterEntry.update({
      where: { id: rosterId },
      data: { [field]: row.rate },
    });
    updated += 1;
  }

  return { rows: parsed.length, updated, skippedNoRate, unmatched };
}

// All-in (CAPA bill) rate → allInCostPerHour.
const parseAllInRateSheet = (buffer) => parseRateSheet(buffer, ALL_IN_RATE_HEADERS);
const importAllInRates = ({ facilityId, buffer }) =>
  importRates({ facilityId, buffer, rateHeaders: ALL_IN_RATE_HEADERS, field: 'allInCostPerHour' });

// Payroll PAY rate (what the provider is paid) → hourlyRate.
const importPayrollRates = ({ facilityId, buffer }) =>
  importRates({ facilityId, buffer, rateHeaders: PAY_RATE_HEADERS, field: 'hourlyRate' });

module.exports = {
  minutesOf,
  hoursFromWindow,
  getDefaultWindows,
  seedHourEntries,
  getEntries,
  submittedShiftDetailByRoster,
  submittedExtrasByRoster,
  parseApnePayrollSheet,
  importApnePayrollSheet,
  parseAllInRateSheet,
  importAllInRates,
  importPayrollRates,
};
