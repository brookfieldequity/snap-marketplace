const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { logAutomationEvent } = require('../services/automationEvents');
const { resolveNpi, resolveNpiByLastName, lookupByNumber, specialtyFromTaxonomy, searchByName, splitName: splitNppesName } = require('../services/nppesLookup');
const passportClient = require('../services/passportClient');
const { sendProviderInvitation } = require('../services/credentialEmail');
const { sendSMS, sendEmail } = require('../services/notifications');
const { reverseLinkAllOrphans, linkOneRosterEntryIfMatched } = require('../services/rosterLink');
const ptoService = require('../services/pto');
const { applyRosterRateLens, lensRosterEntry } = require('../services/rosterLens');
const { importAllInRates, importPayrollRates } = require('../services/hourEntry');

const router = express.Router();

// Where the provider lands to claim a credentialing invite. Served by the cred
// backend at GET /claim (same-origin with its /api/auth/register, which accepts
// the `claimToken` this link carries). Env-driven so it can move to a branded
// domain without a code change.
const CRED_CLAIM_URL =
  process.env.CRED_CLAIM_URL ||
  'https://snap-credentialing-backend-production.up.railway.app/claim';

// Best-effort split of a single "providerName" into first/last for the passport
// pre-seed. The provider can correct it during credentialing; this is only a
// convenience so their claim screen isn't blank.
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Fire a credentialing invite for ONE roster entry: mint a passport stub +
 * claim token on the cred backend, then deliver the claim link by email/SMS.
 *
 * Never throws on a per-entry problem — returns { ok:false, reason } so a bulk
 * invite can continue past a bad row. Updates the entry's credentialingStatus.
 */
async function sendCredentialingInvite(entry, facility) {
  const name = entry.providerName || 'Provider';
  if (!entry.npi) {
    return { id: entry.id, name, ok: false, reason: 'No NPI on file' };
  }
  const email = entry.snapAccountEmail;
  const phone = entry.phoneNumber;
  if (!email && !phone) {
    return { id: entry.id, name, ok: false, reason: 'No email or phone on file' };
  }

  const { firstName, lastName } = splitName(entry.providerName);

  let result;
  try {
    result = await passportClient.invite(entry.npi, facility.id, {
      facilityName: facility.name,
      firstName,
      lastName,
    });
  } catch (err) {
    return { id: entry.id, name, ok: false, reason: err.message || 'Passport bridge error' };
  }

  const delivered = [];
  let status = 'INVITED';

  if (result.mode === 'INVITE_CREATED') {
    const claimLink = `${CRED_CLAIM_URL}?token=${result.claimToken}`;
    if (email) {
      await sendProviderInvitation(email, name, facility.name, claimLink);
      delivered.push('email');
    }
    if (phone) {
      await sendSMS(
        phone,
        `${facility.name} invited you to complete your SNAP credentialing passport. Get started: ${claimLink}`
      );
      delivered.push('sms');
    }
  } else if (result.mode === 'EXISTING_PROVIDER') {
    // Already has a passport — cred backend pushed an access request to their
    // app. No claim link to deliver.
    delivered.push('push');
  } else if (result.mode === 'ALREADY_GRANTED') {
    status = 'CLAIMED';
  }

  const linkFields = await resolveLinkFields({ npi: entry.npi, email: entry.snapAccountEmail });
  await prisma.internalRosterEntry.update({
    where: { id: entry.id },
    data: { inviteSentAt: new Date(), credentialingStatus: status, ...linkFields },
  });

  // Diagnostic: an INVITE_CREATED is the only mode that emails a claim link.
  // EXISTING_PROVIDER / ALREADY_GRANTED send a push / nothing (provider already
  // has a passport) — which is why an invite can "succeed" with no email.
  console.log(`[credentialing-invite] mode=${result.mode} delivered=${delivered.join('+') || 'none'} status=${status} npi=${entry.npi}`);

  return { id: entry.id, name, ok: true, mode: result.mode, status, delivered };
}

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
// Look up a matching ProviderProfile by NPI first, email second. Used in
// the manual create/edit + sync paths so a coordinator typing an NPI or
// email links the row in real time. Pulls from the shared rosterLink
// helper so a single matching rule covers every create/edit/import path.
async function resolveLinkFields(emailOrFields) {
  // Backwards-compat: callers that pass a bare email string still work.
  const npi = typeof emailOrFields === 'object' ? emailOrFields?.npi : null;
  const email = typeof emailOrFields === 'object' ? emailOrFields?.email : emailOrFields;
  const { findProviderForRosterEntry } = require('../services/rosterLink');
  const providerId = await findProviderForRosterEntry({ npi, email });
  if (providerId) {
    return { snapAccountLinked: true, linkedProviderId: providerId };
  }
  return { snapAccountLinked: false, linkedProviderId: null };
}

// Normalize a { facilityName, shiftSharePct } from the client into a
// ProviderLocation create row (rosterEntryId comes from the nested write).
function toProviderLocation(l) {
  return {
    facilityName: l.facilityName,
    shiftSharePct: l && l.shiftSharePct != null && l.shiftSharePct !== '' ? Number(l.shiftSharePct) : null,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET / — list all roster entries for the facility
router.get('/', facilityAuth, async (req, res) => {
  try {
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      include: {
        locations: { select: { facilityName: true, shiftSharePct: true } },
        // employerRef drives the EOR rate firewall — see services/rosterLens.js
        employerRef: { select: { name: true, kind: true, ownerFacilityId: true } },
      },
      orderBy: { providerName: 'asc' },
    });
    // Strip agency payroll rates the viewing facility isn't entitled to see.
    res.json(applyRosterRateLens(entries, req.facility.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /import-all-in-rates — bulk-set each roster card's all-in (CAPA) rate
// from an uploaded sheet (name/business + a "CAPA rate" column). Matches
// existing cards by business name / name fingerprint; update-only.
router.post('/import-all-in-rates', facilityAuth, rosterUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const result = await importAllInRates({ facilityId: req.facility.id, buffer: req.file.buffer });
    res.json(result);
  } catch (err) {
    console.error('[roster/import-all-in-rates]', err.message);
    res.status(400).json({ error: err.message || 'Failed to import all-in rates.' });
  }
});

// POST /import-pay-rates — bulk-set each roster card's payroll PAY rate
// (hourlyRate) from an uploaded sheet (name/business + a "rate" column).
// Update-only: unrecognized providers are skipped (not added) and reported.
router.post('/import-pay-rates', facilityAuth, rosterUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const result = await importPayrollRates({ facilityId: req.facility.id, buffer: req.file.buffer });
    res.json(result);
  } catch (err) {
    console.error('[roster/import-pay-rates]', err.message);
    res.status(400).json({ error: err.message || 'Failed to import pay rates.' });
  }
});

// GET /pto-summary?year=YYYY — per-roster-entry PTO counter for the year.
// Returns { year, asOf, summary: { [rosterEntryId]: { annual, granted, used,
// eligible } } }. "granted"/"used" are derived weekday counts from source='PTO'
// rows (see services/pto.js); "annual" is the override or the system default.
router.get('/pto-summary', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getUTCFullYear();
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      select: { id: true, ptoDaysAnnual: true, ptoEligible: true, is1099: true, isFullTime: true, employmentCategory: true },
    });
    const asOf = new Date();
    const map = await ptoService.summarizeYear({ facilityId: req.facility.id, entries, year, asOf });
    const summary = {};
    for (const e of entries) {
      const s = map.get(e.id) || { annual: ptoService.annualAllotment(e), granted: 0, used: 0 };
      summary[e.id] = { ...s, eligible: ptoService.isPtoEligible(e) };
    }
    res.json({ year, asOf: asOf.toISOString(), summary });
  } catch (err) {
    console.error('[roster/pto-summary] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /locations — the sites this facility covers, taken from the COVERAGE
// TEMPLATES only (the coordinator's curated, canonical site list). Powers the
// credentialed-sites checklist on the provider form. Deliberately excludes
// raw provider-import location rows + schedule-day strings, which carry messy
// coded variants ("BOSS (G)", "Natick (90%)", trailing spaces).
router.get('/locations', facilityAuth, async (req, res) => {
  try {
    const tmplDays = await prisma.coverageTemplateDay.findMany({
      where: { template: { facilityId: req.facility.id } },
      select: { location: true },
      distinct: ['location'],
    });
    const set = new Set();
    tmplDays.forEach((r) => r.location && set.add(r.location.trim()));
    res.json({ locations: [...set].sort((a, b) => a.localeCompare(b)) });
  } catch (err) {
    console.error('[roster/locations] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a roster entry
router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      providerName, providerType, employmentCategory, npi,
      snapAccountEmail, phoneNumber, licenseNumber, licenseExpiration, notes,
      fteHours, annualRate, hourlyRate, allInCostPerHour, preferredShiftLength,
      preferredDays, locationRankings, maxShiftsPerMonth,
      contractStart, contractEnd, locations,
      employer, is1099, isFullTime, placementTier,
      businessName, useBusinessNameForPayroll, payeeType, ein,
      dualEmployment, w2Employer, contractorEmployer, contractorPayRate,
    } = req.body;

    const linkFields = await resolveLinkFields({ npi, email: snapAccountEmail });
    // "Staff" is a UI label for a non-clinical / back-office roster member.
    // Map it to the existing non-clinical flags (scheduling + credentialing
    // already exclude these) rather than to the anesthesia-only Specialty enum.
    const isStaff = providerType === 'STAFF';

    const entry = await prisma.internalRosterEntry.create({
      data: {
        facilityId: req.facility.id,
        providerName,
        providerType: isStaff ? null : providerType,
        isNonClinical: isStaff,
        npiExempt: isStaff,
        employmentCategory,
        npi: npi ? String(npi).replace(/\D/g, '') || null : null,
        snapAccountEmail: snapAccountEmail || null,
        phoneNumber: phoneNumber || null,
        licenseNumber: licenseNumber || null,
        licenseExpiration: licenseExpiration ? new Date(licenseExpiration) : null,
        notes: notes || null,
        fteHours: fteHours != null ? parseFloat(fteHours) : null,
        annualRate: annualRate != null ? parseFloat(annualRate) : null,
        hourlyRate: hourlyRate != null ? parseFloat(hourlyRate) : null,
        allInCostPerHour: allInCostPerHour != null ? parseFloat(allInCostPerHour) : null,
        preferredShiftLength: preferredShiftLength || null,
        preferredDays: preferredDays ?? null,
        locationRankings: locationRankings ?? null,
        maxShiftsPerMonth: maxShiftsPerMonth != null ? parseInt(maxShiftsPerMonth) : null,
        contractStart: contractStart ? new Date(contractStart) : null,
        contractEnd: contractEnd ? new Date(contractEnd) : null,
        employer: employer || null,
        employerId: req.body.employerId || null, // employer-of-record (EOR firewall)
        is1099: typeof is1099 === 'boolean' ? is1099 : null,
        isFullTime: typeof isFullTime === 'boolean' ? isFullTime : null,
        placementTier: placementTier != null && placementTier !== '' ? parseInt(placementTier) : null,
        businessName: businessName || null,
        useBusinessNameForPayroll: useBusinessNameForPayroll === true,
        payeeType: payeeType || null,
        ein: ein || null,
        dualEmployment: dualEmployment === true,
        w2Employer: w2Employer || null,
        contractorEmployer: contractorEmployer || null,
        contractorPayRate: contractorPayRate != null && contractorPayRate !== '' ? parseFloat(contractorPayRate) : null,
        ...linkFields,
        ...(Array.isArray(locations)
          ? { locations: { create: locations.filter((l) => l && l.facilityName).map(toProviderLocation) } }
          : {}),
      },
      include: { employerRef: { select: { name: true, kind: true, ownerFacilityId: true } } },
    });

    res.status(201).json(lensRosterEntry(entry, req.facility.id));
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
      providerName, providerType, employmentCategory, npi,
      snapAccountEmail, phoneNumber, licenseNumber, licenseExpiration, notes,
      fteHours, annualRate, hourlyRate, allInCostPerHour, preferredShiftLength,
      preferredDays, locationRankings, maxShiftsPerMonth,
      contractStart, contractEnd, locations,
      employer, is1099, isFullTime, placementTier,
      businessName, useBusinessNameForPayroll, payeeType, ein,
      dualEmployment, w2Employer, contractorEmployer, contractorPayRate,
      scheduleAccessRevoked,
      ptoDaysAnnual, ptoEligible, seniorityRank, adminQualityScore,
    } = req.body;

    // Re-check linkage if email OR NPI is being changed. Either change
    // can newly match an existing ProviderProfile, so a coordinator
    // correcting a typo on a roster row can stitch the provider live.
    let linkFields = {};
    if (snapAccountEmail !== undefined || npi !== undefined) {
      const effectiveNpi = npi !== undefined
        ? (npi ? String(npi).replace(/\D/g, '') || null : null)
        : existing.npi;
      const effectiveEmail = snapAccountEmail !== undefined ? snapAccountEmail : existing.snapAccountEmail;
      linkFields = await resolveLinkFields({ npi: effectiveNpi, email: effectiveEmail });
    }

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: {
        ...(providerName !== undefined && { providerName }),
        ...(providerType !== undefined && (providerType === 'STAFF'
          ? { providerType: null, isNonClinical: true, npiExempt: true }
          : { providerType, isNonClinical: false, npiExempt: false })),
        ...(employmentCategory !== undefined && { employmentCategory }),
        ...(npi !== undefined && { npi: npi ? String(npi).replace(/\D/g, '') || null : null }),
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
        ...(allInCostPerHour !== undefined && { allInCostPerHour: allInCostPerHour != null ? parseFloat(allInCostPerHour) : null }),
        ...(preferredShiftLength !== undefined && { preferredShiftLength }),
        ...(preferredDays !== undefined && { preferredDays }),
        ...(locationRankings !== undefined && { locationRankings }),
        ...(maxShiftsPerMonth !== undefined && { maxShiftsPerMonth: maxShiftsPerMonth != null ? parseInt(maxShiftsPerMonth) : null }),
        ...(contractStart !== undefined && { contractStart: contractStart ? new Date(contractStart) : null }),
        ...(contractEnd !== undefined && { contractEnd: contractEnd ? new Date(contractEnd) : null }),
        ...(employer !== undefined && { employer: employer || null }),
        ...(req.body.employerId !== undefined && { employerId: req.body.employerId || null }),
        ...(is1099 !== undefined && { is1099: typeof is1099 === 'boolean' ? is1099 : null }),
        ...(isFullTime !== undefined && { isFullTime: typeof isFullTime === 'boolean' ? isFullTime : null }),
        ...(placementTier !== undefined && { placementTier: placementTier != null && placementTier !== '' ? parseInt(placementTier) : null }),
        ...(businessName !== undefined && { businessName: businessName || null }),
        ...(useBusinessNameForPayroll !== undefined && { useBusinessNameForPayroll: useBusinessNameForPayroll === true }),
        ...(payeeType !== undefined && { payeeType: payeeType || null }),
        ...(ein !== undefined && { ein: ein || null }),
        ...(dualEmployment !== undefined && { dualEmployment: dualEmployment === true }),
        ...(w2Employer !== undefined && { w2Employer: w2Employer || null }),
        ...(contractorEmployer !== undefined && { contractorEmployer: contractorEmployer || null }),
        ...(contractorPayRate !== undefined && { contractorPayRate: contractorPayRate != null && contractorPayRate !== '' ? parseFloat(contractorPayRate) : null }),
        ...(scheduleAccessRevoked !== undefined && {
          scheduleAccessRevoked: scheduleAccessRevoked === true,
          // Granting (revoked → false) clears any pending access request.
          ...(scheduleAccessRevoked === false ? { scheduleAccessRequested: false } : {}),
        }),
        ...(ptoDaysAnnual !== undefined && { ptoDaysAnnual: ptoDaysAnnual != null && ptoDaysAnnual !== '' ? parseInt(ptoDaysAnnual) : null }),
        ...(ptoEligible !== undefined && { ptoEligible: typeof ptoEligible === 'boolean' ? ptoEligible : null }),
        ...(seniorityRank !== undefined && { seniorityRank: seniorityRank != null && seniorityRank !== '' ? parseInt(seniorityRank) : null }),
        ...(adminQualityScore !== undefined && { adminQualityScore: adminQualityScore != null && adminQualityScore !== '' ? Math.min(5, Math.max(1, parseInt(adminQualityScore))) : null }),
        ...linkFields,
        ...(Array.isArray(locations)
          ? { locations: { deleteMany: {}, create: locations.filter((l) => l && l.facilityName).map(toProviderLocation) } }
          : {}),
      },
      include: { employerRef: { select: { name: true, kind: true, ownerFacilityId: true } } },
    });

    res.json(lensRosterEntry(updated, req.facility.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Time off / PTO ───────────────────────────────────────────────────────────

/**
 * GET /time-off?from=YYYY-MM-DD&to=YYYY-MM-DD — all time-off entries for the
 * facility's roster that overlap the window (defaults to no bound). Used by
 * the schedule editor to gray out providers and by the roster UI to list
 * each provider's upcoming time off.
 */
router.get('/time-off', facilityAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = { facilityId: req.facility.id };
    // Overlap test: entry.endDate >= from AND entry.startDate <= to
    if (from) where.endDate = { gte: new Date(from) };
    if (to) where.startDate = { lte: new Date(to) };
    const rows = await prisma.rosterTimeOff.findMany({
      where,
      orderBy: { startDate: 'asc' },
      select: { id: true, rosterEntryId: true, startDate: true, endDate: true, reason: true },
    });
    res.json({ timeOff: rows });
  } catch (err) {
    console.error('[roster] time-off list failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:id/time-off — add a time-off range for one roster member.
 * Body: { startDate, endDate, reason? } (endDate defaults to startDate for a
 * single day). Dates inclusive.
 */
router.post('/:id/time-off', facilityAuth, async (req, res) => {
  try {
    const entry = await prisma.internalRosterEntry.findUnique({ where: { id: req.params.id } });
    if (!entry || entry.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Roster member not found.' });
    }
    const { startDate, endDate, reason } = req.body || {};
    if (!startDate) return res.status(400).json({ error: 'startDate is required.' });
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : start;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date.' });
    }
    if (end < start) return res.status(400).json({ error: 'endDate must be on or after startDate.' });
    const created = await prisma.rosterTimeOff.create({
      data: {
        rosterEntryId: entry.id,
        facilityId: req.facility.id,
        startDate: start,
        endDate: end,
        reason: reason || null,
      },
      select: { id: true, rosterEntryId: true, startDate: true, endDate: true, reason: true },
    });
    res.status(201).json({ timeOff: created });
  } catch (err) {
    console.error('[roster] time-off create failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /time-off/:timeOffId — remove a time-off entry.
 */
router.delete('/time-off/:timeOffId', facilityAuth, async (req, res) => {
  try {
    const row = await prisma.rosterTimeOff.findUnique({ where: { id: req.params.timeOffId } });
    if (!row || row.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Time-off entry not found.' });
    }
    await prisma.rosterTimeOff.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[roster] time-off delete failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── NPI disambiguation (review queue from multi-sheet imports) ───────────────

/**
 * GET /npi-review — roster entries that need coordinator NPI resolution.
 *
 * These are rows where NPPES auto-resolution couldn't pick a single match
 * (multiple candidates, no match, or unparseable name) AND the row hasn't
 * been marked NPI-exempt. Non-clinical staff and exempted rows are excluded.
 *
 * Returns each row with its stored candidates so the UI can render the
 * disambiguation cards without re-querying NPPES.
 */
router.get('/npi-review', facilityAuth, async (req, res) => {
  try {
    const rows = await prisma.internalRosterEntry.findMany({
      where: {
        facilityId: req.facility.id,
        npi: null,
        npiExempt: false,
        npiLookupStatus: { not: null },
      },
      select: {
        id: true,
        providerName: true,
        providerType: true,
        npiLookupStatus: true,
        npiLookupCandidates: true,
        rosterCode: true,
      },
      orderBy: { providerName: 'asc' },
    });
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error('[roster] npi-review failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:id/resolve-npi — coordinator resolves one review-queue row.
 *
 * Body (one of):
 *   { npi: "1234567890" }  — set the chosen NPI; clears the lookup flag
 *   { exempt: true }       — mark NPI-exempt (back-office, handle out of band)
 *
 * Either action removes the row from the review queue.
 */
router.post('/:id/resolve-npi', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { npi, exempt } = req.body || {};

    if (exempt === true) {
      const updated = await prisma.internalRosterEntry.update({
        where: { id: req.params.id },
        data: { npiExempt: true, npiLookupStatus: null, npiLookupCandidates: null },
      });
      return res.json(updated);
    }

    if (npi) {
      const cleaned = String(npi).replace(/\D/g, '');
      if (cleaned.length !== 10) {
        return res.status(400).json({ error: 'NPI must be 10 digits.' });
      }
      // Try to link to an existing ProviderProfile by this NPI.
      const profile = await prisma.providerProfile
        .findUnique({ where: { npiNumber: cleaned } })
        .catch(() => null);

      // Name upgrade: QGenda imports store a last-name-only placeholder. When the
      // coordinator picks an NPI, fill in the full name — from an explicit body
      // `name`, else from the chosen candidate in the stored lookup list — but
      // only when the current name has no space (i.e. is a last-name placeholder).
      const nameUpdate = {};
      const bodyName = req.body && req.body.name ? String(req.body.name).trim() : '';
      const curIsPlaceholder = !String(existing.providerName || '').trim().includes(' ');
      if (bodyName) {
        nameUpdate.providerName = bodyName;
      } else if (curIsPlaceholder) {
        const cands = Array.isArray(existing.npiLookupCandidates) ? existing.npiLookupCandidates : [];
        const chosen = cands.find((c) => String(c.npi) === cleaned);
        const full = chosen ? [chosen.firstName, chosen.lastName].filter(Boolean).join(' ') : '';
        if (full) nameUpdate.providerName = full;
      }

      const updated = await prisma.internalRosterEntry.update({
        where: { id: req.params.id },
        data: {
          npi: cleaned,
          npiLookupStatus: null,
          npiLookupCandidates: null,
          ...nameUpdate,
          ...(profile ? { snapAccountLinked: true, linkedProviderId: profile.id } : {}),
        },
      });
      return res.json(updated);
    }

    res.status(400).json({ error: 'Provide either { npi } or { exempt: true }.' });
  } catch (err) {
    console.error('[roster] resolve-npi failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /npi-search?name=Jane%20Smith&state=MA — re-run an NPPES lookup with a
 * coordinator-corrected name. Used by the "search again" affordance on
 * no-match cards (the file's name often differs from NPPES — maiden names,
 * nicknames, middle names). Returns candidate matches; does NOT write
 * anything — the coordinator picks one and POSTs to /:id/resolve-npi.
 */
router.get('/npi-search', facilityAuth, async (req, res) => {
  try {
    const { name, state } = req.query;
    if (!name) return res.status(400).json({ error: 'name query param is required.' });
    const result = await resolveNpi({ name: String(name), state: state ? String(state) : 'MA' });
    res.json(result);
  } catch (err) {
    console.error('[roster] npi-search failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /clear-all — nuke the entire internal roster for the calling facility.
// Dress-rehearsal / fresh-upload helper: deletes every InternalRosterEntry,
// cascades RosterTimeOff + ProviderLocation, nulls out ScheduleAssignment
// rosterId (preserves the day shells so the coordinator's calendar layout
// survives), and deletes ScheduleFeedback + IncentiveShiftResponses tied to
// the wiped providers.
//
// Guarded by a confirmation phrase in the body — the UI must echo back
// `confirm: "DELETE ALL"` so this can't fire from a stray POST. Returns
// counts so the coordinator sees what was removed.
router.post('/clear-all', facilityAuth, async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE ALL') {
      return res.status(400).json({
        error: 'Confirmation phrase missing. POST { "confirm": "DELETE ALL" } to proceed.',
      });
    }
    const facilityId = req.facility.id;

    const result = await prisma.$transaction(async (tx) => {
      // Get the set of roster IDs scoped to this facility so we don't touch
      // anyone else's data on accident.
      const roster = await tx.internalRosterEntry.findMany({
        where: { facilityId },
        select: { id: true },
      });
      const rosterIds = roster.map((r) => r.id);
      if (rosterIds.length === 0) {
        return { rosterDeleted: 0, assignmentsUnassigned: 0, feedbackDeleted: 0, incentiveResponsesDeleted: 0 };
      }

      // 1. Null out schedule assignments — the schedule shell stays, rooms
      //    just become empty again so the coordinator can re-staff.
      const assignmentsUnassigned = await tx.scheduleAssignment.updateMany({
        where: { facilityId, rosterId: { in: rosterIds } },
        data: { rosterId: null },
      });

      // 2. Drop schedule feedback rows tied to these providers.
      const feedbackDeleted = await tx.scheduleFeedback.deleteMany({
        where: { facilityId, rosterId: { in: rosterIds } },
      });

      // 3. Drop incentive-shift responses tied to these providers.
      const incentiveResponsesDeleted = await tx.internalIncentiveShiftResponse.deleteMany({
        where: { rosterId: { in: rosterIds } },
      });

      // 4. Finally the roster itself — RosterTimeOff and ProviderLocation
      //    cascade automatically.
      const rosterDeleted = await tx.internalRosterEntry.deleteMany({
        where: { facilityId },
      });

      return {
        rosterDeleted: rosterDeleted.count,
        assignmentsUnassigned: assignmentsUnassigned.count,
        feedbackDeleted: feedbackDeleted.count,
        incentiveResponsesDeleted: incentiveResponsesDeleted.count,
      };
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[roster] clear-all failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bulk-delete — delete a selected subset of the roster.
// Body: { ids: ["...", "..."], confirm: "DELETE SELECTED" }
// Same cleanup as clear-all but scoped to the provided IDs (intersected with
// the facility's own roster so a malicious or stale ID can't reach cross-tenant
// data). Returns counts so the UI can confirm what was removed.
router.post('/bulk-delete', facilityAuth, async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE SELECTED') {
      return res.status(400).json({
        error: 'Confirmation phrase missing. POST { "confirm": "DELETE SELECTED", "ids": [...] } to proceed.',
      });
    }
    const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (requestedIds.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must be non-empty.' });
    }
    const facilityId = req.facility.id;

    const result = await prisma.$transaction(async (tx) => {
      // Intersect with facility-owned rows — never trust the client list.
      const owned = await tx.internalRosterEntry.findMany({
        where: { facilityId, id: { in: requestedIds } },
        select: { id: true },
      });
      const rosterIds = owned.map((r) => r.id);
      if (rosterIds.length === 0) {
        return { rosterDeleted: 0, assignmentsUnassigned: 0, feedbackDeleted: 0, incentiveResponsesDeleted: 0, requested: requestedIds.length };
      }

      const assignmentsUnassigned = await tx.scheduleAssignment.updateMany({
        where: { facilityId, rosterId: { in: rosterIds } },
        data: { rosterId: null },
      });
      const feedbackDeleted = await tx.scheduleFeedback.deleteMany({
        where: { facilityId, rosterId: { in: rosterIds } },
      });
      const incentiveResponsesDeleted = await tx.internalIncentiveShiftResponse.deleteMany({
        where: { rosterId: { in: rosterIds } },
      });
      const rosterDeleted = await tx.internalRosterEntry.deleteMany({
        where: { facilityId, id: { in: rosterIds } },
      });

      return {
        rosterDeleted: rosterDeleted.count,
        assignmentsUnassigned: assignmentsUnassigned.count,
        feedbackDeleted: feedbackDeleted.count,
        incentiveResponsesDeleted: incentiveResponsesDeleted.count,
        requested: requestedIds.length,
      };
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[roster] bulk-delete failed:', err);
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

// POST /bulk-invite — send credentialing invites to a set of roster entries.
// Body: { rosterIds: string[] }. The caller (invite modal) decides the set;
// each entry is validated (NPI + a contact method) and skipped-with-reason if
// it can't be delivered, so one bad row never blocks the rest. Nothing is sent
// until this is called — invites are never auto-fired on import.
router.post('/bulk-invite', facilityAuth, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) {
      return res.status(503).json({ error: 'Credentialing bridge is not configured.' });
    }
    const { rosterIds } = req.body || {};
    if (!Array.isArray(rosterIds) || rosterIds.length === 0) {
      return res.status(400).json({ error: 'rosterIds (non-empty array) is required.' });
    }

    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { id: true, name: true },
    });
    const entries = await prisma.internalRosterEntry.findMany({
      where: { id: { in: rosterIds }, facilityId: req.facility.id },
    });

    // Sequential on purpose: pilot rosters are small, and this gives clean
    // per-row error attribution without hammering the cred backend / SendGrid.
    const results = [];
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await sendCredentialingInvite(entry, facility));
    }

    const sent = results.filter((r) => r.ok).length;
    const skipped = results.filter((r) => !r.ok);
    res.json({ sent, skippedCount: skipped.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Marketplace-app invites ─────────────────────────────────────────────────
//
// Separate from the credentialing invite (which lives on snap-credentialing).
// This invites the provider to download the marketplace mobile app + register,
// after which the reverseLink on their auth flow ties them back to this row.
// Email always (when SendGrid is configured); SMS when Twilio is configured.

const APP_INVITE_URL = process.env.APP_INVITE_URL ||
  'https://testflight.apple.com/join/MEfbAxDX'; // SNAP app TestFlight public link

function buildAppInviteEmail(entry, facilityName) {
  const url = APP_INVITE_URL;
  const greeting = entry.providerName?.split(/\s+/)[0] || 'there';
  return {
    subject: `Join ${facilityName} on SNAP`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #0F172A;">
        <h1 style="font-size: 22px; font-weight: 800; margin: 0 0 8px;">Hi ${greeting},</h1>
        <p style="font-size: 15px; line-height: 1.55; color: #334155;">
          <strong>${facilityName}</strong> uses SNAP to manage scheduling and share your shifts with you.
        </p>
        <p style="font-size: 15px; line-height: 1.55; color: #334155;">
          Download the SNAP app and sign up using this email address —
          <strong>${entry.snapAccountEmail || '(your email)'}</strong> —
          and your shifts will automatically appear in the My Schedule tab.
          You can also subscribe to a calendar feed so shifts sync to your iPhone Calendar.
        </p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${url}" style="display: inline-block; background: #6366F1; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px;">Download SNAP</a>
        </p>
        <p style="font-size: 12px; color: #94A3B8; line-height: 1.6; margin-top: 24px;">
          If the button doesn't work, copy this link: ${url}<br/>
          Questions? Reply to this email and we'll help.
        </p>
      </div>
    `,
  };
}

function buildAppInviteSms(entry, facilityName) {
  return `${facilityName} uses SNAP to share your schedule. Download the app: ${APP_INVITE_URL} — sign up with ${entry.snapAccountEmail || 'the email on file'} so your shifts show up automatically.`;
}

async function sendAppInvite(entry, facilityName) {
  if (!entry.snapAccountEmail && !entry.phoneNumber) {
    return { ok: false, id: entry.id, name: entry.providerName, reason: 'No email or phone on file' };
  }
  // If the provider is ALREADY registered in marketplace, link them right
  // now — they don't need to wait for their next login, and the email below
  // will read as confirmation rather than a fresh sign-up ask.
  let linkedNow = false;
  if (!entry.snapAccountLinked) {
    const r = await linkOneRosterEntryIfMatched(entry.id, {
      npi: entry.npi,
      email: entry.snapAccountEmail,
    });
    if (r.linked) linkedNow = true;
  }
  const channels = [];
  if (entry.snapAccountEmail) {
    const msg = buildAppInviteEmail(entry, facilityName);
    await sendEmail(entry.snapAccountEmail, msg.subject, msg.html);
    channels.push('email');
  }
  if (entry.phoneNumber) {
    await sendSMS(entry.phoneNumber, buildAppInviteSms(entry, facilityName));
    channels.push('sms');
  }
  // Stamp the row so the UI can show "Invited <date>" without a new column.
  await prisma.internalRosterEntry.update({
    where: { id: entry.id },
    data: { inviteSentAt: new Date() },
  });
  return { ok: true, id: entry.id, name: entry.providerName, channels, linkedNow };
}

// POST /:id/invite-to-app — invite one provider.
router.post('/:id/invite-to-app', facilityAuth, async (req, res) => {
  try {
    const entry = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });
    if (!entry || entry.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (entry.snapAccountLinked) {
      return res.status(409).json({ error: 'Already linked to a SNAP account' });
    }
    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { name: true },
    });
    const result = await sendAppInvite(entry, facility?.name || 'Your facility');
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[roster] invite-to-app failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /bulk-invite-to-app — invite N selected providers in one click.
// Body: { ids: ["...", "..."] } — scoped to the calling facility.
router.post('/bulk-invite-to-app', facilityAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must be non-empty.' });
    }
    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { name: true },
    });
    const entries = await prisma.internalRosterEntry.findMany({
      where: { id: { in: ids }, facilityId: req.facility.id, snapAccountLinked: false },
    });
    const results = [];
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await sendAppInvite(entry, facility?.name || 'Your facility'));
    }
    const sent = results.filter((r) => r.ok).length;
    const skipped = results.filter((r) => !r.ok);
    res.json({ sent, skippedCount: skipped.length, results });
  } catch (err) {
    console.error('[roster] bulk-invite-to-app failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /relink — reverse-link any orphan rows in THIS facility to providers
// who have registered. Coordinator-side equivalent of admin/roster/relink-all,
// useful right after a roster import or after a manual edit changed an email.
router.post('/relink', facilityAuth, async (req, res) => {
  try {
    // We piggyback on the global helper but filter the result down to this
    // facility for reporting. Faster than re-implementing the whole helper.
    const before = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, linkedProviderId: null },
      select: { id: true },
    });
    if (before.length === 0) return res.json({ linked: 0, scanned: 0 });
    await reverseLinkAllOrphans();
    const afterStillOrphans = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, id: { in: before.map((b) => b.id) }, linkedProviderId: null },
      select: { id: true },
    });
    res.json({
      linked: before.length - afterStillOrphans.length,
      scanned: before.length,
    });
  } catch (err) {
    console.error('[roster] relink failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /sync-credentialing — refresh credentialing status for INVITED roster
// entries by asking the passport bridge whether the facility now has an active
// grant (a live grant means the provider claimed their invite + consented).
// Flips INVITED → CLAIMED. Only touches INVITED rows so it stays cheap.
router.post('/sync-credentialing', facilityAuth, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) {
      return res.status(503).json({ error: 'Credentialing bridge is not configured.' });
    }
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, credentialingStatus: 'INVITED', npi: { not: null } },
      select: { id: true, npi: true },
    });

    let updated = 0;
    for (const entry of entries) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const status = await passportClient.getGrantStatus(entry.npi, req.facility.id);
        if (status && status.exists) {
          // eslint-disable-next-line no-await-in-loop
          await prisma.internalRosterEntry.update({
            where: { id: entry.id },
            data: { credentialingStatus: 'CLAIMED' },
          });
          updated += 1;
        }
      } catch (err) {
        // A bridge hiccup on one provider shouldn't fail the whole sync.
        console.error('[sync-credentialing]', entry.id, err.message);
      }
    }

    res.json({ checked: entries.length, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /reclassify-from-nppes — authoritatively set provider type for clinical
// roster rows from each provider's NPPES taxonomy (MD vs CRNA vs AA), fixing
// rows the spreadsheet importer mis-typed. Idempotent + safe to re-run. Only
// changes a type when NPPES gives a confident anesthesia-role mapping; rows it
// can't confirm are left untouched and counted as `unmatched`.
router.post('/reclassify-from-nppes', facilityAuth, async (req, res) => {
  try {
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, isNonClinical: false, npi: { not: null } },
      select: { id: true, providerName: true, npi: true, providerType: true },
    });

    const changes = [];
    let unmatched = 0;
    for (const e of entries) {
      // Sequential to avoid hammering NPPES; rosters are small enough.
      // eslint-disable-next-line no-await-in-loop
      const rec = await lookupByNumber(e.npi);
      const mapped = rec.found ? specialtyFromTaxonomy(rec.primaryTaxonomy) : null;
      if (!mapped) {
        unmatched += 1;
        continue;
      }
      if (mapped !== e.providerType) {
        // eslint-disable-next-line no-await-in-loop
        await prisma.internalRosterEntry.update({
          where: { id: e.id },
          data: { providerType: mapped },
        });
        changes.push({ name: e.providerName, npi: e.npi, from: e.providerType, to: mapped });
      }
    }

    res.json({ checked: entries.length, updated: changes.length, unmatched, changes });
  } catch (err) {
    console.error('[roster] reclassify failed:', err);
    res.status(500).json({ error: 'Failed to re-classify provider types.' });
  }
});

// POST /resolve-from-registry — comprehensive cleanup from NPPES. For EVERY
// row: resolve the NPI by name when missing, set the provider type from the
// official taxonomy, and clear the non-clinical / npi-exempt flags for
// confirmed anesthesia providers (fixing rows the importer benched when it
// couldn't parse a title). Ambiguous names are queued for review; rows with no
// confident anesthesia match are left untouched. Idempotent + safe to re-run.
router.post('/resolve-from-registry', facilityAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { state: true },
    });
    const state = facility?.state || 'MA';

    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      select: { id: true, providerName: true, npi: true, providerType: true, isNonClinical: true, npiExempt: true },
    });

    const changes = [];
    let needsReview = 0;
    let unmatched = 0;

    for (const e of entries) {
      let npi = e.npi;
      let taxonomy = null;

      if (npi) {
        // eslint-disable-next-line no-await-in-loop
        const rec = await lookupByNumber(npi);
        taxonomy = rec.found ? rec.primaryTaxonomy : null;
      } else {
        const split = splitNppesName(e.providerName);
        if (!split) {
          unmatched += 1;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const matches = await searchByName({ firstName: split.firstName, lastName: split.lastName, state });
        const anes = matches.filter((m) => m.status === 'A' && specialtyFromTaxonomy(m.primaryTaxonomy));
        if (anes.length === 1) {
          npi = anes[0].npi;
          taxonomy = anes[0].primaryTaxonomy;
        } else if (anes.length > 1) {
          // eslint-disable-next-line no-await-in-loop
          await prisma.internalRosterEntry.update({
            where: { id: e.id },
            data: { npiLookupStatus: 'NEEDS_DISAMBIGUATION', npiLookupCandidates: anes },
          });
          needsReview += 1;
          continue;
        } else {
          unmatched += 1;
          continue;
        }
      }

      const mappedType = specialtyFromTaxonomy(taxonomy);
      const data = {};
      if (npi && npi !== e.npi) {
        data.npi = npi;
        data.npiLookupStatus = null;
        data.npiLookupCandidates = null;
      }
      if (mappedType && mappedType !== e.providerType) data.providerType = mappedType;
      // A confirmed anesthesia provider is clinical — un-bench them.
      if (mappedType && (e.isNonClinical || e.npiExempt)) {
        data.isNonClinical = false;
        data.npiExempt = false;
      }

      if (Object.keys(data).length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await prisma.internalRosterEntry.update({ where: { id: e.id }, data });
        changes.push({
          name: e.providerName,
          npiAdded: data.npi || null,
          from: e.providerType,
          to: data.providerType || e.providerType,
          unbenched: data.isNonClinical === false,
        });
      } else {
        unmatched += 1;
      }
    }

    res.json({ checked: entries.length, updated: changes.length, needsReview, unmatched, changes });
  } catch (err) {
    console.error('[roster] resolve-from-registry failed:', err);
    res.status(500).json({ error: 'Failed to resolve roster from registry.' });
  }
});

// POST /:id/invite — send a single credentialing invite (per-row button).
router.post('/:id/invite', facilityAuth, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) {
      return res.status(503).json({ error: 'Credentialing bridge is not configured.' });
    }
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const facility = await prisma.facility.findUnique({
      where: { id: req.facility.id },
      select: { id: true, name: true },
    });
    const result = await sendCredentialingInvite(existing, facility);
    if (!result.ok) {
      return res.status(422).json({ error: result.reason, result });
    }

    const updated = await prisma.internalRosterEntry.findUnique({ where: { id: existing.id } });
    // Surface what actually happened so the UI can confirm it clearly:
    //   INVITE_CREATED   → claim email/SMS sent
    //   EXISTING_PROVIDER → provider already has a passport; access request pushed
    //   ALREADY_GRANTED   → this facility already has access
    res.json({ ...updated, inviteResult: { mode: result.mode, delivered: result.delivered, status: result.status } });
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

    const linkFields = await resolveLinkFields({ npi: existing.npi, email: existing.snapAccountEmail });

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
  employer: ['employer', 'employedby', 'agency', 'group', 'staffinggroup', 'practice'],
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
  // Strip whitespace, underscores, hyphens AND periods so "M.D." -> "MD".
  const s = String(v).toUpperCase().replace(/[\s_.\-]/g, '');
  if (s.includes('CRNA') || s.includes('NURSEANESTHETIST')) return 'CRNA';
  if (s.includes('ASSISTANT') || s === 'AA') return 'ANESTHESIA_ASSISTANT';
  // ANES is the CAPA-export shorthand for Anesthesiologist (column B).
  if (s.includes('ANESTHESIOLOGIST') || s.includes('PHYSICIAN') || s === 'MD' || s === 'DO' || s === 'MDA' || s === 'ANES')
    return 'ANESTHESIOLOGIST';
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

/**
 * Parse a free-form employment label into the three orthogonal fields we
 * actually track:
 *   - employmentCategory (the scheduler-side enum)
 *   - is1099 (tax/contract status)
 *   - isFullTime (hours status)
 *
 * Recognized inputs (case/whitespace-insensitive):
 *   "1099 full time" | "1099 ft"   → { PER_DIEM, true,  true  }
 *   "1099 part time" | "1099 pt"   → { PER_DIEM, true,  false }
 *   "employee full time" | "w2 ft" → { FULL_TIME, false, true }
 *   "employee part time" | "w2 pt" → { PER_DIEM,  false, false }
 *   bare "full time" / "FT"        → { FULL_TIME, null, true }  (legacy)
 *   bare "per diem" / "PRN" / "PD" → { PER_DIEM,  null, null }  (legacy)
 *   bare "locums"                  → { LOCUMS,    null, null }  (legacy)
 *
 * Returns { employmentCategory, is1099, isFullTime } — any field may be null
 * when the label is ambiguous. The scheduler only needs employmentCategory
 * to be set for cost math; is1099/isFullTime are purely descriptive.
 */
function parseEmploymentLabel(v) {
  if (!v) return { employmentCategory: null, is1099: null, isFullTime: null };
  const raw = String(v).toUpperCase();
  // Strip ()/[]/punctuation but keep word-boundaries so "1099 (full time)"
  // parses the same as "1099 full time".
  const s = raw.replace(/[()_\-.,\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  const has1099 = /\b1099\b/.test(s);
  const hasW2 = /\b(W ?2|EMPLOYEE|EMP)\b/.test(s);
  const hasFT = /\b(FULL TIME|FULL ?TIME|FT)\b/.test(s);
  const hasPT = /\b(PART TIME|PART ?TIME|PT)\b/.test(s);

  let is1099 = null;
  if (has1099) is1099 = true;
  else if (hasW2) is1099 = false;

  let isFullTime = null;
  if (hasFT) isFullTime = true;
  else if (hasPT) isFullTime = false;

  // Derive scheduler-side category per the matrix Matthew confirmed:
  //   employee + FT → FULL_TIME (only true W-2 full-timers)
  //   everything else with a known shape → PER_DIEM
  //   bare "locums" → LOCUMS (legacy single-sheet path)
  let employmentCategory = null;
  if (is1099 === false && isFullTime === true) {
    employmentCategory = 'FULL_TIME';
  } else if (is1099 != null || isFullTime != null) {
    employmentCategory = 'PER_DIEM';
  } else {
    // No 1099/W2/PT/FT signal — fall back to legacy single-token parsing.
    employmentCategory = normalizeEmployment(v);
    if (employmentCategory === 'FULL_TIME') isFullTime = true;
    else if (employmentCategory === 'PER_DIEM') isFullTime = false;
  }

  return { employmentCategory, is1099, isFullTime };
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
  employment: ['employment', 'employmentcategory', 'employmenttype', 'status', 'employmentstatus'],
  baseHrs: ['basehrs', 'basehours', 'ftehours', 'hoursperweek'],
  hrRate: ['hrrate', 'hourly', 'hourlyrate', 'rate', 'perhour'],
  payrollId: ['payrollid', 'payroll'],
  // Who staffs this provider into the facility (APNE / CAPA / JJM / etc).
  // The pay rate column is what the facility pays THIS employer per hour.
  employer: ['employer', 'employedby', 'agency', 'group', 'staffinggroup', 'practice'],
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
// Suffixes commonly trailing a provider's surname. Stripped before picking
// "last name" so "Jane Smith Jr" → key("jsmith"), matching "Smith, Jane".
const NAME_SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'v',
  'md', 'do', 'crna', 'aa', 'phd', 'rn', 'pa', 'np',
  'esq', 'esquire',
]);

function stripSuffix(token) {
  // Strip trailing punctuation and lowercase for the comparison.
  return token.replace(/[.,]/g, '').toLowerCase();
}

function buildNameKey(rawName) {
  if (!rawName) return null;
  const s = String(rawName).trim();
  let firstName, lastName;
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    // "FullName, Credential" (e.g. "Jane Smith, MD") rather than "Last, First":
    // detect when the post-comma fragment is just a suffix and treat the
    // whole pre-comma piece as the name in First-Last order.
    if (parts.length === 2 && parts[1].split(/\s+/).every((t) => NAME_SUFFIXES.has(stripSuffix(t)))) {
      const tokens = parts[0].split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        firstName = tokens[0];
        lastName = tokens[tokens.length - 1];
      }
    } else {
      lastName = parts[0];
      firstName = parts[1] || '';
    }
  } else {
    let parts = s.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    // Strip trailing suffix tokens (Jr / Sr / III / MD / etc.) so they
    // don't get treated as the last name.
    while (parts.length > 2 && NAME_SUFFIXES.has(stripSuffix(parts[parts.length - 1]))) {
      parts = parts.slice(0, -1);
    }
    firstName = parts[0];
    lastName = parts[parts.length - 1];
  }
  if (!firstName || !lastName) return null;
  // Also strip a trailing suffix from a comma-form last name (e.g. "Smith Jr, Jane").
  const lastTokens = lastName.split(/\s+/).filter(Boolean);
  if (lastTokens.length > 1 && NAME_SUFFIXES.has(stripSuffix(lastTokens[lastTokens.length - 1]))) {
    lastName = lastTokens.slice(0, -1).join(' ');
  }
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
    'role', 'employment', 'baseHrs', 'hrRate', 'payrollId', 'employer',
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
  const skippedDuplicates = [];
  let matchedToProfiles = 0;
  let totalLocationsCreated = 0;

  // Build a Set of name-fingerprints already on this facility's roster so a
  // re-upload (or a double-submit) doesn't duplicate every provider. Also
  // collect lowercased exact-display-name as a belt-and-braces check for
  // names buildNameKey can't fingerprint.
  const existingRows = await prisma.internalRosterEntry.findMany({
    where: { facilityId: req.facility.id },
    select: { providerName: true },
  });
  const existingFingerprints = new Set();
  const existingDisplayNames = new Set();
  for (const row of existingRows) {
    const fp = buildNameKey(row.providerName);
    if (fp) existingFingerprints.add(fp);
    existingDisplayNames.add(String(row.providerName || '').trim().toLowerCase());
  }

  for (const nameKey of allNameKeys) {
    const staff = staffByName.get(nameKey) || {};
    const payroll = payrollByName.get(nameKey) || {};

    // Display name: Staff sheet preferred (has the canonical contact-info row);
    // fall back to Payroll's name if provider only appears in payroll.
    const name = staff._displayName || payroll._displayName || null;
    if (!name) { errors.push({ nameKey, error: 'No parseable name in Staff or Payroll sheet' }); continue; }

    // Skip if the provider is already on this facility's roster — protects
    // against same-file re-uploads, double-submits, and the rare case where
    // two name spellings in the workbook collide with an existing entry.
    if (existingFingerprints.has(nameKey) || existingDisplayNames.has(name.trim().toLowerCase())) {
      skippedDuplicates.push({ nameKey, name });
      continue;
    }
    // Reserve this name so a duplicate row WITHIN the upload doesn't slip
    // through after the first one creates.
    existingFingerprints.add(nameKey);
    existingDisplayNames.add(name.trim().toLowerCase());

    // Role that doesn't map to a clinical specialty → non-clinical roster
    // member (back-office staff, biller, etc). They belong on the roster for
    // payroll but are never scheduled into ORs and don't need an NPI.
    let type = normalizeSpecialty(payroll.role);
    // Parse the employment label into three orthogonal fields. CAPA exports
    // "1099 part time" / "employee full time" style labels — we keep
    // employmentCategory for the scheduler and surface is1099 + isFullTime
    // for cost attribution on the roster card.
    const { employmentCategory: employment, is1099: is1099Raw, isFullTime } =
      parseEmploymentLabel(payroll.employment);

    const email = String(staff.email ?? '').trim().toLowerCase() || null;
    const phone = String(staff.mobile ?? '').trim() || null;
    const hourlyRate = parseNumber(payroll.hrRate);
    const fteHours = parseNumber(payroll.baseHrs);
    const payrollSystemId = String(payroll.payrollId ?? '').trim() || null;
    let employer = String(payroll.employer ?? '').trim() || null;
    let is1099 = is1099Raw;
    // Auto-derive employer + tax status from Payroll ID when not explicitly set.
    // CAPA convention: payrollId = "APNE" → 1099 contractor staffed by APNE;
    //                  payrollId = "CAPA" → W-2 employee of CAPA.
    if (payrollSystemId) {
      const pid = payrollSystemId.toUpperCase();
      if (!employer && (pid === 'APNE' || pid === 'CAPA')) employer = pid;
      if (is1099 == null) {
        if (pid === 'APNE') is1099 = true;
        else if (pid === 'CAPA') is1099 = false;
      }
    }
    // Use Staff's Initials for the rosterCode (customer-internal short code)
    // and to bridge to the location sheets. Falls back to Payroll's Initials
    // if Staff is missing it.
    const rosterCode = staff._initials || payroll._initials || null;

    // NPI resolution via NPPES for EVERY row. When the payroll role column
    // didn't classify the provider, derive their type from the matched NPI's
    // taxonomy — so a real clinician isn't benched just because their title
    // was written unusually. Only rows we still can't establish a clinical
    // identity for end up non-clinical.
    let npi = null;
    let npiLookupStatus = null;
    let npiLookupCandidates = null;
    {
      const npiResult = await resolveNpi({ name, state: 'MA' });
      if (npiResult.decision === 'AUTO_MATCHED') {
        npi = npiResult.npi;
        if (!type) {
          const taxType = specialtyFromTaxonomy(npiResult.matches[0]?.primaryTaxonomy);
          if (taxType) type = taxType;
        }
      } else {
        // NEEDS_DISAMBIGUATION | NO_MATCH | INVALID_NAME — store for the
        // disambiguation UI to surface to the coordinator post-import.
        npiLookupStatus = npiResult.decision;
        npiLookupCandidates = npiResult.matches.length > 0 ? npiResult.matches : null;
        if (!type) {
          needsNpiReview.push({
            nameKey,
            name,
            decision: npiResult.decision,
            candidates: npiResult.matches,
          });
        }
      }
    }

    const isNonClinical = !type;

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
          providerType: type, // null for non-clinical
          employmentCategory: employment, // may be null
          isNonClinical,
          npiExempt: isNonClinical, // non-clinical staff don't need an NPI
          npi,
          rosterCode,
          payrollSystemId,
          employer,
          is1099,
          isFullTime,
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
      created.push({ id: entry.id, nameKey, name, rosterCode, linkedProfile: snapAccountLinked, npi, isNonClinical });

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
      skippedDuplicates: skippedDuplicates.length,
      multiSheet: true,
    },
    created,
    errors,
    needsNpiReview,
    skippedDuplicates,
  });
}

// ── QGenda "Daily Worksheet" import ─────────────────────────────────────────
// QGenda exports a daily grid with column-groups (Physician | CRNA | None),
// each [Staff, Assignment, Rooms, Notes, name], where Staff is a LAST NAME only
// (sometimes "Last, Initial"). The "None" group holds agency providers. We pull
// distinct people, infer role from the group, mark None-group people as agency,
// and resolve each last name against NPPES (role+state narrowed) — auto-matching
// when unambiguous, else flagging for the NPI review queue. See the Tufts-Melrose
// QGenda discussion. Hours/schedule parsing is a later (payroll) job.

// A "Staff" cell that's actually a summary line ("Att - Clinical: 18",
// "CRNA - Available: 17", "None: 1") or a stray header, not a person.
function isQgendaSummaryCell(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/:\s*\d+\s*$/.test(t)) return true; // "... : 18"
  return ['none', 'staff', 'physician'].includes(t.toLowerCase());
}

// "Bushman" → {last:'Bushman'}; "Berman, M" → {last:'Berman', initial:'M'};
// "O'BrienA" → {last:"O'Brien", initial:'A'} (trailing glued initial).
function parseQgendaName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return { lastName: '', firstInitial: null };
  let m = /^(.+?),\s*([A-Za-z])\.?$/.exec(s);
  if (m) return { lastName: m[1].trim(), firstInitial: m[2].toUpperCase() };
  m = /^(.*[a-z'’])([A-Z])$/.exec(s); // glued trailing initial
  if (m) return { lastName: m[1].trim(), firstInitial: m[2].toUpperCase() };
  return { lastName: s, firstInitial: null };
}

function qgendaRoleFor(groupLabel, assignment) {
  const g = String(groupLabel || '').toLowerCase();
  if (g.includes('crna') || g.includes('nurse anesthetist')) return 'CRNA';
  if (g.includes('physician') || g.includes('anesthesiolog')) return 'ANESTHESIOLOGIST';
  // "None" (agency) group — infer from the assignment text prefix.
  if (/^\s*crna/i.test(assignment)) return 'CRNA';
  return 'ANESTHESIOLOGIST';
}

function isQgendaWorkbook(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return false;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }).slice(0, 8);
  const flat = rows.map((r) => r.map((c) => String(c).trim().toLowerCase()));
  const hasGroupHdr = flat.some((r) => r.some((c) => c === 'physician' || c.includes('certified registered nurse anesthetist')));
  const hasSubHdr = flat.some((r) => r.includes('staff') && r.includes('assignment'));
  return hasGroupHdr && hasSubHdr;
}

// Extract distinct people from a QGenda daily worksheet.
function parseQgendaDailyWorksheet(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  // Sub-header row = the one with 'Staff' + 'Assignment'.
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const lc = rows[i].map((c) => String(c).trim().toLowerCase());
    if (lc.includes('staff') && lc.includes('assignment')) { hdrIdx = i; break; }
  }
  if (hdrIdx < 0) return [];

  const hdr = rows[hdrIdx].map((c) => String(c).trim().toLowerCase());
  const groupHdr = hdrIdx > 0 ? rows[hdrIdx - 1].map((c) => String(c).trim()) : [];
  const groups = [];
  hdr.forEach((c, idx) => {
    if (c !== 'staff') return;
    const assignIdx = hdr.indexOf('assignment', idx);
    groups.push({ staffIdx: idx, assignIdx: assignIdx >= 0 ? assignIdx : idx + 1, label: groupHdr[idx] || '' });
  });

  const people = [];
  const seen = new Set();
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    for (const g of groups) {
      const staff = String(rows[r][g.staffIdx] || '').trim();
      if (isQgendaSummaryCell(staff)) continue;
      const assignment = String(rows[r][g.assignIdx] || '').trim();
      const { lastName, firstInitial } = parseQgendaName(staff);
      if (!lastName) continue;
      const role = qgendaRoleFor(g.label, assignment);
      const isAgency = String(g.label).trim().toLowerCase() === 'none';
      const key = `${lastName.toLowerCase()}|${(firstInitial || '').toLowerCase()}|${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({ lastName, firstInitial, role, is1099: isAgency, rawName: staff, assignment });
    }
  }
  return people;
}

async function handleQgendaUpload(workbook, req, res) {
  const people = parseQgendaDailyWorksheet(workbook);
  if (!people.length) {
    return res.status(400).json({ error: 'No providers found in the QGenda worksheet.' });
  }

  const existing = await prisma.internalRosterEntry.findMany({
    where: { facilityId: req.facility.id },
    select: { providerName: true },
  });
  const existingFp = new Set(existing.map((e) => buildNameKey(e.providerName)).filter(Boolean));
  const existingNames = new Set(existing.map((e) => String(e.providerName || '').trim().toLowerCase()));

  let createdCount = 0;
  let autoMatched = 0;
  let needsReview = 0;
  let skippedDuplicates = 0;

  for (const p of people) {
    // Resolve the last name against NPPES, narrowed by role + state (MA).
    let resolved;
    try {
      resolved = await resolveNpiByLastName({ lastName: p.lastName, firstInitial: p.firstInitial, state: 'MA', role: p.role });
    } catch {
      resolved = { decision: 'NO_MATCH', matches: [], npi: null };
    }

    let providerName;
    let npi = null;
    let npiLookupStatus = null;
    let npiLookupCandidates = null;
    if (resolved.decision === 'AUTO_MATCHED' && resolved.matches[0]) {
      const m = resolved.matches[0];
      providerName = [m.firstName, m.lastName].filter(Boolean).join(' ') || p.rawName;
      npi = resolved.npi;
    } else {
      providerName = p.firstInitial ? `${p.lastName}, ${p.firstInitial}` : p.lastName;
      npiLookupStatus = resolved.decision; // NEEDS_DISAMBIGUATION | NO_MATCH | INVALID_NAME
      npiLookupCandidates = resolved.matches && resolved.matches.length ? resolved.matches : null;
    }

    const fp = buildNameKey(providerName);
    if ((fp && existingFp.has(fp)) || existingNames.has(providerName.toLowerCase())) {
      skippedDuplicates += 1;
      continue;
    }
    if (fp) existingFp.add(fp);
    existingNames.add(providerName.toLowerCase());

    let linkedProviderId = null;
    let snapAccountLinked = false;
    if (npi) {
      const profile = await prisma.providerProfile.findUnique({ where: { npiNumber: npi } }).catch(() => null);
      if (profile) { linkedProviderId = profile.id; snapAccountLinked = true; }
    }

    await prisma.internalRosterEntry.create({
      data: {
        facilityId: req.facility.id,
        providerName,
        providerType: p.role,
        is1099: !!p.is1099, // None-group = agency (1099); employed otherwise
        employer: p.is1099 ? 'Agency' : null,
        npi,
        npiLookupStatus,
        npiLookupCandidates,
        ...(linkedProviderId ? { linkedProviderId, snapAccountLinked } : {}),
      },
    });
    createdCount += 1;
    if (npi) autoMatched += 1; else needsReview += 1;
  }

  return res.json({
    format: 'qgenda',
    createdCount,
    autoMatched,
    needsReview,
    skippedDuplicates,
    message:
      `Imported ${createdCount} providers from QGenda. ${autoMatched} auto-matched to an NPI; ` +
      `${needsReview} need NPI review${skippedDuplicates ? `; ${skippedDuplicates} duplicates skipped` : ''}.`,
  });
}

/**
 * POST /upload — parse a CSV/XLSX, create roster entries, link by NPI.
 *
 * Three paths:
 *   1. Multi-sheet (CAPA-style) — workbook has Staff + Payroll sheets.
 *   2. QGenda daily worksheet — last-name grid, resolved via NPPES.
 *   3. Single-sheet (flat CSV/XLSX) — original behavior.
 */
router.post('/upload', facilityAuth, rosterUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });

    // Multi-sheet detection: file has Staff + Payroll sheets
    if (workbook.SheetNames.includes('Staff') && workbook.SheetNames.includes('Payroll')) {
      return handleMultiSheetUpload(workbook, req, res);
    }

    // QGenda daily worksheet detection
    if (isQgendaWorkbook(workbook)) {
      return handleQgendaUpload(workbook, req, res);
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
    const skippedDuplicates = [];
    let matchedToProfiles = 0;
    let skipped = 0;

    // Pre-load existing roster names so a re-upload / double-submit doesn't
    // duplicate every provider. Same defense the multi-sheet path uses.
    const existingRows = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      select: { providerName: true },
    });
    const existingFingerprints = new Set();
    const existingDisplayNames = new Set();
    for (const row of existingRows) {
      const fp = buildNameKey(row.providerName);
      if (fp) existingFingerprints.add(fp);
      existingDisplayNames.add(String(row.providerName || '').trim().toLowerCase());
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // human-readable, header is row 1
      const get = (key) => (headerMap[key] != null ? row[headerMap[key]] : null);

      const name = String(get('name') || '').trim();
      if (!name) { skipped += 1; continue; } // blank row, skip silently

      // Dedup against existing roster + earlier rows in this upload.
      const fp = buildNameKey(name);
      const displayKey = name.toLowerCase();
      if ((fp && existingFingerprints.has(fp)) || existingDisplayNames.has(displayKey)) {
        skippedDuplicates.push({ row: rowNum, name });
        continue;
      }
      if (fp) existingFingerprints.add(fp);
      existingDisplayNames.add(displayKey);

      const type = normalizeSpecialty(get('type'));
      const { employmentCategory: employment, is1099, isFullTime } =
        parseEmploymentLabel(get('employment'));
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
      const employer = String(get('employer') || '').trim() || null;

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
            employer,
            is1099,
            isFullTime,
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
        skippedDuplicates: skippedDuplicates.length,
        totalDataRows: dataRows.length,
      },
      created,
      errors,
      skippedDuplicates,
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
// Exposed for unit tests (pure helpers; no side effects).
module.exports.__qgenda = { isQgendaWorkbook, parseQgendaDailyWorksheet, parseQgendaName };
