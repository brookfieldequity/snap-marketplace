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
const eorCost = require('../services/eorCost');
const { sanitizeAoa } = require('../utils/exportCells');

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

// ── Pay-period schedule + period picker ─────────────────────────────────────
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const todayUTC = () => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); };

// Generate pay periods (newest first) from an anchor period-start + frequency.
function buildPeriods({ anchorDate, frequency }, back = 9, forward = 1) {
  const len = frequency === 'WEEKLY' ? 7 : 14;
  const anchor = anchorDate ? parseYmd(anchorDate) : todayUTC();
  const k = Math.floor((todayUTC() - anchor) / (len * 86400000));
  const out = [];
  for (let i = k + forward; i >= k - back; i--) {
    const start = addDays(anchor, i * len);
    out.push({ start: ymd(start), end: ymd(addDays(start, len - 1)) });
  }
  return out;
}

// GET /pay-schedule
router.get('/pay-schedule', async (req, res) => {
  try {
    const f = await prisma.facility.findUnique({ where: { id: req.facility.id }, select: { payAnchorDate: true, payFrequency: true } });
    res.json({ anchorDate: f?.payAnchorDate || null, frequency: f?.payFrequency || 'BIWEEKLY' });
  } catch (err) { console.error('[payroll/pay-schedule]', err.message); res.status(500).json({ error: 'Failed to load pay schedule' }); }
});

// PUT /pay-schedule  { anchorDate, frequency }
router.put('/pay-schedule', async (req, res) => {
  try {
    const { anchorDate, frequency } = req.body || {};
    if (anchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return res.status(400).json({ error: 'anchorDate must be YYYY-MM-DD' });
    const f = await prisma.facility.update({
      where: { id: req.facility.id },
      data: { payAnchorDate: anchorDate || null, payFrequency: frequency === 'WEEKLY' ? 'WEEKLY' : 'BIWEEKLY' },
      select: { payAnchorDate: true, payFrequency: true },
    });
    res.json({ anchorDate: f.payAnchorDate, frequency: f.payFrequency });
  } catch (err) { console.error('[payroll/pay-schedule PUT]', err.message); res.status(500).json({ error: 'Failed to save pay schedule' }); }
});

// GET /periods — generated pay periods + status (submitted hours, already-run).
router.get('/periods', async (req, res) => {
  try {
    const f = await prisma.facility.findUnique({ where: { id: req.facility.id }, select: { payAnchorDate: true, payFrequency: true } });
    const frequency = f?.payFrequency || 'BIWEEKLY';
    const periods = buildPeriods({ anchorDate: f?.payAnchorDate, frequency });
    if (!periods.length) return res.json({ anchorDate: f?.payAnchorDate || null, frequency, periods: [] });
    const windowStart = parseYmd(periods[periods.length - 1].start);
    const windowEnd = new Date(parseYmd(periods[0].end).getTime() + 86399999);
    const [entries, runs] = await Promise.all([
      prisma.providerHourEntry.findMany({ where: { facilityId: req.facility.id, status: 'SUBMITTED', date: { gte: windowStart, lte: windowEnd } }, select: { date: true, rosterEntryId: true } }),
      prisma.payrollRun.findMany({ where: { facilityId: req.facility.id, periodStart: { gte: windowStart } }, select: { periodStart: true } }),
    ]);
    const runStarts = new Set(runs.map((r) => ymd(r.periodStart)));
    const enriched = periods.map((p) => {
      const s = parseYmd(p.start).getTime();
      const e = parseYmd(p.end).getTime() + 86399999;
      const inP = entries.filter((x) => { const t = new Date(x.date).getTime(); return t >= s && t <= e; });
      return { ...p, submittedEntries: inP.length, providerCount: new Set(inP.map((x) => x.rosterEntryId)).size, hasRun: runStarts.has(p.start) };
    });
    res.json({ anchorDate: f?.payAnchorDate || null, frequency, periods: enriched });
  } catch (err) { console.error('[payroll/periods]', err.message); res.status(500).json({ error: 'Failed to load pay periods' }); }
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

// ── Draft: persist in-progress bonus/reimbursement edits ────────────────────────
// PUT /drafts — upsert the coordinator's edits for one line so leaving the
// Payroll Builder never loses them. The preview overlays these on reload.
router.put('/drafts', async (req, res) => {
  const { payClass, periodStart, periodEnd, rosterEntryId, bonusFlat, bonusHours, bonusRate, reimbursement, approved } = req.body || {};
  const cls = String(payClass || '').toUpperCase();
  if (!VALID_CLASSES.includes(cls)) return res.status(400).json({ error: 'Invalid pay class' });
  if (!periodStart || !periodEnd || !rosterEntryId) {
    return res.status(400).json({ error: 'periodStart, periodEnd, and rosterEntryId are required' });
  }
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  try {
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { id: rosterEntryId, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!entry) return res.status(404).json({ error: 'Provider not on this facility roster' });
    const values = {
      bonusFlat: num(bonusFlat),
      bonusHours: num(bonusHours),
      bonusRate: num(bonusRate),
      reimbursement: num(reimbursement),
      approved: !!approved,
    };
    const where = {
      facilityId_rosterEntryId_payClass_periodStart_periodEnd: {
        facilityId: req.facility.id,
        rosterEntryId,
        payClass: cls,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
      },
    };
    const draft = await prisma.payrollLineDraft.upsert({
      where,
      update: values,
      create: {
        facilityId: req.facility.id,
        rosterEntryId,
        payClass: cls,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        ...values,
      },
    });
    res.json({ ok: true, draftId: draft.id });
  } catch (err) {
    console.error('[payroll/drafts]', err.message);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ── Export: persist a run + generate the CSV ────────────────────────────────────
// Body: { system, payClass, periodStart, periodEnd, lineItems: [...] }
// lineItems are the admin-reviewed rows (edited hours/rates, all approved).
router.post('/runs', async (req, res) => {
  const { system: rawSystem, payClass: rawClass, periodStart, periodEnd, lineItems, invoiceNumber } = req.body || {};
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
      const reimbursement = li.reimbursement != null && li.reimbursement !== '' ? Number(li.reimbursement) : null;
      return {
        rosterEntryId: li.rosterEntryId || null,
        providerName: li.providerName || '',
        businessName: li.businessName || null,
        useBusinessNameForPayroll: !!li.useBusinessNameForPayroll,
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
        reimbursement,
        shiftDetail: li.shiftDetail || null,
      };
    });

    const config = await prisma.payrollTemplateConfig.findUnique({
      where: { facilityId_system: { facilityId: req.facility.id, system } },
    });
    const tpl = resolveTemplate(config, system);

    const invoiceNum = invoiceNumber != null && String(invoiceNumber).trim() !== '' ? String(invoiceNumber).trim() : null;
    const run = {
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      payClass,
      system,
      invoiceNumber: invoiceNum,
    };
    const csv = generateCsv({ headers: tpl.headers, map: tpl.map, items, run, config: { fileCode: tpl.fileCode } });

    const classLabel = payClass === 'CONTRACTOR' ? '1099' : 'W2';
    const fileName = `SNAP_Payroll_${system}_${classLabel}_${fmtDate(periodStart)}_${fmtDate(periodEnd)}.csv`;
    const totalHours = items.reduce((s, i) => s + i.regularHours + i.otHours, 0);
    const totalGross = items.reduce((s, i) => s + i.grossPay, 0);
    const totalBonus = items.reduce((s, i) => s + i.bonusTotal, 0);
    const totalReimbursement = items.reduce((s, i) => s + (i.reimbursement || 0), 0);

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
        totalBonus: Math.round(totalBonus * 100) / 100,
        totalReimbursement: Math.round(totalReimbursement * 100) / 100,
        invoiceNumber: invoiceNum,
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
            reimbursement: i.reimbursement,
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
        totalBonus: true,
        totalReimbursement: true,
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

// ── Edit a run (invoice number only — CSV was already exported) ─────────────────
router.patch('/runs/:id', async (req, res) => {
  const { invoiceNumber } = req.body || {};
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        invoiceNumber: invoiceNumber != null ? (String(invoiceNumber).trim() || null) : run.invoiceNumber,
      },
    });
    res.json({ run: updated });
  } catch (err) {
    console.error('[payroll/runs PATCH]', err.message);
    res.status(500).json({ error: 'Failed to update payroll run' });
  }
});

// ── Delete a run ─────────────────────────────────────────────────────────────────
router.delete('/runs/:id', async (req, res) => {
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[payroll/runs DELETE]', err.message);
    res.status(500).json({ error: 'Failed to delete payroll run' });
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

// ── Agency invoice (the "CAPA All in" deliverable) ──────────────────────────────
// One-click: hours (from the schedule) × each provider's all-in cost rate, per
// staffing agency. The facility-facing total of what it owes each agency. The
// provider PAY rate / margin are deliberately excluded (APNE-internal).
// GET /agency-invoice?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD
router.get('/agency-invoice', async (req, res) => {
  const { periodStart, periodEnd } = req.query;
  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  }
  try {
    const { providerCosts } = await eorCost.buildFacilityCostForPeriod({
      facilityId: req.facility.id,
      periodStart,
      periodEnd,
    });
    const invoices = eorCost.composeAgencyInvoices({ providerCosts, periodStart, periodEnd });
    res.json({ periodStart, periodEnd, invoices });
  } catch (err) {
    console.error('[payroll/agency-invoice]', err.message);
    res.status(500).json({ error: 'Failed to build agency invoice' });
  }
});

// Download one agency's invoice as an .xlsx mirroring the "CAPA All in" sheet.
// GET /agency-invoice/export?periodStart&periodEnd&employerId
router.get('/agency-invoice/export', async (req, res) => {
  const { periodStart, periodEnd, employerId } = req.query;
  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  }
  try {
    const { providerCosts } = await eorCost.buildFacilityCostForPeriod({
      facilityId: req.facility.id,
      periodStart,
      periodEnd,
    });
    const invoices = eorCost.composeAgencyInvoices({ providerCosts, periodStart, periodEnd });
    const invoice = employerId
      ? invoices.find((i) => i.employerId === employerId)
      : invoices[0];
    if (!invoice) return res.status(404).json({ error: 'No agency invoice for that period' });

    // Build the sheet: title rows, header, lines, total — mirrors "CAPA All in".
    // sanitizeAoa neutralizes formula injection in the string cells (agency /
    // payee names); numeric cells pass through untouched.
    const aoa = sanitizeAoa([
      [`${invoice.employerName || 'Agency'} → ${req.facility.name} Invoice`],
      [`${fmtDate(periodStart)} to ${fmtDate(periodEnd)}`],
      [],
      ['contractor_type', 'payee', 'hours_worked', 'all_in_rate', 'amount'],
      ...invoice.lines.map((l) => [l.contractorType, l.payeeName, l.hours, l.capaRate, l.amount]),
      [],
      ['', '', '', 'Total', invoice.total],
    ]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeName = (invoice.employerName || 'agency').replace(/[^a-z0-9]+/gi, '-');
    const fileName = `${safeName}-invoice-${fmtDate(periodStart)}.xlsx`;

    // Freeze this export in history: what was billed can be re-downloaded
    // byte-identically even after hours/rates change. Failures don't block
    // the download itself.
    try {
      await prisma.agencyInvoiceRun.create({
        data: {
          facilityId: req.facility.id,
          employerId: invoice.employerId || null,
          employerName: invoice.employerName || null,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          total: Math.round((Number(invoice.total) || 0) * 100) / 100,
          hours: Math.round(invoice.lines.reduce((s, l) => s + (Number(l.hours) || 0), 0) * 100) / 100,
          lines: invoice.lines,
          fileName,
          file: buf,
        },
      });
    } catch (snapErr) {
      console.error('[payroll/agency-invoice/export] snapshot failed:', snapErr.message);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  } catch (err) {
    console.error('[payroll/agency-invoice/export]', err.message);
    res.status(500).json({ error: 'Failed to export agency invoice' });
  }
});

// ── Agency invoice history ───────────────────────────────────────────────────────
// GET /agency-invoice/runs — saved exports, newest first (no file bytes).
router.get('/agency-invoice/runs', async (req, res) => {
  try {
    const runs = await prisma.agencyInvoiceRun.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, employerId: true, employerName: true, periodStart: true, periodEnd: true,
        invoiceNumber: true, total: true, hours: true, fileName: true, createdAt: true,
      },
      take: 200,
    });
    res.json({ runs });
  } catch (err) {
    console.error('[payroll/agency-invoice/runs]', err.message);
    res.status(500).json({ error: 'Failed to load invoice history' });
  }
});

// GET /agency-invoice/runs/:id/download — the exact bytes that were exported.
router.get('/agency-invoice/runs/:id/download', async (req, res) => {
  try {
    const run = await prisma.agencyInvoiceRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!run) return res.status(404).json({ error: 'Invoice not found' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${run.fileName}"`);
    res.send(Buffer.from(run.file));
  } catch (err) {
    console.error('[payroll/agency-invoice/runs download]', err.message);
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

// PATCH /agency-invoice/runs/:id — bookkeeping reference (invoice number) only.
router.patch('/agency-invoice/runs/:id', async (req, res) => {
  const { invoiceNumber } = req.body || {};
  try {
    const run = await prisma.agencyInvoiceRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      select: { id: true, invoiceNumber: true },
    });
    if (!run) return res.status(404).json({ error: 'Invoice not found' });
    const updated = await prisma.agencyInvoiceRun.update({
      where: { id: run.id },
      data: {
        invoiceNumber: invoiceNumber != null ? (String(invoiceNumber).trim() || null) : run.invoiceNumber,
      },
      select: { id: true, invoiceNumber: true },
    });
    res.json({ run: updated });
  } catch (err) {
    console.error('[payroll/agency-invoice/runs PATCH]', err.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// DELETE /agency-invoice/runs/:id — remove a saved export from history.
router.delete('/agency-invoice/runs/:id', async (req, res) => {
  try {
    const run = await prisma.agencyInvoiceRun.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
      select: { id: true },
    });
    if (!run) return res.status(404).json({ error: 'Invoice not found' });
    await prisma.agencyInvoiceRun.delete({ where: { id: run.id } });
    res.status(204).end();
  } catch (err) {
    console.error('[payroll/agency-invoice/runs DELETE]', err.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// ── Agency profitability / ROI + Gusto reconciliation ───────────────────────────
// For an agency tenant (e.g. APNE): per-provider payroll cost vs. CAPA all-in
// cost (= margin), the separate APNE-site bonus bucket, and SNAP's computed total
// payout to reconcile against Gusto (a mismatch = a roster-card or Gusto rate
// drifted). GET /agency-metrics?periodStart&periodEnd
router.get('/agency-metrics', async (req, res) => {
  const { periodStart, periodEnd } = req.query;
  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  }
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  try {
    const { providerCosts } = await eorCost.buildFacilityCostForPeriod({
      facilityId: req.facility.id,
      periodStart,
      periodEnd,
    });
    const providers = providerCosts
      .filter((p) => p.employerKind === 'STAFFING_AGENCY' && (p.hours > 0 || p.reimbursement > 0 || p.apneSiteBonus > 0))
      .map((p) => ({
        rosterEntryId: p.rosterEntryId,
        name: p.payeeType === 'Business' && p.businessName ? p.businessName : p.providerName,
        hours: p.hours,
        payRate: p.payRate,
        payrollCost: p.payroll, // CAPA hours × pay rate
        capaAllIn: p.facilityAllIn, // CAPA hours × all-in rate
        capaMargin: p.margin, // all-in − pay (CAPA-engagement profit)
        reimbursement: p.reimbursement,
        apneSiteBonus: p.apneSiteBonus, // separate bucket, not in CAPA margin
        apnePayout: round2(p.payroll + p.apneSiteBonus + p.reimbursement),
        missingRate: p.payRate == null,
      }))
      .sort((a, b) => b.capaMargin - a.capaMargin);

    const sum = (k) => round2(providers.reduce((s, p) => s + (p[k] || 0), 0));
    const totals = {
      providers: providers.length,
      hours: sum('hours'),
      payrollCost: sum('payrollCost'),
      capaAllIn: sum('capaAllIn'),
      capaMargin: sum('capaMargin'),
      reimbursement: sum('reimbursement'),
      apneSiteBonus: sum('apneSiteBonus'),
      apnePayout: sum('apnePayout'),
    };
    totals.marginPct = totals.capaAllIn > 0 ? round2((totals.capaMargin / totals.capaAllIn) * 100) : 0;

    res.json({
      periodStart,
      periodEnd,
      providers,
      totals,
      // SNAP's computed total payout, to compare against Gusto's run total.
      reconciliation: { snapPayrollTotal: totals.apnePayout },
    });
  } catch (err) {
    console.error('[payroll/agency-metrics]', err.message);
    res.status(500).json({ error: 'Failed to build agency metrics' });
  }
});

module.exports = router;
