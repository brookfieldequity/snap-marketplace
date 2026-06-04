const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { logAutomationEvent } = require('../services/automationEvents');
const { resolveNpi } = require('../services/nppesLookup');

const router = express.Router();

// In-memory upload for CSV/XLSX parsing — files are small (rosters are
// 10-200 rows typically). Cap at 5MB and reject non-spreadsheet types.
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .csv, .xlsx, or .xls files are accepted.'), ok);
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve whether a snapAccountEmail is linked to a registered SNAP provider.
 * Returns { snapAccountLinked, linkedProviderId } ready to merge into a update.
 */
async function resolveLinkFields(email) {
  if (!email) return { snapAccountLinked: false, linkedProviderId: null };

  const user = await prisma.user.findUnique({
    where: { email },
    include: { providerProfile: { select: { id: true } } },
  });

  if (user?.providerProfile) {
    return { snapAccountLinked: true, linkedProviderId: user.providerProfile.id };
  }
  return { snapAccountLinked: false, linkedProviderId: null };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET / — list all roster entries for the facility
router.get('/', facilityAuth, async (req, res) => {
  try {
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { providerName: 'asc' },
    });
    res.json(entries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a roster entry
router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      providerName, providerType, employmentCategory,
      snapAccountEmail, phoneNumber, licenseNumber, licenseExpiration, notes,
      fteHours, annualRate, hourlyRate, preferredShiftLength,
      preferredDays, locationRankings, maxShiftsPerMonth,
      contractStart, contractEnd,
    } = req.body;

    const linkFields = await resolveLinkFields(snapAccountEmail);

    const entry = await prisma.internalRosterEntry.create({
      data: {
        facilityId: req.facility.id,
        providerName, providerType, employmentCategory,
        snapAccountEmail: snapAccountEmail || null,
        phoneNumber: phoneNumber || null,
        licenseNumber: licenseNumber || null,
        licenseExpiration: licenseExpiration ? new Date(licenseExpiration) : null,
        notes: notes || null,
        fteHours: fteHours != null ? parseFloat(fteHours) : null,
        annualRate: annualRate != null ? parseFloat(annualRate) : null,
        hourlyRate: hourlyRate != null ? parseFloat(hourlyRate) : null,
        preferredShiftLength: preferredShiftLength || null,
        preferredDays: preferredDays ?? null,
        locationRankings: locationRankings ?? null,
        maxShiftsPerMonth: maxShiftsPerMonth != null ? parseInt(maxShiftsPerMonth) : null,
        contractStart: contractStart ? new Date(contractStart) : null,
        contractEnd: contractEnd ? new Date(contractEnd) : null,
        ...linkFields,
      },
    });

    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — partial update a roster entry
router.patch('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const {
      providerName, providerType, employmentCategory,
      snapAccountEmail, phoneNumber, licenseNumber, licenseExpiration, notes,
      fteHours, annualRate, hourlyRate, preferredShiftLength,
      preferredDays, locationRankings, maxShiftsPerMonth,
      contractStart, contractEnd,
    } = req.body;

    // Re-check linkage if email is being changed
    let linkFields = {};
    if (snapAccountEmail !== undefined) {
      linkFields = await resolveLinkFields(snapAccountEmail);
    }

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: {
        ...(providerName !== undefined && { providerName }),
        ...(providerType !== undefined && { providerType }),
        ...(employmentCategory !== undefined && { employmentCategory }),
        ...(snapAccountEmail !== undefined && { snapAccountEmail }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(licenseNumber !== undefined && { licenseNumber }),
        ...(licenseExpiration !== undefined && {
          licenseExpiration: licenseExpiration ? new Date(licenseExpiration) : null,
        }),
        ...(notes !== undefined && { notes }),
        ...(fteHours !== undefined && { fteHours: fteHours != null ? parseFloat(fteHours) : null }),
        ...(annualRate !== undefined && { annualRate: annualRate != null ? parseFloat(annualRate) : null }),
        ...(hourlyRate !== undefined && { hourlyRate: hourlyRate != null ? parseFloat(hourlyRate) : null }),
        ...(preferredShiftLength !== undefined && { preferredShiftLength }),
        ...(preferredDays !== undefined && { preferredDays }),
        ...(locationRankings !== undefined && { locationRankings }),
        ...(maxShiftsPerMonth !== undefined && { maxShiftsPerMonth: maxShiftsPerMonth != null ? parseInt(maxShiftsPerMonth) : null }),
        ...(contractStart !== undefined && { contractStart: contractStart ? new Date(contractStart) : null }),
        ...(contractEnd !== undefined && { contractEnd: contractEnd ? new Date(contractEnd) : null }),
        ...linkFields,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete a roster entry
router.delete('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.internalRosterEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/invite — mark invite sent, auto-link if provider found
router.post('/:id/invite', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const linkFields = await resolveLinkFields(existing.snapAccountEmail);

    // TODO: send SMS/email via Twilio (Phase 2)

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: {
        inviteSentAt: new Date(),
        ...linkFields,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/link-check — check SNAP account registration and auto-link
router.post('/:id/link-check', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const linkFields = await resolveLinkFields(existing.snapAccountEmail);

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: linkFields,
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV / Excel upload — bulk-import a facility's roster
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expected column headers (case-insensitive; underscores or spaces ok):
 *   name (required)
 *   type (required)         CRNA | ANESTHESIOLOGIST | ANESTHESIA_ASSISTANT
 *   employment (required)   FULL_TIME | PER_DIEM | LOCUMS
 *   npi                     10-digit identifier; used to match the marketplace provider profile
 *   email                   snapAccountEmail — used as a secondary link if NPI missing
 *   phone                   phoneNumber (for SMS, when enabled)
 *   license_number
 *   license_expiration      YYYY-MM-DD or any Date-parseable format
 *   hourly_rate             per-diem / locums
 *   annual_rate             full-time
 *   fte_hours               full-time hours/week (e.g. 40)
 *
 * Common synonyms accepted (case-insensitive, whitespace/_ stripped):
 *   full_name, provider_name → name
 *   specialty → type
 *   employment_type, employment_category → employment
 *   hourly, rate → hourly_rate
 *   annual_salary, salary → annual_rate
 */
const HEADER_SYNONYMS = {
  name: ['name', 'fullname', 'providername'],
  type: ['type', 'specialty', 'providertype', 'role'],
  employment: ['employment', 'employmenttype', 'employmentcategory'],
  npi: ['npi', 'npinumber'],
  email: ['email', 'snapaccountemail', 'snapemail'],
  phone: ['phone', 'phonenumber', 'mobile'],
  license_number: ['licensenumber', 'license'],
  license_expiration: ['licenseexpiration', 'licenseexpiry', 'licenseexp'],
  hourly_rate: ['hourlyrate', 'hourly', 'rate', 'perhour'],
  annual_rate: ['annualrate', 'annualsalary', 'salary'],
  fte_hours: ['ftehours', 'hoursperweek'],
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_]/g, '');
}

function buildHeaderMap(headerRow) {
  const map = {}; // canonicalKey → original column index
  headerRow.forEach((rawHeader, idx) => {
    const normalized = normalizeHeader(rawHeader);
    for (const [canonical, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.includes(normalized) && map[canonical] == null) {
        map[canonical] = idx;
      }
    }
  });
  return map;
}

const VALID_SPECIALTIES = ['CRNA', 'ANESTHESIOLOGIST', 'ANESTHESIA_ASSISTANT'];
const VALID_EMPLOYMENT = ['FULL_TIME', 'PER_DIEM', 'LOCUMS'];

/**
 * Normalize a free-form type/employment string to one of the enum values.
 * Returns null if no match.
 */
function normalizeSpecialty(v) {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/[\s_-]/g, '');
  if (s.includes('CRNA') || s.includes('NURSEANESTHETIST')) return 'CRNA';
  if (s.includes('ASSISTANT') || s === 'AA') return 'ANESTHESIA_ASSISTANT';
  if (s.includes('ANESTHESIOLOGIST') || s === 'MD' || s === 'DO') return 'ANESTHESIOLOGIST';
  // Last resort: direct enum match
  return VALID_SPECIALTIES.find((x) => x === s) || null;
}
function normalizeEmployment(v) {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/[\s_-]/g, '');
  if (s.startsWith('FT') || s.includes('FULL')) return 'FULL_TIME';
  if (s.includes('PERDIEM') || s === 'PRN' || s === 'PD') return 'PER_DIEM';
  if (s.includes('LOCUM')) return 'LOCUMS';
  return VALID_EMPLOYMENT.find((x) => x === s) || null;
}
function parseDate(v) {
  if (!v) return null;
  // xlsx returns Date objects directly for date-formatted cells.
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function parseNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ── Multi-sheet xlsx import (CAPA-style) ─────────────────────────────────────
// When a workbook has both a "Staff" sheet (identity) and a "Payroll" sheet
// (compensation), we treat it as a multi-sheet customer roster export:
//   - Join Staff + Payroll by a NAME fingerprint (first initial + last name).
//     Initials columns vary in format across sheets and customers; name is
//     the reliable join key. Verified against CAPA's real export 2026-06-03:
//     84/84 records joined cleanly via name fingerprint.
//   - Run NPPES NPI resolution per provider since these files typically lack NPI
//   - Read optional Facilities + Day Coverage + Call Coverage sheets → union of
//     credentialed locations per provider → ProviderLocation rows. These
//     sheets DO use a customer-internal Initials code as the key, which is
//     bridged back to the Staff record's Initials field.
// See Task #18 for the design.

const MULTI_HEADER_SYNONYMS = {
  // First column header varies across sheets within ONE workbook: Staff sheet
  // uses "Name", Payroll uses "Staff" (which still contains the name string).
  // Treat both as name synonyms.
  name: ['name', 'fullname', 'providername', 'staff'],
  initials: ['initials', 'rostercode', 'code'],
  email: ['email', 'snapaccountemail'],
  mobile: ['mobile', 'phone', 'phonenumber'],
  role: ['role', 'type', 'specialty', 'providertype'],
  employment: ['employment', 'employmentcategory', 'employmenttype'],
  baseHrs: ['basehrs', 'basehours', 'ftehours', 'hoursperweek'],
  hrRate: ['hrrate', 'hourly', 'hourlyrate', 'rate', 'perhour'],
  payrollId: ['payrollid', 'payroll'],
};

/**
 * Build a name fingerprint from a raw name string.
 * Handles both "First Last" and "Last, First" formats.
 * Returns lowercase first-initial + last-name, alphanumeric only.
 *
 * Example: "Jane Smith" → "jsmith", "Smith, Jane" → "jsmith"
 *
 * Returns null if the string can't be parsed into first+last.
 */
function buildNameKey(rawName) {
  if (!rawName) return null;
  const s = String(rawName).trim();
  let firstName, lastName;
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim());
    lastName = parts[0];
    firstName = parts[1] || '';
  } else {
    const parts = s.split(/\s+/);
    if (parts.length < 2) return null;
    firstName = parts[0];
    lastName = parts[parts.length - 1];
  }
  if (!firstName || !lastName) return null;
  return (firstName[0] + lastName).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalize a "Last, First" or "First Last" name to display format "First Last".
 */
function normalizeDisplayName(rawName) {
  if (!rawName) return null;
  const s = String(rawName).trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((p) => p.trim());
    return [first, last].filter(Boolean).join(' ');
  }
  return s;
}

function buildMultiHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((rawHeader, idx) => {
    const normalized = normalizeHeader(rawHeader);
    for (const [canonical, synonyms] of Object.entries(MULTI_HEADER_SYNONYMS)) {
      if (synonyms.includes(normalized) && map[canonical] == null) {
        map[canonical] = idx;
      }
    }
  });
  return map;
}

/**
 * Extract rows from a sheet keyed by a NAME fingerprint (first-initial +
 * last-name). Returns Map<nameKey, {requestedColumns + _rawName + _initials}>.
 *
 * Skips rows with no parseable name.
 */
function extractByNameKey(sheet, requestedColumns) {
  if (!sheet) return new Map();
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (rows.length < 2) return new Map();
  const headerMap = buildMultiHeaderMap(rows[0]);
  if (headerMap.name == null) return new Map();

  const byNameKey = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[headerMap.name];
    const key = buildNameKey(rawName);
    if (!key) continue;
    const data = {
      _rawName: rawName,
      _displayName: normalizeDisplayName(rawName),
      _initials: headerMap.initials != null ? String(row[headerMap.initials] ?? '').trim() || null : null,
    };
    for (const col of requestedColumns) {
      if (headerMap[col] != null) data[col] = row[headerMap[col]];
    }
    byNameKey.set(key, data);
  }
  return byNameKey;
}

/**
 * Extract location credentialing rows from a sheet shaped as
 * (Initials, Facility 1, Facility 2, ...) where each non-empty cell is a
 * facility name the provider is credentialed at.
 *
 * Returns Map<initials, Set<facilityName>>.
 */
function extractLocationsByInitials(sheet) {
  if (!sheet) return new Map();
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  if (rows.length < 2) return new Map();
  // First column must be Initials (or a synonym)
  if (!MULTI_HEADER_SYNONYMS.initials.includes(normalizeHeader(rows[0][0]))) return new Map();

  const byInitials = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const initials = String(row[0] ?? '').trim();
    if (!initials) continue;
    const locations = new Set();
    for (let j = 1; j < row.length; j++) {
      const val = row[j];
      if (val == null || val === '') continue;
      const trimmed = String(val).trim();
      if (trimmed) locations.add(trimmed);
    }
    if (locations.size > 0) byInitials.set(initials, locations);
  }
  return byInitials;
}

/**
 * Multi-sheet upload handler. Runs only when the workbook has Staff + Payroll
 * sheets. Replaces the single-sheet flat-CSV path for CAPA-style files.
 *
 * Join strategy:
 *   - Staff sheet keyed by NAME fingerprint (first-initial + last-name)
 *   - Payroll sheet keyed by NAME fingerprint (same)
 *   - Location sheets keyed by INITIALS (their internal customer code) →
 *     bridged to a Staff record via the Staff record's Initials column
 */
async function handleMultiSheetUpload(workbook, req, res) {
  const staffByName = extractByNameKey(workbook.Sheets['Staff'], ['email', 'mobile']);
  const payrollByName = extractByNameKey(workbook.Sheets['Payroll'], [
    'role', 'employment', 'baseHrs', 'hrRate', 'payrollId',
  ]);

  // Union of all NAME keys seen across Staff + Payroll
  const allNameKeys = new Set([...staffByName.keys(), ...payrollByName.keys()]);

  // Location data — keyed by Initials (the location sheets use customer's
  // internal code). Bridge back to staff via the Staff record's Initials field.
  const locationSheets = ['Facilities', 'Day Coverage', 'Call Coverage'];
  const locationsByInitials = new Map(); // initials → Set<facilityName>
  for (const sheetName of locationSheets) {
    const lm = extractLocationsByInitials(workbook.Sheets[sheetName]);
    for (const [initials, locations] of lm.entries()) {
      if (!locationsByInitials.has(initials)) locationsByInitials.set(initials, new Set());
      for (const loc of locations) locationsByInitials.get(initials).add(loc);
    }
  }

  const created = [];
  const errors = [];
  const needsNpiReview = [];
  let matchedToProfiles = 0;
  let totalLocationsCreated = 0;

  for (const nameKey of allNameKeys) {
    const staff = staffByName.get(nameKey) || {};
    const payroll = payrollByName.get(nameKey) || {};

    // Display name: Staff sheet preferred (has the canonical contact-info row);
    // fall back to Payroll's name if provider only appears in payroll.
    const name = staff._displayName || payroll._displayName || null;
    if (!name) { errors.push({ nameKey, error: 'No parseable name in Staff or Payroll sheet' }); continue; }

    const type = normalizeSpecialty(payroll.role);
    const employment = normalizeEmployment(payroll.employment);
    if (!type) { errors.push({ nameKey, name, error: `Unknown role: "${payroll.role}"` }); continue; }
    if (!employment) { errors.push({ nameKey, name, error: `Unknown employment: "${payroll.employment}"` }); continue; }

    const email = String(staff.email ?? '').trim().toLowerCase() || null;
    const phone = String(staff.mobile ?? '').trim() || null;
    const hourlyRate = parseNumber(payroll.hrRate);
    const fteHours = parseNumber(payroll.baseHrs);
    const payrollSystemId = String(payroll.payrollId ?? '').trim() || null;
    // Use Staff's Initials for the rosterCode (customer-internal short code)
    // and to bridge to the location sheets. Falls back to Payroll's Initials
    // if Staff is missing it.
    const rosterCode = staff._initials || payroll._initials || null;

    // NPI resolution via NPPES (CAPA-style files lack NPI directly)
    let npi = null;
    let npiLookupStatus = null;
    let npiLookupCandidates = null;
    const npiResult = await resolveNpi({ name, state: 'MA' });
    if (npiResult.decision === 'AUTO_MATCHED') {
      npi = npiResult.npi;
    } else {
      // NEEDS_DISAMBIGUATION | NO_MATCH | INVALID_NAME — store for the
      // disambiguation UI to surface to the coordinator post-import.
      npiLookupStatus = npiResult.decision;
      npiLookupCandidates = npiResult.matches.length > 0 ? npiResult.matches : null;
      needsNpiReview.push({
        nameKey,
        name,
        decision: npiResult.decision,
        candidates: npiResult.matches,
      });
    }

    // Try linking to existing ProviderProfile (NPI first, email fallback)
    let linkedProviderId = null;
    let snapAccountLinked = false;
    if (npi) {
      const profile = await prisma.providerProfile.findUnique({
        where: { npiNumber: npi },
      }).catch(() => null);
      if (profile) {
        linkedProviderId = profile.id;
        snapAccountLinked = true;
        matchedToProfiles += 1;
      }
    } else if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { providerProfile: true },
      }).catch(() => null);
      if (user?.providerProfile) {
        linkedProviderId = user.providerProfile.id;
        snapAccountLinked = true;
        matchedToProfiles += 1;
      }
    }

    try {
      const entry = await prisma.internalRosterEntry.create({
        data: {
          facilityId: req.facility.id,
          providerName: name,
          providerType: type,
          employmentCategory: employment,
          npi,
          rosterCode,
          payrollSystemId,
          npiLookupStatus,
          npiLookupCandidates,
          snapAccountEmail: email,
          phoneNumber: phone,
          hourlyRate,
          fteHours,
          snapAccountLinked,
          linkedProviderId,
        },
      });
      created.push({ id: entry.id, nameKey, name, rosterCode, linkedProfile: snapAccountLinked, npi });

      // Write ProviderLocation rows. Look up the location set by the Staff
      // record's Initials code (the bridge from name-keyed Staff to
      // initials-keyed location sheets).
      const locations = rosterCode ? locationsByInitials.get(rosterCode) : null;
      if (locations && locations.size > 0) {
        await prisma.providerLocation.createMany({
          data: [...locations].map((facilityName) => ({
            rosterEntryId: entry.id,
            facilityName,
          })),
          skipDuplicates: true,
        });
        totalLocationsCreated += locations.size;
      }
    } catch (err) {
      errors.push({ nameKey, name, error: err.message });
    }
  }

  if (created.length > 0) {
    logAutomationEvent({
      facilityId: req.facility.id,
      type: 'ROSTER_UPLOAD',
      metadata: {
        rowsCreated: created.length,
        matchedToProfiles,
        errors: errors.length,
        locationsCreated: totalLocationsCreated,
        needsNpiReview: needsNpiReview.length,
        multiSheet: true,
      },
    });
  }

  return res.status(201).json({
    summary: {
      created: created.length,
      matchedToProfiles,
      errors: errors.length,
      totalProviders: allNameKeys.size,
      locationsCreated: totalLocationsCreated,
      needsNpiReview: needsNpiReview.length,
      multiSheet: true,
    },
    created,
    errors,
    needsNpiReview,
  });
}

/**
 * POST /upload — parse a CSV/XLSX, create roster entries, link by NPI.
 *
 * Two paths:
 *   1. Multi-sheet (CAPA-style) — workbook has Staff + Payroll sheets.
 *      Runs handleMultiSheetUpload above (joins by Initials, NPPES lookup,
 *      reads Facilities + Coverage sheets for ProviderLocation rows).
 *   2. Single-sheet (flat CSV/XLSX) — original behavior.
 */
router.post('/upload', facilityAuth, rosterUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });

    // Multi-sheet detection: file has Staff + Payroll sheets
    if (workbook.SheetNames.includes('Staff') && workbook.SheetNames.includes('Payroll')) {
      return handleMultiSheetUpload(workbook, req, res);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return res.status(400).json({ error: 'Workbook has no sheets.' });

    // header: 1 → arrays-of-arrays so we can re-map columns
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (rows.length < 2) {
      return res.status(400).json({ error: 'File must have a header row + at least one data row.' });
    }

    const headerMap = buildHeaderMap(rows[0]);
    if (headerMap.name == null || headerMap.type == null || headerMap.employment == null) {
      return res.status(400).json({
        error:
          'Header row must include name, type (specialty), and employment. Found columns: ' +
          rows[0].join(', '),
      });
    }

    const dataRows = rows.slice(1);
    const created = [];
    const errors = [];
    let matchedToProfiles = 0;
    let skipped = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // human-readable, header is row 1
      const get = (key) => (headerMap[key] != null ? row[headerMap[key]] : null);

      const name = String(get('name') || '').trim();
      if (!name) { skipped += 1; continue; } // blank row, skip silently

      const type = normalizeSpecialty(get('type'));
      const employment = normalizeEmployment(get('employment'));
      if (!type) {
        errors.push({ row: rowNum, name, error: `Unknown specialty: "${get('type')}"` });
        continue;
      }
      if (!employment) {
        errors.push({ row: rowNum, name, error: `Unknown employment type: "${get('employment')}"` });
        continue;
      }

      const npi = String(get('npi') || '').trim() || null;
      const email = String(get('email') || '').trim().toLowerCase() || null;
      const phone = String(get('phone') || '').trim() || null;
      const licenseNumber = String(get('license_number') || '').trim() || null;
      const licenseExp = parseDate(get('license_expiration'));
      const hourlyRate = parseNumber(get('hourly_rate'));
      const annualRate = parseNumber(get('annual_rate'));
      const fteHours = parseNumber(get('fte_hours'));

      // Try to match an existing provider profile by NPI first, then email.
      let linkedProviderId = null;
      let snapAccountLinked = false;
      if (npi) {
        const profile = await prisma.providerProfile.findUnique({ where: { npiNumber: npi } });
        if (profile) {
          linkedProviderId = profile.id;
          snapAccountLinked = true;
          matchedToProfiles += 1;
        }
      } else if (email) {
        const user = await prisma.user.findUnique({ where: { email }, include: { providerProfile: true } });
        if (user?.providerProfile) {
          linkedProviderId = user.providerProfile.id;
          snapAccountLinked = true;
          matchedToProfiles += 1;
        }
      }

      try {
        const entry = await prisma.internalRosterEntry.create({
          data: {
            facilityId: req.facility.id,
            providerName: name,
            providerType: type,
            employmentCategory: employment,
            npi,
            snapAccountEmail: email,
            phoneNumber: phone,
            licenseNumber,
            licenseExpiration: licenseExp,
            hourlyRate,
            annualRate,
            fteHours,
            snapAccountLinked,
            linkedProviderId,
          },
        });
        created.push({ id: entry.id, row: rowNum, name, linkedProfile: snapAccountLinked });
      } catch (err) {
        errors.push({ row: rowNum, name, error: err.message });
      }
    }

    // Time-savings tracking — only count uploads that actually saved rows.
    // Fire-and-forget: helper never throws.
    if (created.length > 0) {
      logAutomationEvent({
        facilityId: req.facility.id,
        type: 'ROSTER_UPLOAD',
        metadata: {
          rowsCreated: created.length,
          matchedToProfiles,
          errors: errors.length,
        },
      });
    }

    res.status(201).json({
      summary: {
        created: created.length,
        matchedToProfiles,
        errors: errors.length,
        skipped,
        totalDataRows: dataRows.length,
      },
      created,
      errors,
    });
  } catch (err) {
    console.error('[roster] upload failed:', err);
    if (err.message?.includes('Only .csv')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (5MB max).' });
    }
    res.status(500).json({ error: 'Failed to import roster.' });
  }
});

/**
 * GET /upload/template — download a blank CSV template with the right
 * headers so coordinators have a known-good starting point.
 */
router.get('/upload/template', facilityAuth, (req, res) => {
  const headers = [
    'name', 'type', 'employment',
    'npi', 'email', 'phone',
    'license_number', 'license_expiration',
    'hourly_rate', 'annual_rate', 'fte_hours',
  ];
  const example = [
    'Dr. Jane Smith', 'ANESTHESIOLOGIST', 'FULL_TIME',
    '1234567890', 'jsmith@example.com', '555-867-5309',
    'MA-12345', '2027-08-15',
    '', '350000', '40',
  ];
  const csv = headers.join(',') + '\n' + example.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="snap-roster-template.csv"');
  res.send(csv);
});

module.exports = router;
