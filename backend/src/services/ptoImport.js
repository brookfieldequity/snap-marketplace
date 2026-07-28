'use strict';

// PTO spreadsheet import — parses a facility's existing PTO/vacation workbook
// into per-person date ranges, then fuzzy-matches the names against the
// internal roster. Used by POST /api/roster/time-off/upload-preview.
//
// Two layouts are auto-detected, per sheet (a workbook may mix them across
// tabs, e.g. one tab per month):
//   RANGE — one row per PTO entry: a name column + start (+ optional end,
//           reason) columns, or a single "date" column for one-day rows.
//   GRID  — names down the first column, dates across the header row (full
//           dates, or day numbers 1–31 with the month/year read from the
//           sheet name or a title cell). Any marked cell = a PTO day.
//
// Everything lands as inclusive [startDate, endDate] ISO ranges — the same
// shape RosterTimeOff stores — so the import writes the one table every
// scheduling surface already treats as authoritative.

const XLSX = require('xlsx');

const MAX_SHEETS = 20;
const MAX_ROWS = 3000;
const MAX_COLS = 400;
const MAX_DATES_PER_WORKBOOK = 20000;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// ── date parsing (all UTC-component based; no timezone drift) ────────────────

function isoFromYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject rollovers like Feb 30 → Mar 2.
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function isoFromExcelSerial(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const days = Math.round(serial);
  if (days < 20000 || days > 80000) return null; // ~1954..2119 — reject counts/hours
  const dt = new Date((days - 25569) * 86400 * 1000);
  return dt.toISOString().slice(0, 10);
}

function monthFromName(word) {
  const w = String(word || '').toLowerCase().slice(0, 3);
  const idx = MONTH_NAMES.findIndex((m) => m.startsWith(w));
  return idx === -1 ? null : idx + 1;
}

// Parse one cell into an ISO date. Returns { iso, assumedYear } or null.
// `defaultYear` fills in year-less forms like "6/12" or "Jun 12".
function parseDateCell(val, defaultYear) {
  if (val == null || val === '') return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    // xlsx cellDates / JS Dates — shift to noon so UTC getters can't cross
    // a day boundary in either direction.
    const noon = new Date(val.getTime() + 12 * 3600 * 1000);
    return { iso: noon.toISOString().slice(0, 10), assumedYear: false };
  }
  if (typeof val === 'number') {
    const iso = isoFromExcelSerial(val);
    return iso ? { iso, assumedYear: false } : null;
  }
  const s = String(val).trim();
  if (!s || s.length > 40) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const iso = isoFromYmd(+m[1], +m[2], +m[3]);
    return iso ? { iso, assumedYear: false } : null;
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const iso = isoFromYmd(y, +m[1], +m[2]);
    return iso ? { iso, assumedYear: false } : null;
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const iso = isoFromYmd(defaultYear, +m[1], +m[2]);
    return iso ? { iso, assumedYear: true } : null;
  }
  // "Jun 12", "June 12, 2026", "12-Jun", "12 June 2026"
  m = s.match(/^([a-zA-Z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mo = monthFromName(m[1]);
    if (mo) {
      const y = m[3] ? +m[3] : defaultYear;
      const iso = isoFromYmd(y, mo, +m[2]);
      return iso ? { iso, assumedYear: !m[3] } : null;
    }
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-.]+([a-zA-Z]{3,9})\.?(?:[\s,]+(\d{4}))?$/);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo) {
      const y = m[3] ? +m[3] : defaultYear;
      const iso = isoFromYmd(y, mo, +m[1]);
      return iso ? { iso, assumedYear: !m[3] } : null;
    }
  }
  return null;
}

// ── header / layout detection ────────────────────────────────────────────────

const headerText = (v) => String(v == null ? '' : v).trim().toLowerCase();

function findCol(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const h = headerText(headers[i]);
    if (!h) continue;
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

const NAME_PATTERNS = [/name/, /^provider/, /^employee/, /^staff/, /^clinician/, /^person/, /^who$/];
const START_PATTERNS = [/^start/, /^from/, /^begin/, /first\s*day/, /leave\s*(date|start)/];
const END_PATTERNS = [/^end/, /^to$/, /^through/, /^thru/, /^return/, /last\s*day/, /^until/, /^back/];
const DATE_PATTERNS = [/^date/, /^day$/, /^pto\s*date/];
const REASON_PATTERNS = [/reason/, /^type/, /note/, /comment/, /category/, /description/];

// Values in a grid cell that do NOT mean PTO.
const GRID_IGNORE = new Set(['', '-', '–', '0', 'w', 'work', 'working', 'on', 'avail', 'available', 'yes', 'y', 'n/a', 'na', 'ok']);
// Marker values that mean PTO but carry no reason text.
const GRID_MARKERS = new Set(['x', 'xx', '✓', '✔', '1', 'true', 'p', 'o', 'off', 'pto', '8', 'v']);
// Row labels that are clearly not people.
const NON_PERSON_ROW = /^(total|totals|count|sum|week|notes?|holiday|date|day|mon|tue|wed|thu|fri|sat|sun)s?\b/i;

// Month/year context for day-number grids: look in the sheet name, then the
// first few rows, for a month name and/or a 4-digit year.
function detectMonthContext(sheetName, rows, defaultYear) {
  const texts = [sheetName];
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    for (const cell of (rows[r] || []).slice(0, 12)) {
      if (typeof cell === 'string' && cell.trim()) texts.push(cell);
    }
  }
  let month = null;
  let year = null;
  for (const t of texts) {
    const lower = String(t).toLowerCase();
    if (month == null) {
      for (let mo = 0; mo < 12; mo++) {
        if (new RegExp(`\\b${MONTH_NAMES[mo].slice(0, 3)}[a-z]*\\b`).test(lower)) { month = mo + 1; break; }
      }
    }
    if (year == null) {
      const ym = lower.match(/\b(20\d{2})\b/);
      if (ym) year = +ym[1];
    }
    if (month != null && year != null) break;
  }
  return { month, year: year != null ? year : defaultYear };
}

// ── per-sheet parsing ────────────────────────────────────────────────────────

function addDay(person, iso, reason, state) {
  if (state.totalDates >= MAX_DATES_PER_WORKBOOK) { state.overflow = true; return; }
  const cur = person.days.get(iso);
  if (!cur || (!cur.reason && reason)) person.days.set(iso, { reason: reason || (cur && cur.reason) || null });
  state.totalDates++;
}

function getPerson(people, rawName) {
  const key = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!people.has(key)) people.set(key, { sourceName: rawName.trim(), days: new Map() });
  return people.get(key);
}

function parseRangeSheet(rows, headerRowIdx, cols, defaultYear, people, warnings, state, sheetName) {
  let assumedYearRows = 0;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawName = String(row[cols.name] == null ? '' : row[cols.name]).trim();
    if (!rawName || NON_PERSON_ROW.test(rawName)) continue;

    const startCell = cols.start !== -1 ? row[cols.start] : row[cols.date];
    let start = parseDateCell(startCell, defaultYear);
    let end = cols.end !== -1 ? parseDateCell(row[cols.end], defaultYear) : null;

    // Text ranges in a single cell: "6/12 - 6/15", "Jun 12 – Jun 15"
    if (!start && typeof startCell === 'string' && /[–—-]/.test(startCell)) {
      const parts = startCell.split(/\s*[–—-]\s*/).filter(Boolean);
      if (parts.length === 2) {
        start = parseDateCell(parts[0], defaultYear);
        end = end || parseDateCell(parts[1], defaultYear);
      }
    }
    if (!start) {
      if (startCell != null && String(startCell).trim() !== '') {
        warnings.push(`"${sheetName}" row ${r + 1}: couldn't read date "${String(startCell).slice(0, 30)}" for ${rawName} — skipped.`);
      }
      continue;
    }
    if (!end || end.iso < start.iso) end = start;
    if (start.assumedYear || end.assumedYear) assumedYearRows++;

    const reason = cols.reason !== -1 && row[cols.reason] != null && String(row[cols.reason]).trim() !== ''
      ? String(row[cols.reason]).trim().slice(0, 120)
      : null;

    const person = getPerson(people, rawName);
    const startD = new Date(start.iso + 'T00:00:00Z');
    const endD = new Date(end.iso + 'T00:00:00Z');
    const spanDays = Math.round((endD - startD) / 86400000) + 1;
    if (spanDays > 366) {
      warnings.push(`"${sheetName}" row ${r + 1}: range ${start.iso} → ${end.iso} is longer than a year — skipped.`);
      continue;
    }
    for (let t = startD.getTime(); t <= endD.getTime(); t += 86400000) {
      addDay(person, new Date(t).toISOString().slice(0, 10), reason, state);
    }
  }
  if (assumedYearRows > 0) {
    warnings.push(`"${sheetName}": ${assumedYearRows} row(s) had dates without a year — assumed ${defaultYear}.`);
  }
}

function parseGridSheet(rows, headerRowIdx, dateCols, nameCol, people, state) {
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawName = String(row[nameCol] == null ? '' : row[nameCol]).trim();
    if (!rawName || NON_PERSON_ROW.test(rawName)) continue;
    // A row whose "name" parses as a date is a stray header/date row.
    if (parseDateCell(rawName, 2000)) continue;

    let person = null;
    for (const { col, iso } of dateCols) {
      const val = row[col];
      if (val == null) continue;
      const text = String(val).trim().toLowerCase();
      if (GRID_IGNORE.has(text)) continue;
      const reason = GRID_MARKERS.has(text) ? null : String(val).trim().slice(0, 120);
      if (!person) person = getPerson(people, rawName);
      addDay(person, iso, reason, state);
    }
  }
}

// Analyze one sheet: find the header row and layout, then parse.
function parseSheet(ws, sheetName, defaultYear, people, warnings, state) {
  const ref = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!ref) return;
  if (ref.e.r - ref.s.r + 1 > MAX_ROWS || ref.e.c - ref.s.c + 1 > MAX_COLS) {
    warnings.push(`Sheet "${sheetName}" is too large (${ref.e.r - ref.s.r + 1} rows × ${ref.e.c - ref.s.c + 1} cols) — skipped.`);
    return;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (rows.length === 0) return;

  const ctx = detectMonthContext(sheetName, rows, defaultYear);

  // Scan the first 12 rows for a usable header.
  for (let h = 0; h < Math.min(rows.length, 12); h++) {
    const headers = rows[h] || [];

    // RANGE layout?
    const nameCol = findCol(headers, NAME_PATTERNS);
    if (nameCol !== -1) {
      const startCol = findCol(headers, START_PATTERNS);
      const dateCol = findCol(headers, DATE_PATTERNS);
      if (startCol !== -1 || dateCol !== -1) {
        parseRangeSheet(rows, h, {
          name: nameCol,
          start: startCol,
          end: findCol(headers, END_PATTERNS),
          date: dateCol,
          reason: findCol(headers, REASON_PATTERNS),
        }, defaultYear, people, warnings, state, sheetName);
        return;
      }
    }

    // GRID layout? — ≥3 header cells that are dates (or day numbers 1–31).
    const dateCols = [];
    let dayNumberCols = 0;
    for (let c = 0; c < headers.length; c++) {
      const v = headers[c];
      if (v == null || v === '') continue;
      const asDate = parseDateCell(v, ctx.year);
      if (asDate && !(typeof v === 'number' && v <= 31)) {
        dateCols.push({ col: c, iso: asDate.iso });
        continue;
      }
      const n = typeof v === 'number' ? v : (String(v).trim().match(/^\d{1,2}$/) ? +String(v).trim() : NaN);
      if (Number.isInteger(n) && n >= 1 && n <= 31) {
        dateCols.push({ col: c, day: n });
        dayNumberCols++;
      }
    }
    if (dateCols.length >= 3) {
      let resolved = dateCols;
      if (dayNumberCols > 0) {
        if (ctx.month == null) {
          warnings.push(`Sheet "${sheetName}" looks like a day-number grid but no month name was found on the tab or title — skipped. Rename the tab (e.g. "March ${defaultYear}") and re-upload.`);
          return;
        }
        resolved = dateCols
          .map((dc) => dc.iso ? dc : { col: dc.col, iso: isoFromYmd(ctx.year, ctx.month, dc.day) })
          .filter((dc) => dc.iso);
      }
      // Name column: leftmost column before the first date column.
      const firstDateCol = Math.min(...resolved.map((d) => d.col));
      const gridNameCol = nameCol !== -1 && nameCol < firstDateCol ? nameCol : (firstDateCol > 0 ? 0 : -1);
      if (gridNameCol === -1) continue;
      parseGridSheet(rows, h, resolved, gridNameCol, people, state);
      return;
    }
  }
  warnings.push(`Sheet "${sheetName}": couldn't find a name + date layout — skipped.`);
}

// ── workbook entry point ─────────────────────────────────────────────────────

// Compress a person's day map into sorted inclusive ranges, splitting when the
// reason changes so "Vacation" and "CME" stay separate entries.
function compressDays(days) {
  const isoList = [...days.keys()].sort();
  const ranges = [];
  for (const iso of isoList) {
    const reason = days.get(iso).reason;
    const prev = ranges[ranges.length - 1];
    if (prev && reason === prev.reason) {
      const nextDay = new Date(new Date(prev.endDate + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
      if (nextDay === iso) { prev.endDate = iso; continue; }
    }
    ranges.push({ startDate: iso, endDate: iso, reason });
  }
  return ranges;
}

/**
 * parsePtoWorkbook(buffer, { defaultYear }) →
 *   { people: [{ sourceName, ranges: [{startDate, endDate, reason}] }], warnings: [] }
 */
function parsePtoWorkbook(buffer, { defaultYear } = {}) {
  const year = defaultYear || new Date().getUTCFullYear();
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const people = new Map();
  const warnings = [];
  const state = { totalDates: 0, overflow: false };

  const sheetNames = wb.SheetNames.slice(0, MAX_SHEETS);
  if (wb.SheetNames.length > MAX_SHEETS) {
    warnings.push(`Workbook has ${wb.SheetNames.length} tabs — only the first ${MAX_SHEETS} were read.`);
  }
  for (const name of sheetNames) {
    parseSheet(wb.Sheets[name], name, year, people, warnings, state);
  }
  if (state.overflow) {
    warnings.push(`Workbook contains more than ${MAX_DATES_PER_WORKBOOK.toLocaleString()} PTO days — extra entries were dropped.`);
  }

  return {
    people: [...people.values()].map((p) => ({ sourceName: p.sourceName, ranges: compressDays(p.days) })),
    warnings,
  };
}

// ── roster name matching ─────────────────────────────────────────────────────

const CRED_TOKENS = new Set(['crna', 'md', 'do', 'dnp', 'aprn', 'apn', 'pa', 'aa', 'caa', 'rn', 'np', 'phd', 'jr', 'sr', 'ii', 'iii', 'iv', 'dr']);

function nameTokens(name) {
  let s = String(name || '').toLowerCase();
  // "Last, First [Middle]" → "first middle last"
  const comma = s.split(',');
  if (comma.length === 2) s = `${comma[1]} ${comma[0]}`;
  return s
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t && !CRED_TOKENS.has(t));
}

// Score similarity between an uploaded name and a roster name. 0..1.
function scoreNames(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = aTokens.join(' ');
  const b = bTokens.join(' ');
  if (a === b) return 1;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  if (aTokens.length === bTokens.length && aTokens.every((t) => bSet.has(t))) return 0.95;
  const aLast = aTokens[aTokens.length - 1];
  const bLast = bTokens[bTokens.length - 1];
  if (aLast === bLast) {
    if (aTokens[0] && bTokens[0] && aTokens[0][0] === bTokens[0][0]) {
      return aTokens[0] === bTokens[0] ? 0.95 : 0.85;
    }
    return 0.7;
  }
  // First name matches and one side only has a first name ("Sarah" on a grid).
  if (aTokens[0] === bTokens[0] && (aTokens.length === 1 || bTokens.length === 1)) return 0.6;
  const overlap = [...aSet].filter((t) => bSet.has(t)).length;
  return overlap > 0 ? 0.5 * (overlap / Math.max(aSet.size, bSet.size)) : 0;
}

/**
 * matchToRoster(sourceName, rosterEntries) — rosterEntries: [{id, providerName}].
 * Returns { rosterId|null, confidence, candidates: [{id, name, score}] }.
 * Auto-matches only when the best score is decisive AND unambiguous.
 */
function matchToRoster(sourceName, rosterEntries) {
  const src = nameTokens(sourceName);
  const scored = rosterEntries
    .map((e) => ({ id: e.id, name: e.providerName, score: scoreNames(src, e._tokens || nameTokens(e.providerName)) }))
    .filter((c) => c.score >= 0.5)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);
  const best = scored[0];
  const second = scored[1];
  const decisive = best && best.score >= 0.7 && (!second || second.score < best.score - 0.1 || second.id === best.id);
  return {
    rosterId: decisive ? best.id : null,
    confidence: best ? best.score : 0,
    candidates: scored,
  };
}

module.exports = { parsePtoWorkbook, matchToRoster, nameTokens };
