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
      map: { select: { name: true } },
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

// POST /api/sign/:token/complete — apply the drawn signature to every open
// e-signable signature task, with the audit row per task.
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
    if (open.length === 0) return res.json({ ok: true, signed: 0, alreadyComplete: true })

    const now = new Date()
    const dateLabel = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
    await prisma.$transaction([
      ...open.map((t) =>
        prisma.credPacketTask.update({
          where: { id: t.id },
          data: { status: 'DONE', completedAt: now, note: `Signed electronically by ${name} · ${dateLabel}` },
        })
      ),
      ...open.map((t) =>
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

    res.json({ ok: true, signed: open.length })
  } catch (err) {
    console.error('[sign/complete] error:', err)
    res.status(500).json({ error: 'Signing failed — please try again' })
  }
})

module.exports = router
module.exports.signLinkToken = signLinkToken
