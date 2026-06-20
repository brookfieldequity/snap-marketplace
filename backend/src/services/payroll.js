// Payroll Builder core: the SNAP field catalog, ADP/Gusto default templates,
// fuzzy header auto-mapping, hours seeding from shift data, and CSV generation.
//
// SNAP is the payroll DATA PROCESSOR, not the payor. Everything here produces a
// CSV the facility uploads into their own ADP/Gusto account. Tax, withholding,
// and final OT classification are handled downstream by the payroll provider —
// the OT split here is a provisional seed the admin edits before export.

const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');

// ── Canonical SNAP payroll fields ───────────────────────────────────────────────
// Each maps to a value derived from a payroll line item / run. `synonyms` drive
// fuzzy matching of an uploaded template's column headers onto these fields.
const SNAP_FIELDS = {
  empId: { label: 'Employee ID', synonyms: ['employee id', 'emp id', 'employee number', 'employee no', 'id', 'payroll id', 'file number', 'associate id', 'employee code', 'worker id'] },
  name: { label: 'Employee Name', synonyms: ['employee name', 'name', 'full name', 'employee', 'worker name', 'provider', 'provider name'] },
  firstName: { label: 'First Name', synonyms: ['first name', 'first', 'fname', 'given name'] },
  lastName: { label: 'Last Name', synonyms: ['last name', 'last', 'lname', 'surname', 'family name'] },
  businessName: { label: 'Business Name', synonyms: ['business name', 'company name', 'business', 'company', 'legal business name'] },
  dept: { label: 'Department', synonyms: ['department', 'dept', 'division', 'cost center', 'location', 'home department'] },
  periodStart: { label: 'Pay Period Start', synonyms: ['pay period start', 'period start', 'start date', 'from', 'begin date', 'pay begin date', 'period begin'] },
  periodEnd: { label: 'Pay Period End', synonyms: ['pay period end', 'period end', 'end date', 'to', 'pay end date', 'period end date'] },
  regHours: { label: 'Regular Hours', synonyms: ['regular hours', 'reg hours', 'hours worked', 'hrs worked', 'hours', 'hrs', 'total hours', 'total hrs', 'reg hrs', 'regular hrs'] },
  otHours: { label: 'OT Hours', synonyms: ['ot hours', 'overtime hours', 'overtime', 'ot hrs', 'o t hours', 'overtime hrs'] },
  rate: { label: 'Rate', synonyms: ['rate', 'hourly rate', 'pay rate', 'rate of pay', 'hourly', 'rate hr', 'hourly pay rate'] },
  gross: { label: 'Gross Pay', synonyms: ['gross pay', 'gross', 'total pay', 'amount', 'gross wages', 'total', 'gross amount'] },
  bonus: { label: 'Bonus', synonyms: ['bonus', 'bonus pay', 'bonus amount', 'bonuses'] },
  invoiceNumber: { label: 'Invoice #', synonyms: ['invoice number', 'invoice no', 'invoice', 'invoice num'] },
  workerType: { label: 'Worker Type', synonyms: ['worker type', 'type', 'employment type', 'employee type', 'classification', 'w2 1099'] },
  fileCode: { label: 'File Code', synonyms: ['file code', 'file no', 'company code', 'batch id', 'co code', 'file number'] },
};

// Default templates used when a facility hasn't uploaded their own. Header order
// is the export column order; `map` is header → SNAP field.
const DEFAULT_TEMPLATES = {
  ADP: {
    headers: ['Employee ID', 'Employee Name', 'Department', 'Pay Period Start', 'Pay Period End', 'Regular Hours', 'OT Hours', 'Rate', 'Gross Pay', 'File Code'],
    map: {
      'Employee ID': 'empId',
      'Employee Name': 'name',
      Department: 'dept',
      'Pay Period Start': 'periodStart',
      'Pay Period End': 'periodEnd',
      'Regular Hours': 'regHours',
      'OT Hours': 'otHours',
      Rate: 'rate',
      'Gross Pay': 'gross',
      'File Code': 'fileCode',
    },
  },
  GUSTO: {
    headers: ['Employee Name', 'Start Date', 'End Date', 'Hours Worked', 'Hourly Rate', 'Total Pay', 'Worker Type', 'Department'],
    map: {
      'Employee Name': 'name',
      'Start Date': 'periodStart',
      'End Date': 'periodEnd',
      'Hours Worked': 'regHours',
      'Hourly Rate': 'rate',
      'Total Pay': 'gross',
      'Worker Type': 'workerType',
      Department: 'dept',
    },
  },
};

// Find the real header row in a parsed sheet. Payroll providers (Gusto, ADP)
// often prefix the export with a title row and/or blank rows before the actual
// column headers — so we can't assume row 0. Heuristic: among the first several
// rows, the header row is the one with the most non-empty cells (ties → earliest,
// which biases toward the header over any data rows beneath it).
function detectHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  let bestIdx = 0;
  let bestCount = 0;
  for (let i = 0; i < limit; i++) {
    const count = (rows[i] || []).filter((c) => String(c == null ? '' : c).trim() !== '').length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Pull the trimmed, non-empty header strings out of a parsed sheet (rows from
// XLSX sheet_to_json with header:1), auto-skipping any leading title/blank rows.
function extractHeaders(rows) {
  const idx = detectHeaderRow(rows);
  return (rows[idx] || []).map((h) => String(h == null ? '' : h).trim()).filter(Boolean);
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Fuzzy-map uploaded headers onto SNAP fields. Returns:
//   { map: { header: snapField|null }, unmapped: [header] }
// Does the word-sequence `seq` appear contiguously within `hay`?
function containsSequence(hay, seq) {
  for (let i = 0; i + seq.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (hay[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function autoMapHeaders(headers) {
  const map = {};
  // Pass 1 — exact normalized match against a synonym or the field label.
  // Handles clean headers like "last_name", "hourly_rate", "hours".
  for (const header of headers) {
    const norm = normalizeHeader(header);
    let matched = null;
    for (const [field, def] of Object.entries(SNAP_FIELDS)) {
      if (def.synonyms.includes(norm) || normalizeHeader(def.label) === norm) {
        matched = field;
        break;
      }
    }
    map[header] = matched;
  }
  // Pass 2 — for still-unmapped headers, allow a MULTI-WORD synonym phrase to
  // match as a contiguous word-sequence (e.g. "employee id number" → empId).
  // Single-word synonyms are intentionally excluded here so generic words like
  // "name"/"amount" don't grab "business_name" or "fixed_amount" by accident.
  const wordsOf = (s) => normalizeHeader(s).split(' ').filter(Boolean);
  for (const header of headers) {
    if (map[header]) continue;
    const hw = wordsOf(header);
    let matched = null;
    outer: for (const [field, def] of Object.entries(SNAP_FIELDS)) {
      for (const syn of def.synonyms) {
        const sw = syn.split(' ').filter(Boolean);
        if (sw.length >= 2 && containsSequence(hw, sw)) {
          matched = field;
          break outer;
        }
      }
    }
    map[header] = matched;
  }
  const unmapped = headers.filter((h) => !map[h]);
  return { map, unmapped };
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

// Split a provider name into { first, last }, handling both "First Last" and
// "Last, First" (the Gusto contractor template has separate name columns).
function splitName(raw) {
  const s = String(raw || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((p) => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// Compute the value for a SNAP field given a line item + run context.
function valueForField(field, { item, run, config }) {
  switch (field) {
    case 'empId':
      return item.payrollSystemId || '';
    // When a contractor is paid under a business name, the business name trumps
    // the personal name in payroll output: business_name is filled and the
    // name columns are blanked (Gusto expects one or the other per contractor).
    case 'name':
      return item.useBusinessNameForPayroll ? '' : item.providerName || '';
    case 'firstName':
      return item.useBusinessNameForPayroll ? '' : splitName(item.providerName).first;
    case 'lastName':
      return item.useBusinessNameForPayroll ? '' : splitName(item.providerName).last;
    case 'businessName':
      return item.useBusinessNameForPayroll ? item.businessName || '' : '';
    case 'dept':
      return item.role || 'Anesthesia';
    case 'periodStart':
      return fmtDate(run.periodStart);
    case 'periodEnd':
      return fmtDate(run.periodEnd);
    case 'regHours':
      return Number(item.regularHours || 0).toFixed(2);
    case 'otHours':
      return Number(item.otHours || 0).toFixed(2);
    case 'rate':
      return item.hourlyRate != null ? money(item.hourlyRate) : '';
    case 'gross':
      return money(item.grossPay);
    case 'bonus': {
      const b = computeBonus(item);
      return b > 0 ? money(b) : ''; // blank when no bonus (cleaner for Gusto)
    }
    case 'invoiceNumber':
      return run.invoiceNumber || ''; // run-level: same for every provider
    case 'workerType':
      return run.payClass === 'CONTRACTOR' ? 'Contractor' : 'Employee';
    case 'fileCode':
      return config?.fileCode || '';
    default:
      return '';
  }
}

// CSV-escape a single cell.
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Generate the export CSV. `headers` is the ordered template columns; `map` is
// header → SNAP field; `items` are the run's line items; `run`/`config` give
// context (period dates, file code).
function generateCsv({ headers, map, items, run, config }) {
  const rows = [headers.map(csvCell).join(',')];
  for (const item of items) {
    const row = headers.map((h) => {
      const field = map[h];
      if (!field) return '';
      return csvCell(valueForField(field, { item, run, config }));
    });
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

// Authoritative gross calculation. Hourly: reg*rate + ot*rate*1.5. Salaried
// (no hourly rate, has annual): annual/26 biweekly approximation. Otherwise 0.
// PROVISIONAL — final pay rules are governed by the facility's payroll provider.
function computeGross({ regularHours, otHours, hourlyRate, annualRate }) {
  if (hourlyRate != null) {
    return Number(regularHours || 0) * hourlyRate + Number(otHours || 0) * hourlyRate * 1.5;
  }
  if (annualRate != null) {
    return annualRate / 26;
  }
  return 0;
}

// Total bonus = flat amount + (bonus hours x bonus rate). Any combination of the
// three may be supplied; missing pieces count as 0. Kept SEPARATE from gross —
// it maps to the template's own "bonus" column.
function computeBonus({ bonusFlat, bonusHours, bonusRate } = {}) {
  const flat = Number(bonusFlat || 0);
  const fromHours = Number(bonusHours || 0) * Number(bonusRate || 0);
  return Math.round((flat + fromHours) * 100) / 100;
}

// ISO-week key (year-week) for splitting OT on a weekly >40 basis.
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

// Split aggregated shift hours into regular/OT on a weekly >40 basis (FLSA
// default). PROVISIONAL seed — admin can edit, and salaried staff are exempt.
function splitRegularOt(shifts) {
  const byWeek = {};
  for (const s of shifts) {
    const key = s.date ? isoWeekKey(new Date(s.date)) : 'none';
    byWeek[key] = (byWeek[key] || 0) + Number(s.hours || 0);
  }
  let reg = 0;
  let ot = 0;
  for (const total of Object.values(byWeek)) {
    reg += Math.min(total, 40);
    ot += Math.max(0, total - 40);
  }
  return { regularHours: Math.round(reg * 100) / 100, otHours: Math.round(ot * 100) / 100 };
}

// Seed payroll line items for a facility / pay class / period. Auto-pulls worked
// hours from SchedulingRecord (matched to roster by name fingerprint), then
// returns editable line items. Roster providers with no shift records are
// included with zero hours so salaried/back-office staff still appear.
//
// payClass: 'W2'  → roster entries where is1099 !== true
//           'CONTRACTOR' → roster entries where is1099 === true
async function seedLineItems({ facilityId, payClass, periodStart, periodEnd }) {
  const roster = await prisma.internalRosterEntry.findMany({
    where: {
      facilityId,
      ...(payClass === 'CONTRACTOR' ? { is1099: true } : { NOT: { is1099: true } }),
    },
  });

  const records = await prisma.schedulingRecord.findMany({
    where: {
      facilityId,
      shiftDate: { gte: new Date(periodStart), lte: new Date(periodEnd) },
    },
  });

  // Bucket scheduling records by name fingerprint.
  const recsByKey = {};
  for (const r of records) {
    const key = buildNameKey(r.providerName);
    if (!key) continue;
    (recsByKey[key] = recsByKey[key] || []).push(r);
  }

  // For 1099s, SUBMITTED provider hour entries are authoritative — override the
  // raw schedule hours. require() here (not top-level) avoids a load-order cycle.
  const submittedByRoster =
    payClass === 'CONTRACTOR'
      ? await require('./hourEntry').submittedShiftDetailByRoster({ facilityId, periodStart, periodEnd })
      : {};

  return roster.map((entry) => {
    const submitted = submittedByRoster[entry.id];
    const key = buildNameKey(entry.providerName);
    const recs = (key && recsByKey[key]) || [];
    const shiftDetail = (submitted && submitted.length
      ? submitted.map((s) => ({ date: s.date, start: '', end: '', hours: Number(s.hours || 0), type: 'Regular' }))
      : recs.map((r) => ({
          date: fmtDate(r.shiftDate),
          start: r.startTime || '',
          end: r.endTime || '',
          hours: Number(r.durationHours || 0),
          type: r.caseType || 'Regular',
        })))
      .sort((a, b) => a.date.localeCompare(b.date));

    const { regularHours, otHours } = splitRegularOt(shiftDetail);
    const hourlyRate = entry.hourlyRate ?? null;
    const annualRate = entry.annualRate ?? null;
    const grossPay = computeGross({ regularHours, otHours, hourlyRate, annualRate });

    return {
      rosterEntryId: entry.id,
      providerName: entry.providerName,
      businessName: entry.businessName || null,
      useBusinessNameForPayroll: !!entry.useBusinessNameForPayroll,
      role: entry.providerType || (entry.isNonClinical ? 'Staff' : null),
      payrollSystemId: entry.payrollSystemId || null,
      is1099: entry.is1099 ?? null,
      employmentCategory: entry.employmentCategory || null,
      regularHours,
      otHours,
      hourlyRate,
      annualRate,
      grossPay: Math.round(grossPay * 100) / 100,
      bonusFlat: null,
      bonusHours: null,
      bonusRate: null,
      bonusTotal: 0,
      shiftDetail,
      // UI flags
      missingRate: hourlyRate == null && annualRate == null,
      hasShiftData: shiftDetail.length > 0,
    };
  });
}

module.exports = {
  SNAP_FIELDS,
  DEFAULT_TEMPLATES,
  autoMapHeaders,
  extractHeaders,
  detectHeaderRow,
  generateCsv,
  computeGross,
  computeBonus,
  splitRegularOt,
  seedLineItems,
  fmtDate,
};
