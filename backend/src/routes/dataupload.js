const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { dayOfWeekFromLabel } = require('../utils/staffiqScore');
const { buildRosterKeyMap, tagRecord } = require('../services/rosterTag');

const router = express.Router();
// File-size + count cap: an uncapped memoryStorage upload lets one large file
// OOM the shared backend for every tenant (express.json's 2mb limit does NOT
// apply to multipart). 10 MB comfortably covers real multi-year schedule
// exports; oversize is rejected as 413 by the handler below.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

// Guardrails against a crafted workbook declaring an enormous dimension range
// (sheet_to_json materializes a dense grid) — cap parsed rows and date columns.
const MAX_PARSE_ROWS = 20000;
const MAX_DATE_COLS = 500;

// Reject an absurd declared sheet range BEFORE sheet_to_json materializes it.
// A tiny file can declare dimension A1:ZZ100000 and OOM the process; the
// file-size cap doesn't catch that, but the declared range does.
function assertSheetSize(ws) {
  const range = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!range) return;
  const nRows = range.e.r - range.s.r + 1;
  const nCols = range.e.c - range.s.c + 1;
  if (nRows > MAX_PARSE_ROWS || nCols > MAX_DATE_COLS) {
    const err = new Error(`Spreadsheet too large to process (${nRows} rows × ${nCols} columns; limit ${MAX_PARSE_ROWS} × ${MAX_DATE_COLS}). Please split the export.`);
    err.code = 'SHEET_TOO_LARGE';
    throw err;
  }
}

// Multer wrapper that turns a file-size overflow into a clean 413 instead of an
// unhandled MulterError bubbling to the generic handler.
function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (maximum 10 MB).' });
        return res.status(400).json({ error: err.message || 'Upload failed.' });
      }
      next();
    });
  };
}

// ── Column mapping aliases ─────────────────────────────────────────────────────

const COLUMN_ALIASES = {
  providerName:     ['provider', 'provider name', 'name', 'staff', 'anesthetist'],
  providerType:     ['type', 'provider type', 'role', 'specialty', 'position'],
  shiftDate:        ['date', 'shift date', 'day', 'service date', 'dos'],
  startTime:        ['start', 'start time', 'begin', 'time in'],
  endTime:          ['end', 'end time', 'finish', 'time out'],
  durationHours:    ['hours', 'duration', 'total hours', 'shift hours', 'hrs'],
  facilityLocation: ['location', 'room', 'or', 'suite', 'facility', 'site'],
  caseType:         ['case', 'case type', 'procedure', 'specialty'],
  rate:             ['rate', 'cost', 'pay rate', 'hourly rate', 'fee'],
};

/**
 * Given the actual column headers from the uploaded file, return a mapping of
 * { standardField: actualColName | null } using case-insensitive, trimmed matching.
 */
function buildColumnMapping(headers) {
  const lowerHeaders = headers.map((h) => ({ original: h, lower: String(h).trim().toLowerCase() }));
  const mapping = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = lowerHeaders.find(({ lower }) => aliases.includes(lower));
    mapping[field] = match ? match.original : null;
  }

  return mapping;
}

// ── Schedule4 Matrix Parser ───────────────────────────────────────────────────

/**
 * Parse Schedule4 "All_Assignments" matrix export format.
 *
 * Actual file structure (confirmed from CAPA export):
 *   Row 0:  col 0 empty, cols 1..N are date strings like "6/01 Mon"
 *   Section headers: "Atrius K (ANES)", "Atrius K (CRNA)", "Shattuck (ANES)" etc.
 *   Data rows: col 0 is EMPTY, date columns contain PROVIDER NAMES (one per room/day)
 *              Annotations stripped: "Mlansing (10hr 1)" → provider Mlansing, 10hr shift
 *
 * Data is column-oriented: each date column lists every provider who worked that day
 * within the current facility+type section. Multiple rows = multiple rooms covered.
 */
function parseSchedule4Matrix(workbook) {
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  assertSheetSize(ws);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows || rows.length < 2) return null;

  // Detect matrix format: row 0 col 0 empty, row 0 col 1 looks like a date
  const headerRow = rows[0];
  const firstCell = String(headerRow[0] || '').trim();
  const secondCell = String(headerRow[1] || '').trim();
  const looksLikeMatrix = firstCell === '' && /\d+\/\d+/.test(secondCell);
  if (!looksLikeMatrix) return null;

  // Parse date columns from header row — skip weekends
  const dateCols = [];
  const SKIP_DAYS = ['Sat', 'Sun'];
  for (let c = 1; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    if (!cell) continue;
    const match = cell.match(/(\d+)\/(\d+)\s*(.+)?/);
    if (!match) continue;
    const dayPart = (match[3] || '').trim().slice(0, 3);
    if (SKIP_DAYS.includes(dayPart)) continue;
    const year = new Date().getFullYear();
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Trust the weekday the file states ("5/01 Fri") over a year-derived guess —
    // schedules from a prior year (or spanning a year boundary) would otherwise be
    // mislabeled, which is exactly what breaks Friday detection.
    const dayOfWeek = dayOfWeekFromLabel(dayPart);
    dateCols.push({ colIndex: c, date, dayPart, dayOfWeek });
  }

  if (dateCols.length === 0) return null;

  // Accumulate providers per facility+type per date
  // { facilityName: { date: { anes: Set, crna: Set } } }
  const facilityDays = {};

  let currentFacility = null;
  let currentType = null;

  function normalizeFacility(name) {
    return name.trim()
      .replace(/Atrius\s+K\b/i, 'Kenmore')
      .replace(/Atrius\s+W\b/i, 'Weymouth')
      .replace(/Atrius\s+/i, '');
  }

  function stripAnnotations(cell) {
    // Remove parenthetical room/hour annotations: (10hr 1), (8hr), (2), (orient), etc.
    return String(cell).replace(/\s*\(.*?\)\s*/g, '').trim();
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const col0 = String(row[0] || '').trim();

    // Section header: "Facility Name (ANES)" or "Facility Name (CRNA)"
    const facMatch = col0.match(/^(.+?)\s*\((ANES|CRNA)\)$/i);
    if (facMatch) {
      currentFacility = normalizeFacility(facMatch[1]);
      currentType = facMatch[2].toUpperCase();
      if (!facilityDays[currentFacility]) facilityDays[currentFacility] = {};
      // Fall through — the section header row also contains providers in date columns
    } else if (col0) {
      // Non-empty col0 that isn't a facility header = skip section (PTO, Off, Brown, etc.)
      currentFacility = null;
      currentType = null;
      continue;
    }

    if (!currentFacility || !currentType) continue;

    // Read provider names from each date column
    dateCols.forEach(({ colIndex, date }) => {
      const raw = String(row[colIndex] || '').trim();
      if (!raw) return;

      const providerName = stripAnnotations(raw);
      if (!providerName) return;

      const hoursMatch = raw.match(/(\d+)hr/i);
      const shiftHours = hoursMatch ? parseInt(hoursMatch[1], 10) : 10;

      if (!facilityDays[currentFacility][date]) {
        facilityDays[currentFacility][date] = { anes: [], crna: [] };
      }

      const key = currentType === 'ANES' ? 'anes' : 'crna';
      facilityDays[currentFacility][date][key].push({ providerName, shiftHours });
    });
  }

  // date → weekday index (0=Sun..6=Sat) as stated by the source file.
  const dowByDate = {};
  dateCols.forEach(({ date, dayOfWeek }) => { dowByDate[date] = dayOfWeek; });

  // Flatten facilityDays into a flat records array
  const records = [];
  for (const [facility, days] of Object.entries(facilityDays)) {
    for (const [date, { anes, crna }] of Object.entries(days)) {
      const dayOfWeek = dowByDate[date] ?? null;
      anes.forEach(({ providerName, shiftHours }) => records.push({
        facility, providerName, providerType: 'ANES', date, shiftHours, dayOfWeek,
      }));
      crna.forEach(({ providerName, shiftHours }) => records.push({
        facility, providerName, providerType: 'CRNA', date, shiftHours, dayOfWeek,
      }));
    }
  }

  return records.length > 0 ? records : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAcceptedFile(file) {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  const ext = name.split('.').pop();
  const accepted = ['csv', 'xlsx', 'xls'];
  const acceptedMimes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ];
  return accepted.includes(ext) && !mime.includes('pdf');
}

function isPdf(file) {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

function parseShiftDate(val) {
  if (!val) return null;
  // XLSX sometimes returns a JS Date already
  if (val instanceof Date) return val;
  // Numeric serial date from Excel
  if (typeof val === 'number') {
    return XLSX.SSF.parse_date_code(val) ? new Date((val - 25569) * 86400 * 1000) : null;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function parseDurationHours(val) {
  let n = null;
  if (typeof val === 'number') n = val;
  else if (val !== null && val !== undefined) {
    const str = String(val).trim();
    // Handle "8:00" → 8.0, "8:30" → 8.5
    if (/^\d+:\d{2}$/.test(str)) {
      const [h, m] = str.split(':').map(Number);
      n = h + m / 60;
    } else {
      const p = parseFloat(str);
      n = isNaN(p) ? null : p;
    }
  }
  // Reject non-positive or implausibly long shifts — bad data would silently
  // skew StaffIQ cost/savings rather than error.
  return (n === null || n <= 0 || n > 24) ? null : n;
}

// A loaded provider rate must be positive; negative/zero/NaN is invalid data
// (parseFloat("-500") passes a naive `|| null` check and corrupts cost math).
function saneRate(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return (isNaN(n) || n <= 0) ? null : n;
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  assertSheetSize(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return rows;
}

function parseWorkbookRaw(buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true });
}

function applyMapping(rows, mapping) {
  return rows.map((row) => {
    const record = {};
    for (const [field, col] of Object.entries(mapping)) {
      record[field] = col ? (row[col] !== undefined ? row[col] : null) : null;
    }
    return record;
  });
}

// ── GET / — list uploads for facility ────────────────────────────────────────

router.get('/', facilityAuth, async (req, res) => {
  try {
    const uploads = await prisma.schedulingUpload.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        rowCount: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        status: true,
        uploadedAt: true,
      },
    });

    const totalRecords = uploads.reduce((sum, u) => sum + (u.rowCount || 0), 0);

    const dates = uploads
      .flatMap((u) => [u.dateRangeStart, u.dateRangeEnd])
      .filter(Boolean)
      .map((d) => new Date(d).getTime());

    const dateRangeStart = dates.length ? new Date(Math.min(...dates)) : null;
    const dateRangeEnd   = dates.length ? new Date(Math.max(...dates)) : null;

    res.json({ uploads, totalRecords, dateRangeStart, dateRangeEnd });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// ── POST / — upload and return mapping preview ────────────────────────────────

router.post('/', facilityAuth, uploadSingle('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (isPdf(req.file)) {
      return res.status(400).json({
        error:
          'PDF files cannot be parsed for scheduling data. Please export your data as CSV or Excel from your scheduling system such as Schedule4, QGenda, OpenShift, or OpenTempo.',
      });
    }

    if (!isAcceptedFile(req.file)) {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a CSV, XLSX, or XLS file.' });
    }

    // Try Schedule4 matrix format first
    const workbook = parseWorkbookRaw(req.file.buffer);
    const matrixRecords = parseSchedule4Matrix(workbook);

    if (matrixRecords) {
      return res.json({
        format: 'schedule4_matrix',
        records: matrixRecords,
        preview: matrixRecords.slice(0, 10),
        totalRecords: matrixRecords.length,
        fileName: req.file.originalname,
        fileData: req.file.buffer.toString('base64'),
      });
    }

    // Fallback: standard column-mapping approach
    const fallbackSheet = workbook.Sheets[workbook.SheetNames[0]];
    assertSheetSize(fallbackSheet);
    const rows = XLSX.utils.sheet_to_json(fallbackSheet, { defval: null });

    if (!rows.length) {
      return res.status(400).json({ error: 'The uploaded file contains no data rows.' });
    }

    const headers = Object.keys(rows[0]);
    const mapping = buildColumnMapping(headers);
    const preview = rows.slice(0, 5);

    res.json({
      mapping,
      preview,
      totalRows: rows.length,
      fileName: req.file.originalname,
      fileData: req.file.buffer.toString('base64'),
    });
  } catch (err) {
    if (err.code === 'SHEET_TOO_LARGE') return res.status(413).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to parse uploaded file' });
  }
});

// ── POST /confirm — confirm mapping and import records ────────────────────────

router.post('/confirm', facilityAuth, async (req, res) => {
  try {
    const { fileName, mapping, fileData, format } = req.body;

    if (!fileName || !fileData) {
      return res.status(400).json({ error: 'fileName and fileData are required' });
    }

    const buffer = Buffer.from(fileData, 'base64');

    // ── Schedule4 matrix path ─────────────────────────────────────────────────
    if (format === 'schedule4_matrix') {
      const workbook = parseWorkbookRaw(buffer);
      const matrixRecords = parseSchedule4Matrix(workbook);

      if (!matrixRecords || matrixRecords.length === 0) {
        return res.status(400).json({ error: 'Could not re-parse Schedule4 matrix from uploaded file.' });
      }

      // Determine date range
      const dates = matrixRecords.map(r => new Date(r.date + 'T12:00:00')).filter(d => !isNaN(d));
      const dateRangeStart = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
      const dateRangeEnd   = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

      // Create upload record
      const schedulingUpload = await prisma.schedulingUpload.create({
        data: {
          facilityId: req.facility.id,
          fileName,
          rowCount: 0,
          dateRangeStart,
          dateRangeEnd,
          status: 'PROCESSING',
        },
      });

      // Map providerType: ANES → ANESTHESIOLOGIST, CRNA → CRNA
      const providerTypeMap = {
        ANES: 'ANESTHESIOLOGIST',
        CRNA: 'CRNA',
      };

      // Roster-vs-agency tagging (benchmark metric 3) — match each provider
      // name against the internal roster by the shared fingerprint rule.
      const rosterKeys = await buildRosterKeyMap(req.facility.id);

      const dbRecords = matrixRecords.map(r => ({
        facilityId:       req.facility.id,
        sourceUploadId:   schedulingUpload.id,
        providerName:     r.providerName,
        providerType:     providerTypeMap[r.providerType] || r.providerType,
        shiftDate:        new Date(r.date + 'T12:00:00'),
        durationHours:    parseDurationHours(r.shiftHours) || 10,
        facilityLocation: r.facility,
        dayOfWeek:        Number.isInteger(r.dayOfWeek) ? r.dayOfWeek : null,
        ...tagRecord(r.providerName, rosterKeys),
      }));

      // Batch insert in chunks of 500
      const BATCH = 500;
      let inserted = 0;
      for (let i = 0; i < dbRecords.length; i += BATCH) {
        const chunk = dbRecords.slice(i, i + BATCH);
        const result = await prisma.schedulingRecord.createMany({ data: chunk });
        inserted += result.count;
      }

      // Update upload with final counts
      await prisma.schedulingUpload.update({
        where: { id: schedulingUpload.id },
        data: { rowCount: inserted, dateRangeStart, dateRangeEnd, status: 'COMPLETE' },
      });

      return res.json({
        uploadId: schedulingUpload.id,
        rowCount: inserted,
        dateRangeStart,
        dateRangeEnd,
        format: 'schedule4_matrix',
      });
    }

    // ── Standard column-mapping path ──────────────────────────────────────────
    if (!mapping) {
      return res.status(400).json({ error: 'mapping is required for standard format uploads' });
    }

    const rows   = parseWorkbook(buffer);
    const mapped = applyMapping(rows, mapping);

    const records = mapped.map((r) => ({
      facilityId:       req.facility.id,
      providerName:     r.providerName ? String(r.providerName) : null,
      providerType:     r.providerType ? String(r.providerType) : null,
      shiftDate:        parseShiftDate(r.shiftDate),
      startTime:        r.startTime    ? String(r.startTime)    : null,
      endTime:          r.endTime      ? String(r.endTime)      : null,
      durationHours:    parseDurationHours(r.durationHours),
      facilityLocation: r.facilityLocation ? String(r.facilityLocation) : null,
      caseType:         r.caseType    ? String(r.caseType)    : null,
      rate:             saneRate(r.rate),
      dayOfWeek:        (() => { const d = parseShiftDate(r.shiftDate); return d && !isNaN(d.getTime()) ? d.getDay() : null; })(),
    }));

    const validDates = records.map((r) => r.shiftDate).filter(Boolean);
    const dateRangeStart = validDates.length ? new Date(Math.min(...validDates.map((d) => d.getTime()))) : null;
    const dateRangeEnd   = validDates.length ? new Date(Math.max(...validDates.map((d) => d.getTime()))) : null;

    // Create the upload record first
    const schedulingUpload = await prisma.schedulingUpload.create({
      data: {
        facilityId:    req.facility.id,
        fileName,
        rowCount:      0, // updated after insert
        dateRangeStart,
        dateRangeEnd,
        status:        'PROCESSING',
      },
    });

    // Roster-vs-agency tagging (benchmark metric 3) — shared fingerprint rule.
    const rosterKeys = await buildRosterKeyMap(req.facility.id);

    // Batch insert records in chunks of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH).map((r) => ({
        ...r,
        sourceUploadId: schedulingUpload.id,
        ...tagRecord(r.providerName, rosterKeys),
      }));
      const result = await prisma.schedulingRecord.createMany({ data: chunk });
      inserted += result.count;
    }

    // Update upload with final counts
    await prisma.schedulingUpload.update({
      where: { id: schedulingUpload.id },
      data: {
        rowCount:      inserted,
        dateRangeStart,
        dateRangeEnd,
        status:        'COMPLETE',
      },
    });

    res.json({
      uploadId:      schedulingUpload.id,
      rowCount:      inserted,
      dateRangeStart,
      dateRangeEnd,
    });
  } catch (err) {
    if (err.code === 'SHEET_TOO_LARGE') return res.status(413).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm and import scheduling data' });
  }
});

// ── GET /stats — aggregate stats for facility ─────────────────────────────────

router.get('/stats', facilityAuth, async (req, res) => {
  try {
    const uploads = await prisma.schedulingUpload.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        rowCount: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        status: true,
        uploadedAt: true,
      },
    });

    const totalUploads  = uploads.length;
    const totalRecords  = uploads.reduce((sum, u) => sum + (u.rowCount || 0), 0);

    const dates = uploads
      .flatMap((u) => [u.dateRangeStart, u.dateRangeEnd])
      .filter(Boolean)
      .map((d) => new Date(d).getTime());

    const dateRangeStart  = dates.length ? new Date(Math.min(...dates)) : null;
    const dateRangeEnd    = dates.length ? new Date(Math.max(...dates)) : null;
    const uploadHistory   = uploads.slice(0, 5);

    res.json({ totalRecords, totalUploads, dateRangeStart, dateRangeEnd, uploadHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch upload stats' });
  }
});

module.exports = router;
