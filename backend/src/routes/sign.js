/**
 * Provider sign-link — public, token-gated (no login), 2026-07-22.
 *
 * The RFX bar (locked UX standard): notification → link → read → tap Sign →
 * signature pad → complete. One link clears every open e-signable signature
 * task on the packet. The JWT token is the credential (same trust shape as
 * /api/avail); wet-ink items are never included. Every signature lands a
 * CredSignature audit row: signer name, recorded consent text, timestamp,
 * IP, user-agent — the evidentiary base the packet export stamps from.
 */

const express = require('express')
const jwt = require('jsonwebtoken')
const prisma = require('../config/db')
const { JWT_SECRET } = require('../config/env')

const router = express.Router()

const TOKEN_TTL = '14d'
const MAX_SIGNATURE_BYTES = 300 * 1024 // drawn-signature PNG data URL cap

const CONSENT_TEXT =
  'I agree to conduct this transaction electronically, and I intend the signature I draw here to be my legal signature applied to each document listed above.'

function signLinkToken(packetId) {
  return jwt.sign({ packetId, type: 'credsign' }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

function verifyLinkToken(token) {
  const payload = jwt.verify(token, JWT_SECRET)
  if (payload.type !== 'credsign') throw new Error('Invalid token type')
  return payload.packetId
}

// Open, e-signable signature tasks on a packet.
function signableTasks(packet) {
  return packet.tasks.filter(
    (t) => t.status === 'NEEDS_SIGNATURE' && t.item.fulfillment === 'SIGNATURE' && t.item.esignOk
  )
}

async function loadPacket(packetId) {
  return prisma.credPacket.findUnique({
    where: { id: packetId },
    include: {
      map: { select: { name: true, sourceDocPath: true, sourceDocName: true } },
      tasks: { include: { item: true } },
    },
  })
}

// GET /api/sign/:token — what the provider sees when the link opens.
router.get('/:token', async (req, res) => {
  try {
    let packetId
    try {
      packetId = verifyLinkToken(req.params.token)
    } catch {
      return res.status(401).json({ error: 'This signing link is invalid or has expired. Ask your coordinator to send a fresh one.' })
    }
    const packet = await loadPacket(packetId)
    if (!packet) return res.status(404).json({ error: 'This packet no longer exists.' })

    const open = signableTasks(packet)
    res.json({
      providerName: packet.providerName,
      facilityName: packet.map?.name || 'your facility',
      cycle: packet.cycle,
      consentText: CONSENT_TEXT,
      // The facility's actual form, reviewable before signing.
      sourceDoc: packet.map?.sourceDocPath && process.env.AWS_S3_BUCKET
        ? { name: packet.map.sourceDocName || 'Facility form' }
        : null,
      items: open
        .sort((a, b) => (a.item.position ?? 0) - (b.item.position ?? 0))
        .map((t) => ({ taskId: t.id, label: t.item.label, section: t.item.section, notes: t.item.notes })),
      alreadyComplete: open.length === 0,
    })
  } catch (err) {
    console.error('[sign/get] error:', err)
    res.status(500).json({ error: 'Failed to load signing request' })
  }
})

// GET /api/sign/:token/document — review the facility's form before signing.
// The sign token is the credential; redirects to a short-lived presigned URL.
router.get('/:token/document', async (req, res) => {
  try {
    let packetId
    try {
      packetId = verifyLinkToken(req.params.token)
    } catch {
      return res.status(401).json({ error: 'This signing link is invalid or has expired.' })
    }
    const packet = await loadPacket(packetId)
    const key = packet?.map?.sourceDocPath
    if (!key || !process.env.AWS_S3_BUCKET) return res.status(404).json({ error: 'No document available' })

    const { GetObjectCommand } = require('@aws-sdk/client-s3')
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
    const { clientForBucket } = require('../services/s3Buckets')
    const s3 = await clientForBucket(process.env.AWS_S3_BUCKET)
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }), { expiresIn: 900 })
    res.redirect(url)
  } catch (err) {
    console.error('[sign/document] error:', err)
    res.status(500).json({ error: 'Failed to open document' })
  }
})

// POST /api/sign/:token/complete — apply the drawn signature to the SELECTED
// open e-signable signature tasks (default: all), with the audit row per
// task. Unselected items stay pending — the coordinator can resend a fresh
// link for them any time.
router.post('/:token/complete', async (req, res) => {
  try {
    let packetId
    try {
      packetId = verifyLinkToken(req.params.token)
    } catch {
      return res.status(401).json({ error: 'This signing link is invalid or has expired.' })
    }
    const packet = await loadPacket(packetId)
    if (!packet) return res.status(404).json({ error: 'This packet no longer exists.' })

    const { signerName, signatureDataUrl, consent } = req.body || {}
    if (!consent) return res.status(400).json({ error: 'Please agree to sign electronically first.' })
    const name = String(signerName || '').trim().slice(0, 120)
    if (!name) return res.status(400).json({ error: 'Please type your full legal name.' })
    const sig = String(signatureDataUrl || '')
    if (!sig.startsWith('data:image/png;base64,') || sig.length < 500) {
      return res.status(400).json({ error: 'Please draw your signature first.' })
    }
    if (sig.length > MAX_SIGNATURE_BYTES) return res.status(400).json({ error: 'Signature image is too large — try again.' })

    const open = signableTasks(packet)
    if (open.length === 0) return res.json({ ok: true, signed: 0, remaining: 0, alreadyComplete: true })

    // Optional subset: sign only the checked items; ids must be open tasks.
    let selected = open
    if (Array.isArray(req.body.taskIds)) {
      const wanted = new Set(req.body.taskIds.map(String))
      selected = open.filter((t) => wanted.has(t.id))
      if (selected.length === 0) return res.status(400).json({ error: 'Select at least one document to sign.' })
    }

    const now = new Date()
    const dateLabel = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
    await prisma.$transaction([
      ...selected.map((t) =>
        prisma.credPacketTask.update({
          where: { id: t.id },
          data: { status: 'DONE', completedAt: now, note: `Signed electronically by ${name} · ${dateLabel}` },
        })
      ),
      ...selected.map((t) =>
        prisma.credSignature.create({
          data: {
            facilityId: packet.facilityId,
            packetId: packet.id,
            taskId: t.id,
            npi: packet.npi,
            signerName: name,
            signatureData: sig,
            consentText: CONSENT_TEXT,
            ipAddress: req.ip || null,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
            signedAt: now,
          },
        })
      ),
    ])

    // Recompute completeness with the freshly-signed tasks.
    const tasks = await prisma.credPacketTask.findMany({ where: { packetId: packet.id }, select: { status: true } })
    const done = tasks.filter((t) => ['AUTO_FILLED', 'DONE', 'WAIVED'].includes(t.status)).length
    const completeness = tasks.length ? Math.round((done / tasks.length) * 100) : 0
    await prisma.credPacket.update({ where: { id: packet.id }, data: { completeness } })

    res.json({ ok: true, signed: selected.length, remaining: open.length - selected.length })
  } catch (err) {
    console.error('[sign/complete] error:', err)
    res.status(500).json({ error: 'Signing failed — please try again' })
  }
})

module.exports = router
module.exports.signLinkToken = signLinkToken
