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
const credMapIntake = require('../services/credMapIntake')
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

module.exports = router
