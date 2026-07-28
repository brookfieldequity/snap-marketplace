/**
 * WC Recovery routes (2026-07-24) — /api/wc/*
 *
 * Workers'-comp underpayment recovery for anesthesia groups
 * (WC-RECOVERY-BRIEF.md). Facility-audience, tenant-scoped by the group's
 * WcClient row, gated by the wc_recovery feature flag (SNAP-admin enabled;
 * CAPA first).
 *
 * Flow: ingest (AI reader) → engine computes MA entitlement + auto-stages
 * rung-1 packets → human reviews/sends demand → remittances recognize
 * received recovery onto the ledger. SNAP never touches the money.
 */

const express = require('express')
const multer = require('multer')
const path = require('path')
const prisma = require('../config/db')
const facilityAuth = require('../middleware/facilityAuth')
const { getEffectiveFlags } = require('../config/featureFlags')
const wcIntake = require('./../wc/wcIntake')
const engine = require('./../wc/wcEngine')
const { renderDocPdf, RENDERABLE_TYPES } = require('./../wc/wcDocs')

const router = express.Router()
router.use(facilityAuth)

// ── Feature gate + tenant bootstrap ─────────────────────────────────────────
// wc_recovery is off at every tier; a SNAP-admin override turns it on for a
// design-partner group. First authorized request auto-creates the WcClient.
router.use(async (req, res, next) => {
  try {
    const flags = await getEffectiveFlags(req.facility.id)
    // getEffectiveFlags returns { tier, flags: { name: { enabled } } } — the
    // gate must unwrap .flags (same as routes/featureFlags.js does).
    if (!flags?.flags?.wc_recovery?.enabled) {
      return res.status(403).json({ error: 'WC Recovery is not enabled for this group' })
    }
    let client = await prisma.wcClient.findUnique({ where: { facilityId: req.facility.id } })
    if (!client) {
      client = await prisma.wcClient.create({
        data: { facilityId: req.facility.id, name: req.facility.name },
      })
    }
    req.wcClient = client
    next()
  } catch (err) {
    next(err)
  }
})

// ── Island handoff (Phase 4 PHI-island migration, 2026-07-28) ───────────────
// WC PHI routes are moving to the island gateway (wc.snapmedical.app). The
// marketplace's boundary role: authenticate the facility user + enforce the
// wc_recovery flag (middleware above), then mint a short-lived token carrying
// ONLY opaque claims. When the migration completes, this endpoint is all that
// remains of WC in this file.
const jwt = require('jsonwebtoken')
router.post('/island-token', (req, res) => {
  const token = jwt.sign(
    {
      type: 'wc-island',
      facilityId: req.facility.id,
      facilityName: req.facility.name,
      userId: req.user.userId,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )
  res.json({ token, url: process.env.WC_ISLAND_URL || 'https://wc.snapmedical.app/api/wc' })
})

// Every case lookup is tenant-scoped — cross-tenant ids 404, never leak.
async function findCase(req, id, include = null) {
  return prisma.wcCase.findFirst({
    where: { id, clientId: req.wcClient.id },
    ...(include ? { include } : {}),
  })
}

// ── Ingest ──────────────────────────────────────────────────────────────────
// Billing exports (CSV/PDF), EMR exports, EOBs (PDF/image). Analyzed in
// memory; nothing raw is persisted (same posture as credmap analyze).
const ALLOWED_EXT = ['.pdf', '.csv', '.txt', '.tsv', '.jpg', '.jpeg', '.png']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_EXT.includes(path.extname(file.originalname || '').toLowerCase())
    cb(ok ? null : new Error('Unsupported file type'), ok)
  },
})

router.post('/ingest', upload.array('files', 6), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' })
    if (!wcIntake.isConfigured()) {
      return res.status(503).json({ error: 'AI intake is not configured (ANTHROPIC_API_KEY missing)' })
    }

    const { sourceKind, notes, cases } = await wcIntake.readFiles(
      req.files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype, name: f.originalname }))
    )

    const results = { created: 0, merged: 0, remittances: 0, caseIds: [] }
    for (const rec of cases) {
      const { aiConfidence, paidAmount, ...fields } = rec

      // Merge rule (brief §7): same claim number ⇒ same case. EOB paid lines
      // land as remittances on the existing case (recovery recognition runs
      // inside recordRemittance); other sources fill still-null fields only —
      // the anesthesia record outranks a re-upload, nothing gets clobbered.
      const existing = rec.claimNumber
        ? await prisma.wcCase.findFirst({
            where: { clientId: req.wcClient.id, claimNumber: rec.claimNumber },
          })
        : null

      if (existing) {
        const fill = {}
        for (const [k, v] of Object.entries(fields)) {
          if (v != null && (existing[k] == null || (Array.isArray(existing[k]) && !existing[k].length))) fill[k] = v
        }
        if (Object.keys(fill).length) {
          await prisma.wcCase.update({ where: { id: existing.id }, data: fill })
        }
        if (paidAmount != null && sourceKind === 'EOB_PDF') {
          await engine.recordRemittance(existing.id, { paidAmount, source: sourceKind }, req.user.userId)
          results.remittances++
        } else {
          await engine.runCase(existing.id, req.user.userId)
        }
        results.merged++
        results.caseIds.push(existing.id)
      } else {
        const created = await prisma.wcCase.create({
          data: {
            clientId: req.wcClient.id,
            source: sourceKind,
            ...fields,
            paidAmount,
          },
        })
        await engine.logActivity(created.id, 'INGESTED', { sourceKind, aiConfidence }, req.user.userId)
        await engine.runCase(created.id, req.user.userId)
        results.created++
        results.caseIds.push(created.id)
      }
    }

    res.json({ ...results, notes })
  } catch (err) {
    console.error('WC ingest error:', err)
    res.status(500).json({ error: err.message || 'Ingest failed' })
  }
})

// ── Dashboard summary ───────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const clientId = req.wcClient.id
    const [cases, recovered, openWork] = await Promise.all([
      prisma.wcCase.findMany({
        where: { clientId },
        select: { status: true, gapAmount: true, entitledAmount: true, paidAmount: true },
      }),
      prisma.wcRecoveryEvent.aggregate({
        where: { case: { clientId } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.wcWorkItem.count({ where: { case: { clientId }, status: { not: 'DONE' } } }),
    ])

    const byStatus = {}
    let openGap = 0
    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1
      if (['UNDERPAYMENT_FLAGGED', 'PACKET_GENERATED', 'SUBMITTED'].includes(c.status) && c.gapAmount > 0) {
        openGap += c.gapAmount
      }
    }

    res.json({
      recoveredTotal: Math.round((recovered._sum.amount || 0) * 100) / 100,
      recoveryEvents: recovered._count,
      openGap: Math.round(openGap * 100) / 100,
      caseCount: cases.length,
      byStatus,
      openWorkItems: openWork,
      contingencyPct: req.wcClient.contingencyPct,
    })
  } catch (err) {
    console.error('WC summary error:', err)
    res.status(500).json({ error: 'Failed to load summary' })
  }
})

// ── Cases ───────────────────────────────────────────────────────────────────
router.get('/cases', async (req, res) => {
  try {
    const where = { clientId: req.wcClient.id }
    if (req.query.status) where.status = req.query.status
    const cases = await prisma.wcCase.findMany({
      where,
      orderBy: [{ gapAmount: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    })
    res.json({ cases })
  } catch (err) {
    console.error('WC cases error:', err)
    res.status(500).json({ error: 'Failed to load cases' })
  }
})

router.get('/cases/:id', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id, {
      entitlementCalc: true,
      remittances: { orderBy: { createdAt: 'asc' } },
      documents: { orderBy: { createdAt: 'asc' } },
      workItems: { orderBy: { createdAt: 'asc' } },
      activity: { orderBy: { createdAt: 'desc' }, take: 50 },
      recoveryEvents: { orderBy: { createdAt: 'desc' } },
    })
    if (!c) return res.status(404).json({ error: 'Case not found' })
    res.json({ case: c })
  } catch (err) {
    console.error('WC case error:', err)
    res.status(500).json({ error: 'Failed to load case' })
  }
})

// Human confirmation/correction of extracted fields → recompute. This is the
// exception path the confidence router sends low-confidence cases down.
const EDITABLE = [
  'asaCptCode', 'baseUnits', 'anesthesiaMinutes', 'physicalStatus', 'qualifyingCircs',
  'patientRef', 'claimNumber', 'adjusterName', 'adjusterContact', 'employerName',
  'payerName', 'dateOfInjury', 'dateOfService', 'bodyPart', 'authorization', 'billedAmount',
]
router.patch('/cases/:id', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id)
    if (!c) return res.status(404).json({ error: 'Case not found' })
    const data = {}
    for (const k of EDITABLE) {
      if (!(k in req.body)) continue
      let v = req.body[k]
      if (['dateOfInjury', 'dateOfService'].includes(k)) v = v ? new Date(v) : null
      if (['baseUnits', 'anesthesiaMinutes', 'billedAmount'].includes(k)) v = v == null ? null : Number(v)
      data[k] = v
    }
    await prisma.wcCase.update({ where: { id: c.id }, data })
    // Field confirmation closes any open CONFIRM_EXTRACTION item.
    await prisma.wcWorkItem.updateMany({
      where: { caseId: c.id, type: 'CONFIRM_EXTRACTION', status: { not: 'DONE' } },
      data: { status: 'DONE' },
    })
    await engine.logActivity(c.id, 'FIELDS_CONFIRMED', { fields: Object.keys(data) }, req.user.userId)
    const updated = await engine.runCase(c.id, req.user.userId)
    res.json({ case: updated })
  } catch (err) {
    console.error('WC case update error:', err)
    res.status(500).json({ error: 'Failed to update case' })
  }
})

router.post('/cases/:id/compute', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id)
    if (!c) return res.status(404).json({ error: 'Case not found' })
    const updated = await engine.runCase(c.id, req.user.userId)
    res.json({ case: updated })
  } catch (err) {
    console.error('WC compute error:', err)
    res.status(500).json({ error: err.message || 'Compute failed' })
  }
})

router.delete('/cases/:id', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id)
    if (!c) return res.status(404).json({ error: 'Case not found' })
    await prisma.wcCase.delete({ where: { id: c.id } }) // cascades children
    res.json({ ok: true })
  } catch (err) {
    console.error('WC case delete error:', err)
    res.status(500).json({ error: 'Failed to delete case' })
  }
})

// ── Documents (generate ≠ send) ─────────────────────────────────────────────
router.get('/cases/:id/documents/:docId/pdf', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id, { entitlementCalc: true, client: true })
    if (!c) return res.status(404).json({ error: 'Case not found' })
    const docRow = await prisma.wcDocument.findFirst({
      where: { id: req.params.docId, caseId: c.id },
    })
    if (!docRow) return res.status(404).json({ error: 'Document not found' })
    if (!RENDERABLE_TYPES.includes(docRow.type)) {
      return res.status(400).json({ error: `${docRow.type} rendering is not built yet (rung 2 pends counsel review)` })
    }
    await engine.logActivity(c.id, 'DOC_VIEWED', { type: docRow.type }, req.user.userId)
    renderDocPdf(docRow.type, c, res)
  } catch (err) {
    console.error('WC doc render error:', err)
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Render failed' })
  }
})

// The separate human step: mark a staged packet as actually sent to the
// carrier. Case advances to SUBMITTED — the seam a future SNAP desk slots into.
router.post('/cases/:id/documents/:docId/mark-sent', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id)
    if (!c) return res.status(404).json({ error: 'Case not found' })
    const docRow = await prisma.wcDocument.findFirst({ where: { id: req.params.docId, caseId: c.id } })
    if (!docRow) return res.status(404).json({ error: 'Document not found' })

    await prisma.wcDocument.update({
      where: { id: docRow.id },
      data: { status: 'SENT', sentAt: new Date(), sentBy: req.user.userId },
    })
    if (['PACKET_GENERATED', 'UNDERPAYMENT_FLAGGED'].includes(c.status)) {
      await prisma.wcCase.update({
        where: { id: c.id },
        data: { status: 'SUBMITTED', nextAction: engine.nextActionFor('SUBMITTED', c.confidenceScore) },
      })
      await prisma.wcWorkItem.updateMany({
        where: { caseId: c.id, type: 'REVIEW_UNDERPAYMENT', status: { not: 'DONE' } },
        data: { status: 'DONE' },
      })
    }
    await engine.logActivity(c.id, 'DOC_SENT', { type: docRow.type }, req.user.userId)
    const updated = await findCase(req, c.id, { documents: true })
    res.json({ case: updated })
  } catch (err) {
    console.error('WC mark-sent error:', err)
    res.status(500).json({ error: 'Failed to mark sent' })
  }
})

// ── Remittances (recovery recognition) ──────────────────────────────────────
router.post('/cases/:id/remittances', async (req, res) => {
  try {
    const c = await findCase(req, req.params.id)
    if (!c) return res.status(404).json({ error: 'Case not found' })
    const paidAmount = Number(req.body.paidAmount)
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      return res.status(400).json({ error: 'paidAmount must be a non-negative number' })
    }
    const updated = await engine.recordRemittance(c.id, {
      paidAmount,
      receivedDate: req.body.receivedDate || null,
      source: 'MANUAL',
    }, req.user.userId)
    res.json({ case: updated })
  } catch (err) {
    console.error('WC remittance error:', err)
    res.status(500).json({ error: err.message || 'Failed to record remittance' })
  }
})

// ── Ledger ──────────────────────────────────────────────────────────────────
router.get('/ledger', async (req, res) => {
  try {
    const events = await prisma.wcRecoveryEvent.findMany({
      where: { case: { clientId: req.wcClient.id } },
      include: { case: { select: { claimNumber: true, patientRef: true, payerName: true, dateOfService: true } } },
      orderBy: { recognizedAt: 'desc' },
      take: 500,
    })
    const total = events.reduce((s, e) => s + e.amount, 0)
    const uninvoiced = events.filter((e) => !e.invoiced).reduce((s, e) => s + e.amount, 0)
    res.json({
      events,
      recoveredTotal: Math.round(total * 100) / 100,
      uninvoicedTotal: Math.round(uninvoiced * 100) / 100,
      contingencyPct: req.wcClient.contingencyPct,
    })
  } catch (err) {
    console.error('WC ledger error:', err)
    res.status(500).json({ error: 'Failed to load ledger' })
  }
})

// ── Work items ──────────────────────────────────────────────────────────────
router.get('/workitems', async (req, res) => {
  try {
    const items = await prisma.wcWorkItem.findMany({
      where: { case: { clientId: req.wcClient.id }, ...(req.query.all ? {} : { status: { not: 'DONE' } }) },
      include: { case: { select: { id: true, claimNumber: true, patientRef: true, gapAmount: true, status: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    res.json({ items })
  } catch (err) {
    console.error('WC workitems error:', err)
    res.status(500).json({ error: 'Failed to load work items' })
  }
})

router.patch('/workitems/:id', async (req, res) => {
  try {
    const item = await prisma.wcWorkItem.findFirst({
      where: { id: req.params.id, case: { clientId: req.wcClient.id } },
    })
    if (!item) return res.status(404).json({ error: 'Work item not found' })
    const status = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE'].includes(req.body.status) ? req.body.status : undefined
    const updated = await prisma.wcWorkItem.update({
      where: { id: item.id },
      data: { ...(status ? { status } : {}), ...(req.body.note !== undefined ? { note: req.body.note } : {}) },
    })
    res.json({ item: updated })
  } catch (err) {
    console.error('WC workitem update error:', err)
    res.status(500).json({ error: 'Failed to update work item' })
  }
})

module.exports = router
