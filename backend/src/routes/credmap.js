/**
 * Cred Map routes (2026-07-22) — the facility credentialing translator.
 *
 * Map a target facility's credentialing packet ONCE (AI-proposed from the
 * blank packet, coordinator-confirmed), then every provider's packet
 * populates from the passport — initial appointment and renewals alike.
 * These routes cover the map-builder flow: analyze/create, review items,
 * confirm. Packet generation and the renewal dashboard build on the same
 * models next.
 *
 * All state here is coordinator WORKFLOW state (Phase-3 freeze respected):
 * credential facts stay on the passport backend and are read live at
 * packet-generation time via passportClient.
 */

const express = require('express')
const multer = require('multer')
const path = require('path')
const crypto = require('crypto')
const prisma = require('../config/db')
const credentialAuth = require('../middleware/credentialAuth')
const { signDocToken } = require('../middleware/credentialAuth')
const credMapIntake = require('../services/credMapIntake')
const credFormStructure = require('../services/credFormStructure')
const passportClient = require('../services/passportClient')
const { TAXONOMY, CANONICAL_KEYS, STARTER_ITEMS, defaultsFor } = require('../services/credMapTaxonomy')

const router = express.Router()

router.use(credentialAuth)

function requireCoordinator(req, res, next) {
  if (req.credUser.permission !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Coordinator access required' })
  }
  next()
}
router.use(requireCoordinator)

// Map actions land in the same audit trail the rest of the portal uses; the
// providerId column carries the map id for map-scoped actions.
async function logMapAccess(req, mapId, action, documentName = null) {
  await prisma.credentialAccessLog.create({
    data: {
      facilityId: req.facilityId,
      userId: req.credUser.id,
      providerId: mapId,
      action,
      documentName,
      ipAddress: req.ip,
    },
  }).catch(() => {})
}

// Blank packets are PDFs or scanned images; analyzed in memory, with the
// original optionally archived to encrypted S3 for the review pass.
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png']
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png']
const packetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (ALLOWED_EXT.includes(ext) && ALLOWED_MIME.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Only PDF, JPG, and PNG files are allowed'))
  },
})

// Archive the uploaded blank packet to encrypted S3 (best-effort — analysis
// works from memory either way; without a bucket we just skip the archive).
async function archiveSourceDoc(facilityId, file) {
  if (!process.env.AWS_S3_BUCKET || !file) return null
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', followRegionRedirects: true })
    const sse = process.env.AWS_KMS_KEY_ID
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
      : { ServerSideEncryption: 'AES256' }
    const ext = path.extname(file.originalname || '').toLowerCase()
    const key = `credmaps/${facilityId}/${Date.now()}_${crypto.randomUUID()}${ALLOWED_EXT.includes(ext) ? ext : ''}`
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ...sse,
    }))
    return key
  } catch (err) {
    console.error('[credmap] source archive failed (continuing):', err.message)
    return null
  }
}

function scopedMap(req, id, include = undefined) {
  return prisma.credProgramMap.findFirst({ where: { id, facilityId: req.facilityId }, include })
}

const mapItemsInclude = { items: { orderBy: { position: 'asc' } } }

function mapStats(map) {
  const items = map.items || []
  const auto = items.filter((i) => i.fulfillment === 'AUTO_PASSPORT').length
  return {
    itemCount: items.length,
    autoCount: auto,
    autoPct: items.length ? Math.round((auto / items.length) * 100) : 0,
  }
}

// ── Taxonomy (builder dropdowns) ─────────────────────────────────────────────

router.get('/taxonomy', (req, res) => {
  res.json({
    taxonomy: CANONICAL_KEYS.map((key) => ({ key, ...TAXONOMY[key] })),
    aiAvailable: credMapIntake.isConfigured(),
  })
})

// ── Maps ─────────────────────────────────────────────────────────────────────

// GET / — all maps for this facility, with builder stats and packet counts.
router.get('/', async (req, res) => {
  try {
    const maps = await prisma.credProgramMap.findMany({
      where: { facilityId: req.facilityId },
      include: { ...mapItemsInclude, _count: { select: { packets: true, appointments: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      aiAvailable: credMapIntake.isConfigured(),
      maps: maps.map((m) => ({ ...m, stats: mapStats(m) })),
    })
  } catch (err) {
    console.error('[credmap/list] error:', err)
    res.status(500).json({ error: 'Failed to load maps' })
  }
})

// POST / — create a map by hand: blank, or pre-seeded with the standard ASC
// starter checklist (the no-AI fallback path).
router.post('/', async (req, res) => {
  try {
    const { name, useStarter } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Map name required' })
    const map = await prisma.credProgramMap.create({
      data: {
        facilityId: req.facilityId,
        name: String(name).trim().slice(0, 140),
        createdById: req.credUser.id,
        items: useStarter
          ? {
              create: STARTER_ITEMS.map((it, i) => ({
                position: i,
                section: it.section,
                label: it.label,
                canonicalType: it.canonicalType,
                credentialType: it.credentialType,
                fulfillment: it.fulfillment,
              })),
            }
          : undefined,
      },
      include: mapItemsInclude,
    })
    await logMapAccess(req, map.id, 'CREDMAP_CREATE', map.name)
    res.status(201).json({ map: { ...map, stats: mapStats(map) } })
  } catch (err) {
    console.error('[credmap/create] error:', err)
    res.status(500).json({ error: 'Failed to create map' })
  }
})

// POST /analyze — the magic trick: upload a facility's blank packet, get a
// proposed DRAFT map back for review.
router.post('/analyze', packetUpload.array('packet', 5), async (req, res) => {
  try {
    if (!credMapIntake.isConfigured()) {
      return res.status(503).json({
        error: 'AI packet analysis is not configured (ANTHROPIC_API_KEY). Start from the standard checklist instead.',
        aiUnavailable: true,
      })
    }
    const files = req.files || []
    if (files.length === 0) return res.status(400).json({ error: 'No packet uploaded' })

    const proposal = await credMapIntake.analyzePacket(
      files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype }))
    )
    const sourceDocPath = await archiveSourceDoc(req.facilityId, files[0])

    const map = await prisma.credProgramMap.create({
      data: {
        facilityId: req.facilityId,
        name: (req.body.name && String(req.body.name).trim().slice(0, 140)) || proposal.mapName,
        recredCycleMonths: proposal.cycleMonths,
        aiNotes: proposal.notes,
        sourceDocPath,
        sourceDocName: files[0].originalname ? String(files[0].originalname).slice(0, 200) : null,
        createdById: req.credUser.id,
        items: {
          create: proposal.items.map((it, i) => ({
            position: i,
            section: it.section,
            label: it.label,
            canonicalType: it.canonicalType,
            credentialType: it.credentialType,
            fulfillment: it.fulfillment,
            required: it.required,
            esignOk: it.esignOk,
            notes: it.notes,
            aiConfidence: it.aiConfidence,
          })),
        },
      },
      include: mapItemsInclude,
    })
    await logMapAccess(req, map.id, 'CREDMAP_ANALYZE', map.sourceDocName)
    res.status(201).json({ map: { ...map, stats: mapStats(map) } })
  } catch (err) {
    console.error('[credmap/analyze] error:', err)
    res.status(500).json({ error: 'Packet analysis failed — try again, or start from the standard checklist.' })
  }
})

// GET /:id — one map with ordered items.
router.get('/:id', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id, {
      ...mapItemsInclude,
      _count: { select: { packets: true, appointments: true } },
    })
    if (!map) return res.status(404).json({ error: 'Map not found' })
    res.json({ map: { ...map, stats: mapStats(map) } })
  } catch (err) {
    console.error('[credmap/get] error:', err)
    res.status(500).json({ error: 'Failed to load map' })
  }
})

// PATCH /:id — name / cycle / output mode / status.
router.patch('/:id', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })

    const { name, recredCycleMonths, outputMode, status } = req.body || {}
    const data = {}
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Map name required' })
      data.name = String(name).trim().slice(0, 140)
    }
    if (recredCycleMonths !== undefined) {
      const n = Number(recredCycleMonths)
      data.recredCycleMonths = recredCycleMonths === null || recredCycleMonths === '' ? null
        : Number.isFinite(n) && n >= 1 && n <= 120 ? Math.round(n) : undefined
      if (data.recredCycleMonths === undefined) return res.status(400).json({ error: 'Cycle must be 1–120 months' })
    }
    if (outputMode !== undefined) {
      if (!['PDF_PACKET', 'DOC_BUNDLE', 'PORTAL_EXPORT'].includes(outputMode)) return res.status(400).json({ error: 'Invalid output mode' })
      data.outputMode = outputMode
    }
    if (status !== undefined) {
      if (!['DRAFT', 'CONFIRMED', 'ARCHIVED'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
      data.status = status
    }

    const updated = await prisma.credProgramMap.update({ where: { id: map.id }, data, include: mapItemsInclude })
    if (status === 'CONFIRMED' && map.status !== 'CONFIRMED') await logMapAccess(req, map.id, 'CREDMAP_CONFIRM', updated.name)
    res.json({ map: { ...updated, stats: mapStats(updated) } })
  } catch (err) {
    console.error('[credmap/update] error:', err)
    res.status(500).json({ error: 'Failed to update map' })
  }
})

// DELETE /:id — drafts with no packets delete outright; anything in use
// should be archived instead so packet history keeps its map.
router.delete('/:id', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const packetCount = await prisma.credPacket.count({ where: { mapId: map.id } })
    if (packetCount > 0) {
      return res.status(409).json({ error: 'This map has packets — archive it instead of deleting.' })
    }
    await prisma.credAppointment.deleteMany({ where: { mapId: map.id } })
    await prisma.credProgramMap.delete({ where: { id: map.id } }) // items cascade
    await logMapAccess(req, map.id, 'CREDMAP_DELETE', map.name)
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/delete] error:', err)
    res.status(500).json({ error: 'Failed to delete map' })
  }
})

// ── Items ────────────────────────────────────────────────────────────────────

function itemDataFromBody(body, { forCreate = false } = {}) {
  const { label, section, canonicalType, fulfillment, required, esignOk, notes } = body || {}
  const data = {}
  if (label !== undefined || forCreate) {
    if (!label || !String(label).trim()) return { error: 'Item label required' }
    data.label = String(label).trim().slice(0, 200)
  }
  if (section !== undefined) data.section = section ? String(section).trim().slice(0, 80) : null
  if (canonicalType !== undefined) {
    if (canonicalType !== null && !CANONICAL_KEYS.includes(canonicalType)) return { error: 'Invalid canonical type' }
    data.canonicalType = canonicalType
    // Re-derive auto-fill wiring when the type changes (still overridable by
    // an explicit fulfillment in the same request).
    if (canonicalType) {
      const d = defaultsFor(canonicalType)
      data.credentialType = d.credentialType
      data.fulfillment = d.fulfillment
    } else {
      data.credentialType = null
    }
  }
  if (fulfillment !== undefined) {
    if (!['AUTO_PASSPORT', 'DOCUMENT', 'SIGNATURE', 'MANUAL'].includes(fulfillment)) return { error: 'Invalid fulfillment' }
    data.fulfillment = fulfillment
  }
  if (required !== undefined) data.required = Boolean(required)
  if (esignOk !== undefined) data.esignOk = Boolean(esignOk)
  if (notes !== undefined) data.notes = notes ? String(notes).trim().slice(0, 300) : null
  return { data }
}

// POST /:id/items — add an item (appends at the end).
router.post('/:id/items', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const { data, error } = itemDataFromBody(req.body, { forCreate: true })
    if (error) return res.status(400).json({ error })
    const last = await prisma.credMapItem.findFirst({ where: { mapId: map.id }, orderBy: { position: 'desc' }, select: { position: true } })
    const item = await prisma.credMapItem.create({
      data: { ...data, mapId: map.id, position: (last?.position ?? -1) + 1 },
    })
    res.status(201).json({ item })
  } catch (err) {
    console.error('[credmap/item-create] error:', err)
    res.status(500).json({ error: 'Failed to add item' })
  }
})

// PATCH /:id/items/:itemId — edit an item.
router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const existing = await prisma.credMapItem.findFirst({ where: { id: req.params.itemId, mapId: map.id } })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    const { data, error } = itemDataFromBody(req.body)
    if (error) return res.status(400).json({ error })
    const item = await prisma.credMapItem.update({ where: { id: existing.id }, data })
    res.json({ item })
  } catch (err) {
    console.error('[credmap/item-update] error:', err)
    res.status(500).json({ error: 'Failed to update item' })
  }
})

// DELETE /:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const existing = await prisma.credMapItem.findFirst({ where: { id: req.params.itemId, mapId: map.id } })
    if (!existing) return res.status(404).json({ error: 'Item not found' })
    await prisma.credMapItem.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/item-delete] error:', err)
    res.status(500).json({ error: 'Failed to delete item' })
  }
})

// PUT /:id/items/order — drag-and-drop reorder; body { itemIds: [...] } in
// the new order. Ids must be exactly this map's items.
router.put('/:id/items/order', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const itemIds = req.body?.itemIds
    if (!Array.isArray(itemIds) || itemIds.length === 0) return res.status(400).json({ error: 'itemIds required' })
    const existing = await prisma.credMapItem.findMany({ where: { mapId: map.id }, select: { id: true } })
    const existingIds = new Set(existing.map((i) => i.id))
    if (itemIds.length !== existingIds.size || itemIds.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: 'itemIds must contain exactly this map\'s items' })
    }
    await prisma.$transaction(
      itemIds.map((id, i) => prisma.credMapItem.update({ where: { id }, data: { position: i } }))
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/item-order] error:', err)
    res.status(500).json({ error: 'Failed to reorder items' })
  }
})

// ── Renewal tracking (appointment clocks) ────────────────────────────────────
// One CredAppointment per provider × map: when the facility actually
// appointed them (their board's date, recorded by the coordinator — NOT the
// packet-sent date) and when recredentialing is next due. nextDueAt defaults
// to appointedAt + the map's cycle but is directly editable — facilities
// override cycles all the time. Rows also support backfill: providers
// credentialed long before SNAP get tracked the moment Diana types a date.

function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function parseDay(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// GET /renewals/list — every tracked appointment for this facility.
router.get('/renewals/list', async (req, res) => {
  try {
    const appointments = await prisma.credAppointment.findMany({
      where: { facilityId: req.facilityId },
      include: { map: { select: { id: true, name: true, recredCycleMonths: true, status: true } } },
      orderBy: [{ nextDueAt: { sort: 'asc', nulls: 'last' } }, { providerName: 'asc' }],
    })
    res.json({ appointments })
  } catch (err) {
    console.error('[credmap/renewals-list] error:', err)
    res.status(500).json({ error: 'Failed to load renewals' })
  }
})

// POST /renewals — track a provider (backfill or manual add). Upserts on
// map × NPI so re-adding just updates the dates.
router.post('/renewals', async (req, res) => {
  try {
    const { mapId, npi: rawNpi, providerName, appointedAt, nextDueAt } = req.body || {}
    const map = await scopedMap(req, mapId)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const npi = String(rawNpi || '').replace(/\D/g, '')
    if (!/^\d{10}$/.test(npi)) return res.status(400).json({ error: 'A 10-digit NPI is required' })

    const appointed = parseDay(appointedAt)
    const due = parseDay(nextDueAt) || (appointed && map.recredCycleMonths ? addMonths(appointed, map.recredCycleMonths) : null)
    const name = providerName ? String(providerName).trim().slice(0, 140) : null

    const appointment = await prisma.credAppointment.upsert({
      where: { mapId_npi: { mapId: map.id, npi } },
      create: { facilityId: req.facilityId, mapId: map.id, npi, providerName: name, appointedAt: appointed, nextDueAt: due },
      update: { providerName: name || undefined, appointedAt: appointed, nextDueAt: due },
    })
    res.status(201).json({ appointment })
  } catch (err) {
    console.error('[credmap/renewals-add] error:', err)
    res.status(500).json({ error: 'Failed to track provider' })
  }
})

// PATCH /renewals/:appointmentId — edit dates. Setting appointedAt without an
// explicit nextDueAt recomputes the due date from the map's cycle.
router.patch('/renewals/:appointmentId', async (req, res) => {
  try {
    const existing = await prisma.credAppointment.findFirst({
      where: { id: req.params.appointmentId, facilityId: req.facilityId },
      include: { map: { select: { recredCycleMonths: true } } },
    })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const { appointedAt, nextDueAt, providerName } = req.body || {}
    const data = {}
    if (providerName !== undefined) data.providerName = providerName ? String(providerName).trim().slice(0, 140) : null
    if (appointedAt !== undefined) {
      data.appointedAt = parseDay(appointedAt)
      if (nextDueAt === undefined && data.appointedAt && existing.map.recredCycleMonths) {
        data.nextDueAt = addMonths(data.appointedAt, existing.map.recredCycleMonths)
      }
    }
    if (nextDueAt !== undefined) data.nextDueAt = parseDay(nextDueAt)

    const appointment = await prisma.credAppointment.update({ where: { id: existing.id }, data })
    res.json({ appointment })
  } catch (err) {
    console.error('[credmap/renewals-update] error:', err)
    res.status(500).json({ error: 'Failed to update' })
  }
})

// DELETE /renewals/:appointmentId — stop tracking.
router.delete('/renewals/:appointmentId', async (req, res) => {
  try {
    const existing = await prisma.credAppointment.findFirst({
      where: { id: req.params.appointmentId, facilityId: req.facilityId },
    })
    if (!existing) return res.status(404).json({ error: 'Not found' })
    await prisma.credAppointment.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/renewals-delete] error:', err)
    res.status(500).json({ error: 'Failed to remove' })
  }
})

// ── Sticky notes (coordinator reminders) ─────────────────────────────────────

router.get('/notes/all', async (req, res) => {
  try {
    const notes = await prisma.credStickyNote.findMany({
      where: { facilityId: req.facilityId, ...(req.query.includeDone === 'true' ? {} : { done: false }) },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    })
    res.json({ notes })
  } catch (err) {
    console.error('[credmap/notes] error:', err)
    res.status(500).json({ error: 'Failed to load notes' })
  }
})

router.post('/notes', async (req, res) => {
  try {
    const { text, color, mapId, npi } = req.body || {}
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Note text required' })
    if (mapId) {
      const map = await scopedMap(req, mapId)
      if (!map) return res.status(404).json({ error: 'Map not found' })
    }
    const note = await prisma.credStickyNote.create({
      data: {
        facilityId: req.facilityId,
        text: String(text).trim().slice(0, 500),
        color: /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : undefined,
        mapId: mapId || null,
        npi: npi ? String(npi).replace(/\D/g, '').slice(0, 10) || null : null,
        createdById: req.credUser.id,
      },
    })
    res.status(201).json({ note })
  } catch (err) {
    console.error('[credmap/note-create] error:', err)
    res.status(500).json({ error: 'Failed to add note' })
  }
})

router.patch('/notes/:noteId', async (req, res) => {
  try {
    const existing = await prisma.credStickyNote.findFirst({ where: { id: req.params.noteId, facilityId: req.facilityId } })
    if (!existing) return res.status(404).json({ error: 'Note not found' })
    const { text, color, done, position } = req.body || {}
    const data = {}
    if (text !== undefined) {
      if (!String(text).trim()) return res.status(400).json({ error: 'Note text required' })
      data.text = String(text).trim().slice(0, 500)
    }
    if (color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(color || '')) data.color = color
    if (done !== undefined) data.done = Boolean(done)
    if (position !== undefined && Number.isFinite(Number(position))) data.position = Math.round(Number(position))
    const note = await prisma.credStickyNote.update({ where: { id: existing.id }, data })
    res.json({ note })
  } catch (err) {
    console.error('[credmap/note-update] error:', err)
    res.status(500).json({ error: 'Failed to update note' })
  }
})

router.delete('/notes/:noteId', async (req, res) => {
  try {
    const existing = await prisma.credStickyNote.findFirst({ where: { id: req.params.noteId, facilityId: req.facilityId } })
    if (!existing) return res.status(404).json({ error: 'Note not found' })
    await prisma.credStickyNote.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/note-delete] error:', err)
    res.status(500).json({ error: 'Failed to delete note' })
  }
})

// ── Packet generation (Stage 2) ──────────────────────────────────────────────
// Generate = walk the confirmed map against the provider's LIVE passport:
// auto-fillable items whose passport credential is present and current become
// AUTO_FILLED; everything else becomes an open task. Credential facts are
// never copied — the workspace re-reads the passport on every load.

// Marketplace CredentialType (on CredMapItem) → passport-plane credential type.
const PASSPORT_TYPE = {
  STATE_LICENSE: 'STATE_LICENSE',
  MA_CS_LICENSE: 'STATE_CS_LICENSE',
  DEA_CERTIFICATE: 'DEA',
  BOARD_CERTIFICATION: 'BOARD_CERTIFICATION',
  MALPRACTICE_INSURANCE: 'MALPRACTICE_INSURANCE',
  ACLS_CERTIFICATION: 'ACLS',
  BLS_CERTIFICATION: 'BLS',
}

const COMPLETE_STATUSES = ['AUTO_FILLED', 'DONE', 'WAIVED']

function completenessOf(tasks) {
  if (!tasks.length) return 0
  const done = tasks.filter((t) => COMPLETE_STATUSES.includes(t.status)).length
  return Math.round((done / tasks.length) * 100)
}

async function passportSummaryFor(facilityId, npi) {
  if (!passportClient.isConfigured()) return { bridgeUnconfigured: true, exists: false, hasGrant: false }
  try {
    const { summaries } = await passportClient.batchSummary(facilityId, [npi])
    return summaries?.[0] || { exists: false, hasGrant: false }
  } catch (err) {
    console.error('[credmap/passport-summary] bridge error:', err.message)
    return { bridgeError: true, exists: false, hasGrant: false }
  }
}

// Decide each map item's initial task state against the passport summary.
function planTask(item, summary) {
  if (item.fulfillment === 'DOCUMENT') return { status: 'NEEDS_DOCUMENT', assignee: 'COORDINATOR' }
  if (item.fulfillment === 'SIGNATURE') return { status: 'NEEDS_SIGNATURE', assignee: 'PROVIDER' }
  if (item.fulfillment === 'MANUAL') return { status: 'NEEDS_ACTION', assignee: 'COORDINATOR' }

  // AUTO_PASSPORT
  if (!summary.exists || !summary.hasGrant) {
    return { status: 'NEEDS_ACTION', assignee: 'COORDINATOR', note: !summary.exists ? 'No passport found for this NPI' : 'Passport access not granted yet' }
  }
  const passportType = item.credentialType ? PASSPORT_TYPE[item.credentialType] : null
  if (!passportType) {
    // Data-plane sections (CV, education, work history…) ride the passport
    // profile itself — filled whenever a granted passport exists.
    return { status: 'AUTO_FILLED', assignee: 'COORDINATOR', note: 'From passport profile' }
  }
  const cred = (summary.credentials || []).find((c) => c.type === passportType)
  if (!cred) return { status: 'NEEDS_DOCUMENT', assignee: 'COORDINATOR', note: 'Not on the passport yet' }
  if (cred.status === 'EXPIRED' || (cred.expirationDate && new Date(cred.expirationDate) < new Date())) {
    return { status: 'NEEDS_DOCUMENT', assignee: 'COORDINATOR', note: 'Passport copy is expired — needs a current one' }
  }
  return { status: 'AUTO_FILLED', assignee: 'COORDINATOR' }
}

// POST /:id/packets — generate a packet for one provider off this map.
router.post('/:id/packets', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id, mapItemsInclude)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    if (map.items.length === 0) return res.status(400).json({ error: 'Map has no items yet' })

    const npi = String(req.body?.npi || '').replace(/\D/g, '')
    if (!/^\d{10}$/.test(npi)) return res.status(400).json({ error: 'A 10-digit NPI is required' })
    const cycle = req.body?.cycle === 'RENEWAL' ? 'RENEWAL' : 'INITIAL'

    const rosterEntry = await prisma.internalRosterEntry.findFirst({
      where: { facilityId: req.facilityId, npi },
      select: { providerName: true },
    })
    const summary = await passportSummaryFor(req.facilityId, npi)
    const providerName = rosterEntry?.providerName || summary.providerName || req.body?.providerName || null

    const plans = map.items.map((item) => ({ item, plan: planTask(item, summary) }))
    const packet = await prisma.credPacket.create({
      data: {
        mapId: map.id,
        facilityId: req.facilityId,
        npi,
        providerName,
        cycle,
        createdById: req.credUser.id,
        tasks: {
          create: plans.map(({ item, plan }) => ({
            itemId: item.id,
            status: plan.status,
            assignee: plan.assignee,
            note: plan.note || null,
            completedAt: COMPLETE_STATUSES.includes(plan.status) ? new Date() : null,
          })),
        },
      },
      include: { tasks: { include: { item: true } } },
    })
    const completeness = completenessOf(packet.tasks)
    await prisma.credPacket.update({ where: { id: packet.id }, data: { completeness } })
    await logMapAccess(req, map.id, 'CREDMAP_PACKET_GENERATE', `${providerName || npi} (${cycle})`)
    res.status(201).json({ packet: { ...packet, completeness }, passport: summary })
  } catch (err) {
    console.error('[credmap/packet-generate] error:', err)
    res.status(500).json({ error: 'Failed to generate packet' })
  }
})

// GET /packets/list?mapId= — this facility's packets (newest first).
router.get('/packets/list', async (req, res) => {
  try {
    const packets = await prisma.credPacket.findMany({
      where: { facilityId: req.facilityId, ...(req.query.mapId ? { mapId: String(req.query.mapId) } : {}) },
      include: { map: { select: { id: true, name: true, recredCycleMonths: true } }, tasks: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ packets: packets.map((p) => ({ ...p, completeness: completenessOf(p.tasks), tasks: undefined })) })
  } catch (err) {
    console.error('[credmap/packet-list] error:', err)
    res.status(500).json({ error: 'Failed to load packets' })
  }
})

// GET /packets/one/:packetId — the workspace payload: tasks (+items) merged
// with the provider's live passport state.
router.get('/packets/one/:packetId', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      include: {
        map: { select: { id: true, name: true, recredCycleMonths: true, outputMode: true, status: true } },
        tasks: { include: { item: true } },
      },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    const summary = await passportSummaryFor(packet.facilityId, packet.npi)
    const credByType = new Map((summary.credentials || []).map((c) => [c.type, c]))
    const tasks = packet.tasks
      .sort((a, b) => (a.item.position ?? 0) - (b.item.position ?? 0))
      .map((t) => ({
        ...t,
        passportCredential: t.item.credentialType ? credByType.get(PASSPORT_TYPE[t.item.credentialType]) || null : null,
      }))
    res.json({
      packet: { ...packet, tasks, completeness: completenessOf(packet.tasks) },
      passport: summary,
      // Filled-PDF download rides the existing short-lived doc-token route.
      generatedDoc: packet.generatedDocPath
        ? { name: packet.generatedDocName, token: signDocToken(packet.generatedDocPath) }
        : null,
    })
  } catch (err) {
    console.error('[credmap/packet-get] error:', err)
    res.status(500).json({ error: 'Failed to load packet' })
  }
})

// GET /:id/fields?npi= — the field-mapping review panel: every fillable
// field in the facility's PDF, its nearby label, what SNAP mapped it to, and
// (if npi given) the value that resolves against that provider's passport.
// Builds the map on first look so the panel shows the AI's proposal.
async function getSourceBuffer(sourceDocPath) {
  const { clientForBucket } = require('../services/s3Buckets')
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  const s3 = await clientForBucket(process.env.AWS_S3_BUCKET)
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: sourceDocPath }))
  const chunks = []
  for await (const c of obj.Body) chunks.push(c)
  return Buffer.concat(chunks)
}

// GET /:id/fields?npi= — the "what SNAP types where" panel, for BOTH form
// kinds. Fillable PDFs: enumerated AcroForm fields. Flat / print-to-fill PDFs
// (CAPA's case): the AUTO-detected overlay plan (labels the AI found + where
// each value lands) — no human box-placement, ever. Returns a unified `fields`
// list the panel renders + corrects.
router.get('/:id/fields', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    if (!map.sourceDocPath || !process.env.AWS_S3_BUCKET) {
      // No facility form uploaded → the clean SNAP packet is the deliverable.
      return res.json({ engine: 'clean', cleanPacket: true, fields: [] })
    }

    const { inspectFields, buildFieldMap, detectFlatFills, resolveValue, VALUE_KEYS } = require('../services/credMapPdf')
    const buffer = await getSourceBuffer(map.sourceDocPath)
    const { fieldNames, labels } = await inspectFields(buffer)

    // Optional live value preview against a provider's passport.
    let passport = null
    const npi = String(req.query.npi || '').replace(/\D/g, '')
    if (npi && passportClient.isConfigured()) {
      try { passport = await passportClient.getPassport(npi, req.facilityId) } catch { /* preview only */ }
    }

    // Flat form (no/very few real fields) → automatic overlay plan.
    if (fieldNames.length < 5) {
      let plan = map.flatFillPlan
      if (!plan || !Array.isArray(plan.fills)) {
        plan = await detectFlatFills(buffer)
        await prisma.credProgramMap.update({ where: { id: map.id }, data: { flatFillPlan: plan } })
      }
      const fields = plan.fills.map((f) => ({
        name: f.label,
        label: f.label,
        source: f.valueKey || 'LEAVE_BLANK',
        value: passport ? resolveValue(f.valueKey, passport) : null,
      }))
      const mapped = fields.filter((f) => f.source && f.source !== 'LEAVE_BLANK').length
      return res.json({ engine: 'overlay', confidence: plan.confidence, cleanFallback: plan.confidence === 'LOW' || mapped === 0, fields, valueKeys: VALUE_KEYS, mappedCount: mapped, totalCount: fields.length })
    }

    // Genuine fillable AcroForm.
    let fieldMap = map.formFieldMap
    if (!fieldMap || typeof fieldMap !== 'object' || Object.keys(fieldMap).length === 0) {
      fieldMap = await buildFieldMap(fieldNames, labels)
      await prisma.credProgramMap.update({ where: { id: map.id }, data: { formFieldMap: fieldMap } })
    }
    const fields = fieldNames.map((name) => ({
      name,
      label: labels[name] || null,
      source: fieldMap[name] || 'LEAVE_BLANK',
      value: passport ? resolveValue(fieldMap[name], passport) : null,
    }))
    const mapped = fields.filter((f) => f.source && f.source !== 'LEAVE_BLANK').length
    res.json({ engine: 'acroform', fields, valueKeys: VALUE_KEYS, mappedCount: mapped, totalCount: fields.length })
  } catch (err) {
    console.error('[credmap/fields] error:', err)
    res.status(500).json({ error: 'Failed to inspect form fields' })
  }
})

// PUT /:id/anvil — attach an Anvil PDF Template to this map (the SNAP-side,
// one-time setup once the template is built in Anvil's dashboard). Body:
// { castEid, aliasMap: { alias: valueKey } }. Setting a castEid switches the
// map's "Fill facility PDF" onto the Anvil path.
router.put('/:id/anvil', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const { castEid, aliasMap } = req.body || {}
    const data = {}
    if (castEid !== undefined) data.anvilCastEid = castEid ? String(castEid).trim() : null
    if (aliasMap !== undefined) {
      if (aliasMap === null) data.anvilAliasMap = null
      else if (typeof aliasMap === 'object') {
        const { VALUE_KEYS } = require('../services/credMapPdf')
        const clean = {}
        for (const [k, v] of Object.entries(aliasMap)) {
          if (typeof k === 'string' && VALUE_KEYS.includes(v)) clean[k] = v
        }
        data.anvilAliasMap = clean
      } else return res.status(400).json({ error: 'aliasMap must be an object' })
    }
    const updated = await prisma.credProgramMap.update({ where: { id: map.id }, data })
    await logMapAccess(req, map.id, 'CREDMAP_ANVIL_SET', updated.anvilCastEid || 'cleared')
    res.json({ ok: true, anvilCastEid: updated.anvilCastEid, anvilAliasMap: updated.anvilAliasMap })
  } catch (err) {
    console.error('[credmap/anvil-set] error:', err)
    res.status(500).json({ error: 'Failed to save Anvil template' })
  }
})

// POST /:id/fields/rebuild — throw away the stored mapping and re-run the
// (now label-aware) AI pass. For maps built before label extraction, or after
// re-uploading a corrected form.
router.post('/:id/fields/rebuild', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    if (!map.sourceDocPath || !process.env.AWS_S3_BUCKET) return res.status(400).json({ error: 'This map has no facility PDF' })

    const { inspectFields, buildFieldMap, detectFlatFills } = require('../services/credMapPdf')
    const buffer = await getSourceBuffer(map.sourceDocPath)
    const { fieldNames, labels } = await inspectFields(buffer)

    if (fieldNames.length < 5) {
      // Flat form → re-run the automatic overlay detection.
      const plan = await detectFlatFills(buffer)
      await prisma.credProgramMap.update({ where: { id: map.id }, data: { flatFillPlan: plan } })
      const mapped = plan.fills.filter((f) => f.valueKey && f.valueKey !== 'LEAVE_BLANK').length
      await logMapAccess(req, map.id, 'CREDMAP_FLATPLAN_REBUILD', `${mapped} fills, ${plan.confidence}`)
      return res.json({ ok: true, engine: 'overlay', confidence: plan.confidence, mappedCount: mapped, totalCount: plan.fills.length })
    }

    const fieldMap = await buildFieldMap(fieldNames, labels)
    await prisma.credProgramMap.update({ where: { id: map.id }, data: { formFieldMap: fieldMap } })
    const mapped = Object.values(fieldMap).filter((v) => v && v !== 'LEAVE_BLANK').length
    await logMapAccess(req, map.id, 'CREDMAP_FIELDMAP_REBUILD', `${mapped}/${fieldNames.length} mapped`)
    res.json({ ok: true, engine: 'acroform', mappedCount: mapped, totalCount: fieldNames.length })
  } catch (err) {
    console.error('[credmap/fields-rebuild] error:', err)
    res.status(500).json({ error: 'Failed to rebuild mapping' })
  }
})

// PUT /:id/fields — save coordinator corrections. Branches on which plan the
// map holds: flat forms update the overlay plan's fills (keyed by label),
// fillable forms update the AcroForm field map (keyed by field name).
router.put('/:id/fields', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const { fieldMap } = req.body || {}
    if (!fieldMap || typeof fieldMap !== 'object') return res.status(400).json({ error: 'fieldMap object required' })
    const { VALUE_KEYS } = require('../services/credMapPdf')

    if (map.flatFillPlan && Array.isArray(map.flatFillPlan.fills)) {
      // Flat overlay: apply new value-keys by label; drop fills set to blank.
      const fills = map.flatFillPlan.fills
        .map((f) => (Object.prototype.hasOwnProperty.call(fieldMap, f.label) ? { ...f, valueKey: fieldMap[f.label] } : f))
        .filter((f) => VALUE_KEYS.includes(f.valueKey) && f.valueKey !== 'LEAVE_BLANK')
      await prisma.credProgramMap.update({ where: { id: map.id }, data: { flatFillPlan: { ...map.flatFillPlan, fills } } })
      await logMapAccess(req, map.id, 'CREDMAP_FLATPLAN_EDIT', `${fills.length} fills`)
      return res.json({ ok: true, engine: 'overlay' })
    }

    const clean = {}
    for (const [k, v] of Object.entries(fieldMap)) {
      if (typeof k === 'string' && VALUE_KEYS.includes(v)) clean[k] = v
    }
    await prisma.credProgramMap.update({ where: { id: map.id }, data: { formFieldMap: clean } })
    await logMapAccess(req, map.id, 'CREDMAP_FIELDMAP_EDIT', `${Object.keys(clean).length} fields`)
    res.json({ ok: true, engine: 'acroform' })
  } catch (err) {
    console.error('[credmap/fields-save] error:', err)
    res.status(500).json({ error: 'Failed to save mapping' })
  }
})

// ── Native form structure (the scalable path) ────────────────────────────────
// POST /:id/form-structure/build — read the uploaded facility packet and
// extract its FULL structure (sections + typed fields), so SNAP can render its
// own native version of that application. Built once per map, reused for every
// provider. Mirrors /fields/rebuild but produces the native template.
router.post('/:id/form-structure/build', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    if (!map.sourceDocPath || !process.env.AWS_S3_BUCKET) {
      return res.status(400).json({ error: 'Upload the facility application first, then build its native form.' })
    }
    if (!credFormStructure.isConfigured()) {
      return res.status(503).json({ error: 'AI is not configured on this environment (ANTHROPIC_API_KEY).' })
    }

    const buffer = await getSourceBuffer(map.sourceDocPath)
    const mime = /\.pdf$/i.test(map.sourceDocName || map.sourceDocPath) ? 'application/pdf' : 'image/png'
    const structure = await credFormStructure.analyzeFormStructure([{ buffer, mimeType: mime }])
    const stats = credFormStructure.structureStats(structure)

    // Empty result = the reader couldn't parse the form (scanned images, or so
    // long the output was exhausted). Don't overwrite a prior good structure
    // with nothing, and never report an empty form as "ready".
    if (stats.sections === 0 || stats.total === 0) {
      await logMapAccess(req, map.id, 'CREDMAP_STRUCTURE_BUILD_EMPTY', '0 sections')
      return res.status(422).json({
        error: 'SNAP couldn’t read this form’s fields — it may be scanned images or unusually long. The clean packet and “Fill their PDF” paths still work.',
        stats,
      })
    }

    await prisma.credProgramMap.update({ where: { id: map.id }, data: { formStructure: structure } })
    await logMapAccess(req, map.id, 'CREDMAP_STRUCTURE_BUILD', `${stats.sections} sections · ${stats.total} fields${structure.truncated ? ' (truncated)' : ''}`)
    res.json({ ok: true, structure, stats, truncated: Boolean(structure.truncated) })
  } catch (err) {
    console.error('[credmap/structure-build] error:', err)
    res.status(500).json({ error: 'Failed to build the native form' })
  }
})

// GET /:id/form-structure?npi= — the stored native template + counts, and (with
// npi) a live preview of what each field resolves to for a provider: passport
// values + that provider's saved answers.
router.get('/:id/form-structure', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const structure = map.formStructure && Array.isArray(map.formStructure.sections) ? map.formStructure : null
    if (!structure) return res.json({ structure: null, stats: credFormStructure.structureStats(null) })

    const { resolveValue } = require('../services/credMapPdf')
    let passport = null
    let answers = {}
    const npi = String(req.query.npi || '').replace(/\D/g, '')
    if (npi) {
      if (passportClient.isConfigured()) {
        try { passport = await passportClient.getPassport(npi, req.facilityId) } catch { /* preview only */ }
      }
      const rows = await prisma.credFormAnswer.findMany({ where: { facilityId: req.facilityId, npi } })
      answers = Object.fromEntries(rows.map((a) => [a.questionKey, a.value]))
    }

    // Attach a resolved preview value per field (null when no npi requested).
    const sections = structure.sections.map((sec) => ({
      heading: sec.heading,
      description: sec.description || null,
      fields: (sec.fields || []).map((f) => {
        const qk = credFormStructure.questionKeyFor(f, map.id)
        let preview = null
        if (npi) {
          if (f.source === 'PASSPORT') preview = passport ? resolveValue(f.valueKey, passport) : ''
          else if (f.source === 'PROVIDER' || f.source === 'ATTESTATION') {
            preview = answers[qk] || ''
            // Canonical attestation answered on another facility's form carries
            // over from the passport.
            if (!preview && f.source === 'ATTESTATION' && f.canonicalAttestation && f.canonicalAttestation !== 'OTHER') {
              preview = passport?.sections?.attestations?.[f.canonicalAttestation]?.value || ''
            }
          }
        }
        return { ...f, questionKey: qk, preview }
      }),
    }))
    res.json({ structure: { ...structure, sections }, stats: credFormStructure.structureStats(structure) })
  } catch (err) {
    console.error('[credmap/structure-get] error:', err)
    res.status(500).json({ error: 'Failed to load the native form' })
  }
})

// PATCH /:id/form-structure — save coordinator edits to the native template
// (full replace of the sections array; the shape is re-normalized server-side
// so bad enums / missing keys can't corrupt it).
router.patch('/:id/form-structure', async (req, res) => {
  try {
    const map = await scopedMap(req, req.params.id)
    if (!map) return res.status(404).json({ error: 'Map not found' })
    const incoming = req.body?.structure
    if (!incoming || !Array.isArray(incoming.sections)) return res.status(400).json({ error: 'structure.sections required' })
    const structure = credFormStructure.normalizeStructure(incoming)
    await prisma.credProgramMap.update({ where: { id: map.id }, data: { formStructure: structure } })
    await logMapAccess(req, map.id, 'CREDMAP_STRUCTURE_EDIT', `${structure.sections.length} sections`)
    res.json({ ok: true, structure, stats: credFormStructure.structureStats(structure) })
  } catch (err) {
    console.error('[credmap/structure-edit] error:', err)
    res.status(500).json({ error: 'Failed to save the native form' })
  }
})

// POST /packets/one/:packetId/render — produce the filled facility PDF: the
// facility's exact form, typed full of the provider's live passport data,
// e-signature stamped on signature lines. Field mapping is AI-built once per
// map and reused for every provider.
router.post('/packets/one/:packetId/render', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      include: { map: true },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured' })

    let passport
    try {
      passport = await passportClient.getPassport(packet.npi, req.facilityId)
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        return res.status(400).json({ error: 'Passport access is required to fill the form — invite the provider or request access first.' })
      }
      throw err
    }

    // engine=native → SNAP's own document mirroring the facility's application
    // (the scalable default when a form structure exists). Otherwise the
    // overlay/AcroForm/clean-packet auto-path.
    const engine = req.body?.engine === 'native' ? 'native' : undefined
    const { renderFilledPdf } = require('../services/credMapPdf')
    const result = await renderFilledPdf({ packet, map: packet.map, passport, engine })
    await logMapAccess(req, packet.mapId, engine === 'native' ? 'CREDMAP_NATIVE_RENDER' : 'CREDMAP_PDF_RENDER', result.generatedDocName)
    res.json({ ok: true, ...result, docToken: signDocToken(result.generatedDocPath) })
  } catch (err) {
    if (['NOT_CONFIGURED', 'NO_SOURCE_DOC', 'NOT_FILLABLE'].includes(err.code)) {
      return res.status(400).json({ error: err.message, code: err.code })
    }
    console.error('[credmap/packet-render] error:', err)
    res.status(500).json({ error: 'Failed to render the filled PDF' })
  }
})

// PATCH /packets/one/:packetId — status transitions. Marking SENT stamps the
// appointment clock (nextDueAt = now + map cycle) for renewal tracking.
router.patch('/packets/one/:packetId', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      include: { map: { select: { recredCycleMonths: true } } },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    const { status } = req.body || {}
    if (!['IN_PROGRESS', 'READY', 'SENT'].includes(status)) return res.status(400).json({ error: 'Invalid status' })

    const updated = await prisma.credPacket.update({ where: { id: packet.id }, data: { status } })
    if (status === 'SENT') {
      // Sent ≠ appointed: the facility's board sets the real appointment date.
      // Ensure the provider is on the renewal dashboard as "awaiting date" —
      // never overwrite dates a coordinator has recorded.
      await prisma.credAppointment.upsert({
        where: { mapId_npi: { mapId: packet.mapId, npi: packet.npi } },
        create: { facilityId: packet.facilityId, mapId: packet.mapId, npi: packet.npi, providerName: packet.providerName },
        update: { providerName: packet.providerName || undefined },
      })
      await logMapAccess(req, packet.mapId, 'CREDMAP_PACKET_SENT', `${packet.providerName || packet.npi}`)
    }
    res.json({ packet: updated })
  } catch (err) {
    console.error('[credmap/packet-update] error:', err)
    res.status(500).json({ error: 'Failed to update packet' })
  }
})

// PATCH /packets/one/:packetId/tasks/:taskId — coordinator works the gap list.
router.patch('/packets/one/:packetId/tasks/:taskId', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId }, select: { id: true },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    const task = await prisma.credPacketTask.findFirst({ where: { id: req.params.taskId, packetId: packet.id } })
    if (!task) return res.status(404).json({ error: 'Task not found' })

    const { status, assignee, note } = req.body || {}
    const data = {}
    if (status !== undefined) {
      if (!['AUTO_FILLED', 'NEEDS_DOCUMENT', 'NEEDS_SIGNATURE', 'NEEDS_ACTION', 'WAIVED', 'DONE'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      data.status = status
      data.completedAt = COMPLETE_STATUSES.includes(status) ? new Date() : null
    }
    if (assignee !== undefined) {
      if (!['COORDINATOR', 'PROVIDER'].includes(assignee)) return res.status(400).json({ error: 'Invalid assignee' })
      data.assignee = assignee
    }
    if (note !== undefined) data.note = note ? String(note).trim().slice(0, 300) : null

    await prisma.credPacketTask.update({ where: { id: task.id }, data })
    const tasks = await prisma.credPacketTask.findMany({ where: { packetId: packet.id }, select: { status: true } })
    const completeness = completenessOf(tasks)
    await prisma.credPacket.update({ where: { id: packet.id }, data: { completeness } })
    res.json({ ok: true, completeness })
  } catch (err) {
    console.error('[credmap/task-update] error:', err)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// DELETE /packets/one/:packetId — remove a packet (its tasks and signature
// audit rows go with it). Used for demo resets and misfires; the map and the
// passport are untouched.
router.delete('/packets/one/:packetId', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      select: { id: true, mapId: true, providerName: true, npi: true },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    await prisma.$transaction([
      prisma.credSignature.deleteMany({ where: { packetId: packet.id } }),
      prisma.credPacketTask.deleteMany({ where: { packetId: packet.id } }),
      prisma.credPacket.delete({ where: { id: packet.id } }),
    ])
    await logMapAccess(req, packet.mapId, 'CREDMAP_PACKET_DELETE', packet.providerName || packet.npi)
    res.json({ ok: true })
  } catch (err) {
    console.error('[credmap/packet-delete] error:', err)
    res.status(500).json({ error: 'Failed to delete packet' })
  }
})

// POST /packets/one/:packetId/sign-link — mint the provider sign link (one
// link clears every open e-signable signature task) and email it to the
// provider's SNAP account address when we have one. Always returns the link
// so the coordinator can copy/text it herself (SMS rides Twilio approval).
router.post('/packets/one/:packetId/sign-link', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      include: { map: { select: { name: true } }, tasks: { include: { item: { select: { fulfillment: true, esignOk: true } } } } },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    const openSignatures = packet.tasks.filter(
      (t) => t.status === 'NEEDS_SIGNATURE' && t.item.fulfillment === 'SIGNATURE' && t.item.esignOk
    )
    if (openSignatures.length === 0) {
      return res.status(400).json({ error: 'No open e-signable signature items on this packet.' })
    }

    const { signLinkToken } = require('./sign')
    const token = signLinkToken(packet.id)
    const base = (process.env.APP_URL || 'https://ai.snapmedical.app').replace(/\/$/, '')
    const link = `${base}/sign/${encodeURIComponent(token)}`

    let emailedTo = null
    const rosterEntry = await prisma.internalRosterEntry.findFirst({
      where: { facilityId: req.facilityId, npi: packet.npi },
      select: { snapAccountEmail: true, providerName: true },
    })
    if (rosterEntry?.snapAccountEmail) {
      try {
        const { sendSignatureRequest } = require('../services/credentialEmail')
        await sendSignatureRequest(
          rosterEntry.snapAccountEmail,
          packet.providerName || rosterEntry.providerName || 'there',
          packet.map?.name || 'Your facility',
          openSignatures.length,
          link
        )
        emailedTo = rosterEntry.snapAccountEmail
      } catch (err) {
        console.error('[credmap/sign-link] email failed (link still returned):', err.message)
      }
    }
    await logMapAccess(req, packet.mapId, 'CREDMAP_SIGN_LINK_SENT', `${packet.providerName || packet.npi} (${openSignatures.length} items)`)
    res.json({ link, emailedTo, itemCount: openSignatures.length })
  } catch (err) {
    console.error('[credmap/sign-link] error:', err)
    res.status(500).json({ error: 'Failed to create sign link' })
  }
})

// POST /packets/one/:packetId/refresh — re-run the auto-fill pass against the
// passport as it is NOW (e.g. the provider just uploaded a new certificate).
// Only touches AUTO_PASSPORT tasks that aren't manually resolved.
router.post('/packets/one/:packetId/refresh', async (req, res) => {
  try {
    const packet = await prisma.credPacket.findFirst({
      where: { id: req.params.packetId, facilityId: req.facilityId },
      include: { tasks: { include: { item: true } } },
    })
    if (!packet) return res.status(404).json({ error: 'Packet not found' })
    const summary = await passportSummaryFor(packet.facilityId, packet.npi)
    let changed = 0
    for (const t of packet.tasks) {
      if (t.item.fulfillment !== 'AUTO_PASSPORT') continue
      if (['DONE', 'WAIVED'].includes(t.status)) continue // coordinator's call stands
      const plan = planTask(t.item, summary)
      if (plan.status !== t.status) {
        await prisma.credPacketTask.update({
          where: { id: t.id },
          data: { status: plan.status, note: plan.note || null, completedAt: COMPLETE_STATUSES.includes(plan.status) ? new Date() : null },
        })
        changed++
      }
    }
    const tasks = await prisma.credPacketTask.findMany({ where: { packetId: packet.id }, select: { status: true } })
    const completeness = completenessOf(tasks)
    await prisma.credPacket.update({ where: { id: packet.id }, data: { completeness } })
    res.json({ ok: true, changed, completeness })
  } catch (err) {
    console.error('[credmap/packet-refresh] error:', err)
    res.status(500).json({ error: 'Failed to refresh packet' })
  }
})

module.exports = router
