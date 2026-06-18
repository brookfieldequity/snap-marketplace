const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { requireFlag } = require('../config/featureFlags');
const {
  SNAP_FIELDS,
  DEFAULT_TEMPLATES,
  autoMapHeaders,
  extractHeaders,
  generateCsv,
  computeGross,
  computeBonus,
  seedLineItems,
  fmtDate,
} = require('../services/payroll');

const router = express.Router();

// Every payroll route requires a facility user AND the payroll_builder flag.
router.use(facilityAuth);
router.use(requireFlag('payroll_builder'));

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .csv, .xlsx, or .xls files are accepted.'), ok);
  },
});

const VALID_SYSTEMS = ['ADP', 'GUSTO'];
const VALID_CLASSES = ['W2', 'CONTRACTOR'];

function fieldCatalog() {
  return Object.entries(SNAP_FIELDS).map(([name, def]) => ({ name, label: def.label }));
}

// Resolve the headers + header→field map to use for a system: the facility's
// saved template if present, else the built-in default. Safety net: if a saved
// template maps ZERO fields (e.g. an old config corrupted by the pre-fix
// title-row bug), fall back to the default so we never emit an all-blank CSV.
function resolveTemplate(config, system) {
  const def = DEFAULT_TEMPLATES[system];
  if (config && Array.isArray(config.headers) && config.headers.length) {
    const map = config.fieldMapping || {};
    const mappedCount = Object.values(map).filter(Boolean).length;
    if (mappedCount > 0) {
      return { headers: config.headers, map, fileCode: config.fileCode, stale: false };
    }
    // Saved template maps nothing — treat as stale, use default but flag it.
    return { headers: def.headers, map: def.map, fileCode: config.fileCode, stale: true };
  }
  return { headers: def.headers, map: def.map, fileCode: config?.fileCode, stale: false };
}

// ── Config: saved templates + field catalog ─────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const configs = await prisma.payrollTemplateConfig.findMany({
      where: { facilityId: req.facility.id },
    });
    res.json({
      fields: fieldCatalog(),
      systems: VALID_SYSTEMS.map((system) => {
        const config = configs.find((c) => c.system === system);
        return {
          system,
          configured: !!config,
          templateName: config?.templateName || null,
          headers: config?.headers || DEFAULT_TEMPLATES[system].headers,
          fieldMapping: config?.fieldMapping || DEFAULT_TEMPLATES[system].map,
          fileCode: config?.fileCode || null,
          usingDefault: !config,
          uploadedAt: config?.uploadedAt || null,
        };
      }),
    });
  } catch (err) {
    console.error('[payroll/config]', err.message);
    res.status(500).json({ error: 'Failed to load payroll config' });
  }
});

// ── Upload a payroll template → parse headers + auto-map ─────────────────────────
router.post('/template', templateUpload.single('file'), async (req, res) => {
  const system = String(req.body.system || '').toUpperCase();
  if (!VALID_SYSTEMS.includes(system)) {
    return res.status(400).json({ error: 'Invalid payroll system' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    // Auto-skip any leading title/blank rows (Gusto exports prefix a title row).
    const headers = extractHeaders(rows);
    if (!headers.length) {
      return res.status(400).json({ error: 'Could not read column headers from the template.' });
    }
    const { map, unmapped } = autoMapHeaders(headers);
    const config = await prisma.payrollTemplateConfig.upsert({
      where: { facilityId_system: { facilityId: req.facility.id, system } },
      create: {
        facilityId: req.facility.id,
        system,
        templateName: req.file.originalname,
        headers,
        fieldMapping: map,
        fileCode: req.body.fileCode || null,
        uploadedAt: new Date(),
      },
      update: {
        templateName: req.file.originalname,
        headers,
        fieldMapping: map,
        uploadedAt: new Date(),
      },
    });
    res.json({
      system,
      templateName: config.templateName,
      headers,
      fieldMapping: map,
      unmapped,
      fields: fieldCatalog(),
    });
  } catch (err) {
    console.error('[payroll/template]', err.message);
    res.status(500).json({ error: 'Failed to parse template' });
  }
});

// ── Save an edited field mapping / file code ────────────────────────────────────
router.put('/template/:system/mapping', async (req, res) => {
  const system = String(req.params.system || '').toUpperCase();
  if (!VALID_SYSTEMS.includes(system)) {
    return res.status(400).json({ error: 'Invalid payroll system' });
  }
  const { fieldMapping, fileCode } = req.body || {};
  try {
    const existing = await prisma.payrollTemplateConfig.findUnique({
      where: { facilityId_system: { facilityId: req.facility.id, system } },
    });
    const headers = existing?.headers || DEFAULT_TEMPLATES[system].headers;
    const config = await prisma.payrollTemplateConfig.upsert({
      where: { facilityId_system: { facilityId: req.facility.id, system } },
      create: {
        facilityId: req.facility.id,
        system,
        headers,
        fieldMapping: fieldMapping || DEFAULT_TEMPLATES[system].map,
        fileCode: fileCode || null,
        uploadedAt: existing?.uploadedAt || null,
      },
      update: {
        ...(fieldMapping ? { fieldMapping } : {}),
        ...(fileCode !== undefined ? { fileCode } : {}),
      },
    });
    res.json({ system, headers: config.headers, fieldMapping: config.fieldMapping, fileCode: config.fileCode });
  } catch (err) {
    console.error('[payroll/template mapping]', err.message);
    res.status(500).json({ error: 'Failed to save mapping' });
  }
});

// ── Reset a template (force re-upload) ──────────────────────────────────────────
router.delete('/template/:system', async (req, res) => {
  const system = String(req.params.system || '').toUpperCase();
  if (!VALID_SYSTEMS.includes(system)) {
    return res.status(400).json({ error: 'Invalid payroll system' });
  }
  try {
    await prisma.payrollTemplateConfig
      .delete({ where: { facilityId_system: { facilityId: req.facility.id, system } } })
      .catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[payroll/template delete]', err.message);
    res.status(500).json({ error: 'Failed to reset template' });
  }
});

// ── Preview: auto-seed editable line items for a period + pay class ──────────────
router.get('/preview', async (req, res) => {
  const payClass = String(req.query.payClass || 'W2').toUpperCase();
  const { periodStart, periodEnd } = req.query;
  if (!VALID_CLASSES.includes(payClass)) {
    return res.status(400).json({ error: 'Invalid pay class' });
  }
  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  }
  try {
    const items = await seedLineItems({
      facilityId: req.facility.id,
      payClass,
      periodStart,
      periodEnd,
    });
    const summary = {
      providerCount: items.length,
      totalHours: items.reduce((s, i) => s + i.regularHours + i.otHours, 0),
      totalGross: items.reduce((s, i) => s + i.grossPay, 0),
      missingRateCount: items.filter((i) => i.missingRate).length,
    };
    res.json({ payClass, periodStart, periodEnd, items, summary });
  } catch (err) {
    console.error('[payroll/preview]', err.message);
    res.status(500).json({ error: 'Failed to build payroll preview' });
  }
});

// ── Export: persist a run + generate the CSV ────────────────────────────────────
// Body: { system, payClass, periodStart, periodEnd, lineItems: [...] }
// lineItems are the admin-reviewed rows (edited hours/rates, all approved).
router.post('/runs', async (req, res) => {
  const { system: rawSystem, payClass: rawClass, periodStart, periodEnd, lineItems } = req.body || {};
  const system = String(rawSystem || '').toUpperCase();
  const payClass = String(rawClass || '').toUpperCase();
  if (!VALID_SYSTEMS.includes(system)) return res.status(400).json({ error: 'Invalid payroll system' });
  if (!VALID_CLASSES.includes(payClass)) return res.status(400).json({ error: 'Invalid pay class' });
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'Pay period is required' });
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return res.status(400).json({ error: 'No providers to export' });
  }
  try {
    // Recompute gross server-side (authoritative) from submitted hours/rates.
    const items = lineItems.map((li) => {
      const regularHours = Number(li.regularHours || 0);
      const otHours = Number(li.otHours || 0);
      const hourlyRate = li.hourlyRate != null ? Number(li.hourlyRate) : null;
      const annualRate = li.annualRate != null ? Number(li.annualRate) : null;
      const grossPay = Math.round(computeGross({ regularHours, otHours, hourlyRate, annualRate }) * 100) / 100;
      const bonusFlat = li.bonusFlat != null && li.bonusFlat !== '' ? Number(li.bonusFlat) : null;
      const bonusHours = li.bonusHours != null && li.bonusHours !== '' ? Number(li.bonusHours) : null;
      const bonusRate = li.bonusRate != null && li.bonusRate !== '' ? Number(li.bonusRate) : null;
      const bonusTotal = computeBonus({ bonusFlat, bonusHours, bonusRate });
      return {
        rosterEntryId: li.rosterEntryId || null,
        providerName: li.providerName || '',
        role: li.role || null,
        payrollSystemId: li.payrollSystemId || null,
        regularHours,
        otHours,
        hourlyRate,
        annualRate,
        grossPay,
        bonusFlat,
        bonusHours,
        bonusRate,
        bonusTotal,
        shiftDetail: li.shiftDetail || null,
      };
    });

    const config = await prisma.payrollTemplateConfig.findUnique({
      where: { facilityId_system: { facilityId: req.facility.id, system } },
    });
    const tpl = resolveTemplate(config, system);

    const run = {
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      payClass,
      system,
    };
    const csv = generateCsv({ headers: tpl.headers, map: tpl.map, items, run, config: { fileCode: tpl.fileCode } });

    const classLabel = payClass === 'CONTRACTOR' ? '1099' : 'W2';
    const fileName = `SNAP_Payroll_${system}_${classLabel}_${fmtDate(periodStart)}_${fmtDate(periodEnd)}.csv`;
    const totalHours = items.reduce((s, i) => s + i.regularHours + i.otHours, 0);
    const totalGross = items.reduce((s, i) => s + i.grossPay, 0);

    const exportedByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || null;

    const saved = await prisma.payrollRun.create({
      data: {
        facilityId: req.facility.id,
        system,
        payClass,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        providerCount: items.length,
        totalHours: Math.round(totalHours * 100) / 100,
        totalGross: Math.round(totalGross * 100) / 100,
        status: 'EXPORTED',
        csvContent: csv,
        fileName,
        exportedById: req.user.userId,
        exportedByName,
        exportedAt: new Date(),
        lineItems: {
          create: items.map((i) => ({
            rosterEntryId: i.rosterEntryId,
            providerName: i.providerName,
            role: i.role,
            payrollSystemId: i.payrollSystemId,
            regularHours: i.regularHours,
            otHours: i.otHours,
            hourlyRate: i.hourlyRate,
            annualRate: i.annualRate,
            grossPay: i.grossPay,
            bonusFlat: i.bonusFlat,
            bonusHours: i.bonusHours,
            bonusRate: i.bonusRate,
            bonusTotal: i.bonusTotal,
            shiftDetail: i.shiftDetail,
            approved: true,
            approvedById: req.user.userId,
            approvedAt: new Date(),
          })),
        },
      },
    });

    res.json({ run: saved, csv, fileName, templateStale: tpl.stale === true });
  } catch (err) {
    console.error('[payroll/runs POST]', err.message);
    res.status(500).json({ error: 'Failed to export payroll run' });
  }
});

// ── History list ────────────────────────────────────────────────────────────────
router.get('/runs', async (req, res) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { exportedAt: 'desc' },
      select: {
        id: true,
        system: true,
        payClass: true,
        periodStart: true,
        periodEnd: true,
        providerCount: true,
        totalHours: true,
        totalGross: true,
        status: true,
        fileName: true,
        exportedByName: true,
        exportedAt: true,
      },
    });
    res.json({ runs });
  } catch (err) {
    console.error('[payroll/runs GET]', err.message);
    res.status(500).json({ error: 'Failed to load payroll history' });
  }
});

// ── Run detail (includes stored CSV for re-download) ────────────────────────────
router.get('/runs/:id', async (req, res) => {
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      include: { lineItems: true },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    res.json({ run });
  } catch (err) {
    console.error('[payroll/runs/:id]', err.message);
    res.status(500).json({ error: 'Failed to load payroll run' });
  }
});

// ── Provider rate + classification (the roster "card") ──────────────────────────
// Sets the current rate on the roster entry AND writes a RosterRateHistory row
// (effective-dated) for audit. Also updates classification used to split runs.
router.patch('/providers/:rosterEntryId/rate', async (req, res) => {
  const { hourlyRate, annualRate, is1099, employmentCategory, effectiveDate, note } = req.body || {};
  try {
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { id: req.params.rosterEntryId, facilityId: req.facility.id },
    });
    if (!entry) return res.status(404).json({ error: 'Provider not found' });

    const updated = await prisma.internalRosterEntry.update({
      where: { id: entry.id },
      data: {
        ...(hourlyRate !== undefined ? { hourlyRate: hourlyRate == null ? null : Number(hourlyRate) } : {}),
        ...(annualRate !== undefined ? { annualRate: annualRate == null ? null : Number(annualRate) } : {}),
        ...(is1099 !== undefined ? { is1099 } : {}),
        ...(employmentCategory !== undefined ? { employmentCategory } : {}),
      },
    });

    // Only record history when a rate actually changed.
    const rateChanged =
      (hourlyRate !== undefined && Number(hourlyRate) !== entry.hourlyRate) ||
      (annualRate !== undefined && Number(annualRate) !== entry.annualRate);
    if (rateChanged) {
      await prisma.rosterRateHistory.create({
        data: {
          rosterEntryId: entry.id,
          hourlyRate: updated.hourlyRate,
          annualRate: updated.annualRate,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
          setById: req.user.userId,
          note: note || null,
        },
      });
    }
    res.json({ provider: updated });
  } catch (err) {
    console.error('[payroll/providers rate]', err.message);
    res.status(500).json({ error: 'Failed to update provider rate' });
  }
});

router.get('/providers/:rosterEntryId/rate-history', async (req, res) => {
  try {
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { id: req.params.rosterEntryId, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!entry) return res.status(404).json({ error: 'Provider not found' });
    const history = await prisma.rosterRateHistory.findMany({
      where: { rosterEntryId: entry.id },
      orderBy: { effectiveDate: 'desc' },
    });
    res.json({ history });
  } catch (err) {
    console.error('[payroll/rate-history]', err.message);
    res.status(500).json({ error: 'Failed to load rate history' });
  }
});

module.exports = router;
