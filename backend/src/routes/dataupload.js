const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
 * Row 0: header — col 0 empty, cols 1..N are date strings like "6/1 Mon", "6/2 Tue"
 * Subsequent rows: col 0 is facility+type label OR provider name filling that section.
 * Facility sections: "Atrius K ANES", "Atrius K CRNA", "Shattuck ANES", etc.
 * Provider rows: provider name in col 0, date cells contain shift annotations or empty.
 */
function parseSchedule4Matrix(workbook) {
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows || rows.length < 2) return null;

  // Detect matrix format: row 0 col 0 empty, row 0 col 1 looks like a date
  const headerRow = rows[0];
  const firstCell = String(headerRow[0] || '').trim();
  const secondCell = String(headerRow[1] || '').trim();
  const looksLikeMatrix = firstCell === '' && /\d+\/\d+/.test(secondCell);
  if (!looksLikeMatrix) return null;

  // Parse date columns from header row
  const dateCols = []; // [{ colIndex, date, dayName }]
  const SKIP_DAYS = ['Sat', 'Sun', 'Saturday', 'Sunday'];
  for (let c = 1; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    if (!cell) continue;
    // Format: "6/1 Mon" or "6/1\nMon" or "6/1 Monday"
    const match = cell.match(/(\d+)\/(\d+)\s*(.+)?/);
    if (!match) continue;
    const dayPart = (match[3] || '').trim().slice(0, 3);
    if (SKIP_DAYS.some(d => d.startsWith(dayPart))) continue;
    // Construct a full date (we'll use current year)
    const year = new Date().getFullYear();
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dateCols.push({ colIndex: c, date, dayName: dayPart, month, day });
  }

  if (dateCols.length === 0) return null;

  // Parse rows into records
  const records = [];
  const SKIP_ROWS = /^(PTO|Holiday|Sick|Off|Bereavement|Jury|Vacation|LOA)/i;

  let currentFacility = '';
  let currentType = ''; // 'ANES' or 'CRNA'

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const col0 = String(row[0] || '').trim();
    if (!col0) continue;

    // Check if this is a facility section header
    const facMatch = col0.match(/^(.+?)\s+(ANES|CRNA)$/i);
    if (facMatch) {
      // Normalize facility name
      currentFacility = facMatch[1].trim()
        .replace(/Atrius\s+K/i, 'Kenmore')
        .replace(/Atrius\s+W/i, 'Weymouth')
        .replace(/Atrius\s+/i, '');
      currentType = facMatch[2].toUpperCase();
      continue;
    }

    if (!currentFacility || !currentType) continue;
    if (SKIP_ROWS.test(col0)) continue;

    // Provider name — strip parenthetical annotations
    const providerName = col0.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (!providerName) continue;

    // Each date column where the cell is non-empty = this provider worked that day
    dateCols.forEach(({ colIndex, date }) => {
      const cell = String(row[colIndex] || '').trim();
      if (!cell) return;
      // Parse shift hours from annotation if present
      const hoursMatch = cell.match(/(\d+)hr/i);
      const shiftHours = hoursMatch ? parseInt(hoursMatch[1], 10) : 10;

      records.push({
        facility: currentFacility,
        providerName,
        providerType: currentType,
        date,
        shiftHours,
      });
    });
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
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  // Handle "8:00" → 8.0, "8:30" → 8.5
  if (/^\d+:\d{2}$/.test(str)) {
    const [h, m] = str.split(':').map(Number);
    return h + m / 60;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
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

router.post('/', facilityAuth, upload.single('file'), async (req, res) => {
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
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });

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

      const dbRecords = matrixRecords.map(r => ({
        facilityId:       req.facility.id,
        sourceUploadId:   schedulingUpload.id,
        providerName:     r.providerName,
        providerType:     providerTypeMap[r.providerType] || r.providerType,
        shiftDate:        new Date(r.date + 'T12:00:00'),
        durationHours:    r.shiftHours || 10,
        facilityLocation: r.facility,
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
      rate:             r.rate !== null && r.rate !== undefined ? parseFloat(r.rate) || null : null,
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

    // Batch insert records in chunks of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH).map((r) => ({
        ...r,
        sourceUploadId: schedulingUpload.id,
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
