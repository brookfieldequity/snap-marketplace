const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { logAutomationEvent } = require('../services/automationEvents');

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

/**
 * POST /upload — parse a CSV/XLSX, create roster entries, link by NPI.
 *
 * Returns { created, skipped, errors, matchedToProfiles, rows: [{ ... }] }
 * — UI can show a summary toast + a per-row breakdown.
 */
router.post('/upload', facilityAuth, rosterUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
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
