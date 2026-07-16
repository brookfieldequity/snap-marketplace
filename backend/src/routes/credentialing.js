const express = require('express')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const prisma = require('../config/db')
const credentialAuth = require('../middleware/credentialAuth')
const { sign, signDocToken, verifyDocToken } = require('../middleware/credentialAuth')
const { sendProviderInvitation, sendDocumentRequest, sendCredentialReminder, sendWelcomeEmail, sendPasswordResetEmail, credTypeName } = require('../services/credentialEmail')
const { overallStatusColor, passportCompletion, nextExpiration, daysUntil } = require('../utils/credentialStatus')
const { getSavings: getAutomationSavings } = require('../services/automationEvents')
const { searchByName: nppesSearchByName } = require('../services/nppesLookup')
const passportClient = require('../services/passportClient')

const router = express.Router()

// ── Document storage ──────────────────────────────────────────────────────────
// ONE SOURCE OF TRUTH / Phase 1 (2026-07-15): new credential documents are
// S3-only, encrypted at rest (SSE-KMS when AWS_KMS_KEY_ID is set, else
// SSE-S3/AES256). The local-disk WRITE path is removed — unencrypted
// PHI-class documents on an ephemeral container disk were both a security
// hole and silent data loss on redeploy. Upload endpoints return 503 when
// AWS_S3_BUCKET is unset. Disk READS remain only to serve any legacy file
// until this store is retired for the passport backend (Phase 3).
const STORAGE_BASE = process.env.CREDENTIAL_STORAGE_PATH || path.join(__dirname, '../../credential_storage')

// Credential documents are PDFs or scanned images only.
const ALLOWED_DOC_EXT = ['.pdf', '.jpg', '.jpeg', '.png']
const ALLOWED_DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png']
const DOC_SIZE_LIMIT = 20 * 1024 * 1024

function docFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (ALLOWED_DOC_EXT.includes(ext) && ALLOWED_DOC_MIME.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only PDF, JPG, and PNG files are allowed'))
  }
}

// Random, sanitized storage name — never trust the client-supplied filename
// in the path (the display name is stored separately as documentName).
function safeStorageName(file) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const suffix = ALLOWED_DOC_EXT.includes(ext) ? ext : ''
  return `${Date.now()}_${crypto.randomUUID()}${suffix}`
}

// Returns a multer instance writing to encrypted S3, or null when document
// storage isn't configured — callers must 503 rather than accept the upload.
// There is deliberately NO disk fallback (see Document storage note above).
function getUpload(facilityId, providerId, credType) {
  if (!process.env.AWS_S3_BUCKET) return null

  const multerS3 = require('multer-s3')
  const { S3Client } = require('@aws-sdk/client-s3')
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', followRegionRedirects: true })
  // Encryption at rest on every object: customer-managed KMS key when
  // configured (rotation + CloudTrail decrypt audit), AES256 floor otherwise.
  const sse = process.env.AWS_KMS_KEY_ID
    ? { serverSideEncryption: 'aws:kms', sseKmsKeyId: process.env.AWS_KMS_KEY_ID }
    : { serverSideEncryption: 'AES256' }
  return multer({
    storage: multerS3({
      s3,
      bucket: process.env.AWS_S3_BUCKET,
      ...sse,
      key: (req, file, cb) =>
        cb(null, `credentials/${facilityId}/${providerId}/${credType}/${safeStorageName(file)}`),
    }),
    limits: { fileSize: DOC_SIZE_LIMIT },
    fileFilter: docFileFilter,
  })
}

const STORAGE_UNCONFIGURED_MSG =
  'Document storage is not configured (encrypted S3 required). Uploads are disabled until AWS_S3_BUCKET is set — documents are never written to server disk.'

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireCoordinator(req, res, next) {
  if (req.credUser.permission !== 'COORDINATOR') {
    return res.status(403).json({ error: 'Coordinator access required' })
  }
  next()
}

function requireNotBilling(req, res, next) {
  if (req.credUser.permission === 'BILLING') {
    return res.status(403).json({ error: 'Access denied' })
  }
  next()
}

// ── Phase 3 freeze (ONE SOURCE OF TRUTH, 2026-07-16) ─────────────────────────
// The local credential store (FacilityRosterEntry / ProviderCredential /
// CredentialVerification / CredentialFlag / FacilityCredentialNote) is FROZEN:
// reads still work so historical data stays visible, but every write returns
// 410 Gone. New credential data lives on the passport backend — see the
// /portal/* and /passport/* endpoints. Tables are retired once CAPA validates
// the passport-backed portal.
const FROZEN_MESSAGE =
  'This action now lives on the credentialing passport (one source of truth). The local credential store is frozen — use the passport-backed portal actions instead.'
const FROZEN_ROUTES = [
  ['POST', /^\/roster$/],
  ['POST', /^\/roster\/bulk$/],
  ['DELETE', /^\/roster\/[^/]+$/],
  ['POST', /^\/roster\/[^/]+\/invite$/],
  ['POST', /^\/(providers|roster)\/[^/]+\/documents\/[^/]+$/],
  ['POST', /^\/(providers|roster)\/[^/]+\/credentials\/[^/]+\/(verify|flag)$/],
  ['DELETE', /^\/(providers|roster)\/[^/]+\/credentials\/[^/]+\/(verify|flag)(\/[^/]+)?$/],
  ['POST', /^\/(providers|roster)\/[^/]+\/notes$/],
]
router.use((req, res, next) => {
  for (const [method, re] of FROZEN_ROUTES) {
    if (req.method === method && re.test(req.path)) {
      return res.status(410).json({ error: FROZEN_MESSAGE, frozen: true })
    }
  }
  next()
})

async function logAccess(facilityId, userId, providerId, action, credentialType = null, documentName = null, req) {
  await prisma.credentialAccessLog.create({
    data: {
      facilityId,
      userId,
      providerId,
      action,
      credentialType,
      documentName,
      ipAddress: req.ip,
    },
  }).catch(() => {})
}

// Build full provider summary for list view
function buildProviderSummary(rosterEntry, credentials) {
  const status = overallStatusColor(credentials)
  const completion = passportCompletion(credentials)
  const nextExp = nextExpiration(credentials)
  const lastUpdated = credentials.reduce((max, c) => {
    const d = new Date(c.updatedAt)
    return d > max ? d : max
  }, new Date(0))

  return {
    rosterId: rosterEntry.id,
    providerId: rosterEntry.providerId,
    npiNumber: rosterEntry.npiNumber,
    firstName: rosterEntry.firstName,
    lastName: rosterEntry.lastName,
    credentialType: rosterEntry.credentialType,
    employmentCategory: rosterEntry.employmentCategory,
    matchStatus: rosterEntry.matchStatus,
    status,
    nextExpiration: nextExp,
    passportCompletion: completion,
    lastUpdated: lastUpdated.getTime() > 0 ? lastUpdated : null,
  }
}

// ── Auth routes ───────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

    const user = await prisma.credentialUser.findUnique({
      where: { email: email.toLowerCase() },
      include: { facility: { select: { id: true, name: true } } },
    })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })
    if (!user.isActive) return res.status(403).json({ error: 'Account is deactivated. Contact admin@snapmedical.app.' })

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

    await prisma.credentialUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const token = await sign(user.id, req)
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        permission: user.permission,
        facilityId: user.facilityId,
        facilityName: user.facility.name,
        forcePasswordChange: user.forcePasswordChange,
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/auth/me', credentialAuth, (req, res) => {
  const u = req.credUser
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    permission: u.permission,
    facilityId: u.facilityId,
    facilityName: u.facility.name,
    forcePasswordChange: u.forcePasswordChange,
  })
})

router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email required' })
    const user = await prisma.credentialUser.findUnique({ where: { email: email.toLowerCase() } })
    // Always return 200 to avoid user enumeration
    if (!user || !user.isActive) return res.json({ message: 'If that email exists, a reset link has been sent.' })
    const token = require('crypto').randomBytes(32).toString('hex')
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await prisma.credentialUser.update({
      where: { id: user.id },
      data: { resetToken: tokenHash, resetTokenExpiresAt: expires },
    })
    const APP_URL = process.env.APP_URL || 'https://snap-marketplace.up.railway.app'
    const resetLink = `${APP_URL}?resetToken=${token}`
    await sendPasswordResetEmail(user.email, user.name, resetLink)
    res.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex')
    const user = await prisma.credentialUser.findFirst({
      where: { resetToken: tokenHash, resetTokenExpiresAt: { gt: new Date() } },
    })
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' })
    const passwordHash = await bcrypt.hash(password, 10)
    await prisma.credentialUser.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null, forcePasswordChange: false },
    })
    res.json({ message: 'Password updated successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/auth/change-password', credentialAuth, async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await prisma.credentialUser.update({
      where: { id: req.credUser.id },
      data: { passwordHash, forcePasswordChange: false },
    })
    res.json({ message: 'Password changed successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── User management (coordinator only) ───────────────────────────────────────

router.get('/users', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const users = await prisma.credentialUser.findMany({
      where: { facilityId: req.facilityId },
      select: { id: true, name: true, email: true, permission: true, createdAt: true, lastLoginAt: true },
      orderBy: { name: 'asc' },
    })
    res.json(users)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/users', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { name, email, permission } = req.body
    if (!name || !email || !permission) {
      return res.status(400).json({ error: 'name, email, permission required' })
    }
    const tempPassword = require('crypto').randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
    const passwordHash = await bcrypt.hash(tempPassword, 10)
    const facility = await prisma.facility.findUnique({ where: { id: req.facilityId }, select: { name: true } })
    const user = await prisma.credentialUser.create({
      data: {
        facilityId: req.facilityId,
        name,
        email: email.toLowerCase(),
        passwordHash,
        permission,
        forcePasswordChange: true,
      },
      select: { id: true, name: true, email: true, permission: true, createdAt: true, forcePasswordChange: true },
    })
    await sendWelcomeEmail(email.toLowerCase(), name, facility?.name || 'your facility', tempPassword)
    res.status(201).json(user)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already in use' })
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/users/:id', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const target = await prisma.credentialUser.findFirst({
      where: { id: req.params.id, facilityId: req.facilityId },
    })
    if (!target) return res.status(404).json({ error: 'Not found' })

    const { name, email, permission, password } = req.body
    const data = {}
    if (name) data.name = name
    if (email) data.email = email.toLowerCase()
    if (permission) data.permission = permission
    if (password) data.passwordHash = await bcrypt.hash(password, 10)

    const user = await prisma.credentialUser.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, permission: true },
    })
    res.json(user)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/users/:id', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    if (req.params.id === req.credUser.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' })
    }
    const target = await prisma.credentialUser.findFirst({
      where: { id: req.params.id, facilityId: req.facilityId },
    })
    if (!target) return res.status(404).json({ error: 'Not found' })
    await prisma.credentialUser.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Roster management ─────────────────────────────────────────────────────────

const CSV_TEMPLATE = 'First Name,Last Name,NPI Number,Credential Type,Employment Category,Department\n'

router.get('/roster/template', credentialAuth, requireCoordinator, (req, res) => {
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="snap-provider-roster-template.csv"')
  res.send(CSV_TEMPLATE + 'Jane,Smith,1234567890,CRNA,Full Time,Main OR\n')
})

router.get('/roster', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const entries = await prisma.facilityRosterEntry.findMany({
      where: { facilityId: req.facilityId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    res.json(entries)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

async function resolveNpiMatch(npiNumber) {
  const provider = await prisma.providerProfile.findUnique({
    where: { npiNumber },
    select: { id: true },
  })
  return provider?.id || null
}

router.post('/roster', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { firstName, lastName, npiNumber, credentialType, employmentCategory, department, notes } = req.body
    if (!firstName || !lastName || !npiNumber) {
      return res.status(400).json({ error: 'firstName, lastName, npiNumber required' })
    }

    const providerId = await resolveNpiMatch(npiNumber)

    const entry = await prisma.facilityRosterEntry.create({
      data: {
        facilityId: req.facilityId,
        providerId,
        npiNumber,
        firstName,
        lastName,
        credentialType: credentialType || 'CRNA',
        employmentCategory: employmentCategory || null,
        department: department || null,
        notes: notes || null,
        matchStatus: providerId ? 'LINKED' : 'NOT_INVITED',
      },
    })
    res.status(201).json(entry)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Provider with this NPI already on roster' })
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/roster/bulk', credentialAuth, requireCoordinator, express.text({ type: 'text/csv' }), async (req, res) => {
  try {
    const lines = req.body.trim().split('\n').filter(Boolean)
    if (lines.length < 2) return res.status(400).json({ error: 'No data rows found' })

    // Skip header row
    const rows = lines.slice(1)
    const results = { created: 0, updated: 0, errors: [] }

    for (const line of rows) {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      const [firstName, lastName, npiNumber, credentialType, employmentCategory, department] = cols
      if (!firstName || !lastName || !npiNumber) {
        results.errors.push(`Skipped row: missing required fields — "${line}"`)
        continue
      }

      try {
        const providerId = await resolveNpiMatch(npiNumber)
        await prisma.facilityRosterEntry.upsert({
          where: { facilityId_npiNumber: { facilityId: req.facilityId, npiNumber } },
          update: { firstName, lastName, credentialType, employmentCategory, department, providerId, matchStatus: providerId ? 'LINKED' : undefined },
          create: {
            facilityId: req.facilityId,
            providerId,
            npiNumber,
            firstName,
            lastName,
            credentialType: credentialType || 'CRNA',
            employmentCategory: employmentCategory || null,
            department: department || null,
            matchStatus: providerId ? 'LINKED' : 'NOT_INVITED',
          },
        })
        results.created++
      } catch {
        results.errors.push(`Error on row: "${line}"`)
      }
    }

    res.json(results)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/roster/:id', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const entry = await prisma.facilityRosterEntry.findUnique({ where: { id: req.params.id } })
    if (!entry || entry.facilityId !== req.facilityId) return res.status(404).json({ error: 'Not found' })
    await prisma.facilityRosterEntry.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/roster/:id/invite', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const entry = await prisma.facilityRosterEntry.findUnique({ where: { id: req.params.id } })
    if (!entry || entry.facilityId !== req.facilityId) return res.status(404).json({ error: 'Not found' })

    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Provider email required for invitation' })

    const facility = await prisma.facility.findUnique({ where: { id: req.facilityId }, select: { name: true } })
    const inviteLink = `${process.env.APP_URL || 'https://snap-marketplace.up.railway.app'}/register`
    const providerName = `${entry.firstName} ${entry.lastName}`

    await sendProviderInvitation(email, providerName, facility.name, inviteLink)

    const updated = await prisma.facilityRosterEntry.update({
      where: { id: req.params.id },
      data: { matchStatus: 'INVITED', invitationSentAt: new Date() },
    })
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Provider list ─────────────────────────────────────────────────────────────

router.get('/providers/summary', credentialAuth, async (req, res) => {
  try {
    const entries = await prisma.facilityRosterEntry.findMany({
      where: { facilityId: req.facilityId },
    })

    const providersWithCreds = await Promise.all(
      entries.filter((e) => e.providerId).map(async (e) => {
        const creds = await prisma.providerCredential.findMany({ where: { providerId: e.providerId } })
        return overallStatusColor(creds)
      })
    )

    const counts = { GREEN: 0, YELLOW: 0, RED: 0 }
    for (const c of providersWithCreds) counts[c] = (counts[c] || 0) + 1

    res.json({
      total: entries.length,
      linked: entries.filter((e) => e.matchStatus === 'LINKED').length,
      invited: entries.filter((e) => e.matchStatus === 'INVITED').length,
      pendingPassport: entries.filter((e) => e.matchStatus !== 'LINKED').length,
      ...counts,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/providers', credentialAuth, async (req, res) => {
  try {
    const { status, credType, search } = req.query
    const permission = req.credUser.permission

    const entries = await prisma.facilityRosterEntry.findMany({
      where: { facilityId: req.facilityId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })

    const results = []
    for (const entry of entries) {
      let creds = []
      if (entry.providerId) {
        creds = await prisma.providerCredential.findMany({ where: { providerId: entry.providerId } })
      } else {
        creds = await prisma.providerCredential.findMany({ where: { rosterId: entry.id } })
      }

      const summary = buildProviderSummary(entry, creds)

      // Filter
      if (search) {
        const q = search.toLowerCase()
        const fullName = `${entry.firstName} ${entry.lastName}`.toLowerCase()
        if (!fullName.includes(q) && !entry.npiNumber.includes(q)) continue
      }
      if (status && summary.status !== status) continue
      if (credType && entry.credentialType !== credType) continue

      // Permission-filtered response
      if (permission === 'BILLING') {
        results.push({
          rosterId: entry.id,
          firstName: entry.firstName,
          lastName: entry.lastName,
          npiNumber: entry.npiNumber,
          matchStatus: entry.matchStatus,
        })
      } else if (permission === 'DEPT_HEAD') {
        results.push({
          rosterId: entry.id,
          providerId: entry.providerId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          credentialType: entry.credentialType,
          status: summary.status,
          passportCompletion: summary.passportCompletion,
          matchStatus: entry.matchStatus,
        })
      } else {
        results.push(summary)
      }
    }

    res.json(results)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/providers/export', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const entries = await prisma.facilityRosterEntry.findMany({
      where: { facilityId: req.facilityId },
      orderBy: [{ lastName: 'asc' }],
    })

    const rows = ['Last Name,First Name,NPI,Credential Type,Employment,Match Status,Overall Status,Passport %,Next Expiration']
    for (const entry of entries) {
      let creds = []
      if (entry.providerId) {
        creds = await prisma.providerCredential.findMany({ where: { providerId: entry.providerId } })
      }
      const summary = buildProviderSummary(entry, creds)
      rows.push([
        entry.lastName,
        entry.firstName,
        entry.npiNumber,
        entry.credentialType,
        entry.employmentCategory || '',
        entry.matchStatus,
        summary.status,
        summary.passportCompletion + '%',
        summary.nextExpiration ? new Date(summary.nextExpiration).toLocaleDateString('en-US') : '',
      ].join(','))
    }

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="providers-${Date.now()}.csv"`)
    res.send(rows.join('\n'))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/providers/:providerId', credentialAuth, async (req, res) => {
  try {
    const permission = req.credUser.permission
    const { providerId } = req.params

    // Verify this provider is on this facility's roster
    const entry = await prisma.facilityRosterEntry.findFirst({
      where: { facilityId: req.facilityId, providerId },
    })
    if (!entry) return res.status(404).json({ error: 'Provider not on roster' })

    await logAccess(req.facilityId, req.credUser.id, providerId, 'VIEW_PROFILE', null, null, req)

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        user: { select: { email: true, createdAt: true } },
        credentials: {
          include: {
            verifications: { where: { facilityId: req.facilityId }, include: { verifiedBy: { select: { name: true } } } },
            flags: { where: { facilityId: req.facilityId, resolvedAt: null } },
            notes: { where: { facilityId: req.facilityId }, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    })

    if (!provider) return res.status(404).json({ error: 'Provider not found' })

    const status = overallStatusColor(provider.credentials)
    const completion = passportCompletion(provider.credentials)
    const nextExp = nextExpiration(provider.credentials)

    if (permission === 'BILLING') {
      return res.json({
        providerId,
        npiNumber: provider.npiNumber,
        firstName: provider.firstName,
        lastName: provider.lastName,
      })
    }

    if (permission === 'DEPT_HEAD') {
      const credSummary = provider.credentials.map((c) => ({
        credentialType: c.credentialType,
        status: c.status,
        expirationDate: c.expirationDate,
      }))
      return res.json({
        providerId,
        firstName: provider.firstName,
        lastName: provider.lastName,
        photoUrl: provider.photoUrl,
        credentialType: entry.credentialType,
        status,
        passportCompletion: completion,
        npiNumber: provider.npiNumber,
        credentials: credSummary,
      })
    }

    // Coordinator — full file
    res.json({
      providerId,
      firstName: provider.firstName,
      lastName: provider.lastName,
      photoUrl: provider.photoUrl,
      specialty: provider.specialty,
      npiNumber: provider.npiNumber,
      email: provider.user.email,
      memberSince: provider.user.createdAt,
      status,
      passportCompletion: completion,
      nextExpiration: nextExp,
      lastUpdated: provider.credentials.reduce((max, c) => {
        const d = new Date(c.updatedAt); return d > max ? d : max
      }, new Date(0)),
      credentials: provider.credentials,
      roster: entry,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Credential actions ────────────────────────────────────────────────────────

router.post('/providers/:providerId/credentials/:type/verify', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { providerId, type } = req.params

    const cred = await prisma.providerCredential.findUnique({
      where: { providerId_credentialType: { providerId, credentialType: type } },
    })
    if (!cred) return res.status(404).json({ error: 'Credential not found' })

    const verification = await prisma.credentialVerification.upsert({
      where: { facilityId_credentialId: { facilityId: req.facilityId, credentialId: cred.id } },
      update: { verifiedById: req.credUser.id, verifiedAt: new Date(), notes: req.body.notes || null },
      create: {
        facilityId: req.facilityId,
        credentialId: cred.id,
        verifiedById: req.credUser.id,
        notes: req.body.notes || null,
      },
      include: { verifiedBy: { select: { name: true } } },
    })
    res.json(verification)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/providers/:providerId/credentials/:type/verify', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { providerId, type } = req.params
    const cred = await prisma.providerCredential.findUnique({
      where: { providerId_credentialType: { providerId, credentialType: type } },
    })
    if (!cred) return res.status(404).json({ error: 'Credential not found' })

    await prisma.credentialVerification.deleteMany({
      where: { facilityId: req.facilityId, credentialId: cred.id },
    })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/providers/:providerId/credentials/:type/flag', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { providerId, type } = req.params
    const cred = await prisma.providerCredential.findUnique({
      where: { providerId_credentialType: { providerId, credentialType: type } },
    })
    if (!cred) return res.status(404).json({ error: 'Credential not found' })

    const flag = await prisma.credentialFlag.create({
      data: {
        facilityId: req.facilityId,
        credentialId: cred.id,
        flaggedById: req.credUser.id,
        notes: req.body.notes || null,
      },
    })
    res.json(flag)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/providers/:providerId/credentials/:type/flag/:flagId', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { count } = await prisma.credentialFlag.updateMany({
      where: { id: req.params.flagId, facilityId: req.facilityId },
      data: { resolvedAt: new Date() },
    })
    if (!count) return res.status(404).json({ error: 'Not found' })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/providers/:providerId/notes', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { noteText, credentialId } = req.body
    if (!noteText?.trim()) return res.status(400).json({ error: 'noteText required' })

    const note = await prisma.facilityCredentialNote.create({
      data: {
        facilityId: req.facilityId,
        providerId: req.params.providerId,
        credentialId: credentialId || null,
        noteText: noteText.trim(),
        createdById: req.credUser.id,
      },
      include: { createdBy: { select: { name: true } } },
    })
    res.status(201).json(note)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/providers/:providerId/remind', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { credentialType, message } = req.body
    if (!credentialType) return res.status(400).json({ error: 'credentialType required' })

    const provider = await prisma.providerProfile.findUnique({
      where: { id: req.params.providerId },
      include: { user: { select: { email: true } } },
    })
    if (!provider?.user?.email) return res.status(400).json({ error: 'Provider has no email on file' })

    const providerName = `${provider.firstName || ''} ${provider.lastName || ''}`.trim()
    await sendCredentialReminder(provider.user.email, providerName, credentialType, message)

    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/providers/:providerId/request-document', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { credentialType, message, toEmail } = req.body
    if (!credentialType || !toEmail) return res.status(400).json({ error: 'credentialType and toEmail required' })

    const provider = await prisma.providerProfile.findUnique({ where: { id: req.params.providerId } })
    const facility = await prisma.facility.findUnique({ where: { id: req.facilityId }, select: { name: true } })
    const providerName = `${provider?.firstName || ''} ${provider?.lastName || ''}`.trim()

    await sendDocumentRequest(toEmail, providerName, credentialType, facility.name, message)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Document upload ───────────────────────────────────────────────────────────

router.post('/providers/:providerId/documents/:type', credentialAuth, requireCoordinator, async (req, res) => {
  const { providerId, type } = req.params

  // Tenant boundary: only accept an upload for a provider on THIS facility's
  // roster, checked BEFORE multer runs so another tenant's shared credential
  // document can't be overwritten (or a stray file written to storage).
  const entry = await prisma.facilityRosterEntry.findFirst({
    where: { facilityId: req.facilityId, providerId },
  })
  if (!entry) return res.status(404).json({ error: 'Provider not on roster' })

  const upload = getUpload(req.facilityId, providerId, type)
  if (!upload) return res.status(503).json({ error: STORAGE_UNCONFIGURED_MSG })
  upload.single('document')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      const filePath = req.file.key
      const updated = await prisma.providerCredential.upsert({
        where: { providerId_credentialType: { providerId, credentialType: type } },
        update: {
          documentPath: filePath,
          documentName: req.file.originalname,
          documentSize: req.file.size,
          documentUploadedAt: new Date(),
          status: 'PENDING',
        },
        create: {
          providerId,
          credentialType: type,
          documentPath: filePath,
          documentName: req.file.originalname,
          documentSize: req.file.size,
          documentUploadedAt: new Date(),
          status: 'PENDING',
        },
      })

      await logAccess(req.facilityId, req.credUser.id, providerId, 'UPLOAD_DOCUMENT', type, req.file.originalname, req)
      res.json({ success: true, credential: updated })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
})

// ── Roster-keyed provider file (unlinked providers) ──────────────────────────

router.get('/roster/:rosterId/file', credentialAuth, async (req, res) => {
  try {
    const { rosterId } = req.params
    const entry = await prisma.facilityRosterEntry.findFirst({
      where: { id: rosterId, facilityId: req.facilityId },
      include: {
        credentials: {
          include: {
            verifications: { where: { facilityId: req.facilityId }, include: { verifiedBy: { select: { name: true } } } },
            flags: { where: { facilityId: req.facilityId, resolvedAt: null } },
            notes: { where: { facilityId: req.facilityId }, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    })
    if (!entry) return res.status(404).json({ error: 'Roster entry not found' })

    const status = overallStatusColor(entry.credentials)
    const completion = passportCompletion(entry.credentials)
    const nextExp = nextExpiration(entry.credentials)

    res.json({
      rosterId: entry.id,
      providerId: null,
      firstName: entry.firstName,
      lastName: entry.lastName,
      npiNumber: entry.npiNumber,
      credentialType: entry.credentialType,
      matchStatus: entry.matchStatus,
      status,
      passportCompletion: completion,
      nextExpiration: nextExp,
      credentials: entry.credentials,
      roster: entry,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/roster/:rosterId/documents/:type', credentialAuth, requireCoordinator, async (req, res) => {
  const { rosterId, type } = req.params
  const upload = getUpload(req.facilityId, `roster_${rosterId}`, type)
  if (!upload) return res.status(503).json({ error: STORAGE_UNCONFIGURED_MSG })

  upload.single('document')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      const entry = await prisma.facilityRosterEntry.findFirst({ where: { id: rosterId, facilityId: req.facilityId } })
      if (!entry) return res.status(404).json({ error: 'Roster entry not found' })

      const filePath = req.file.key
      const updated = await prisma.providerCredential.upsert({
        where: { rosterId_credentialType: { rosterId, credentialType: type } },
        update: {
          documentPath: filePath,
          documentName: req.file.originalname,
          documentSize: req.file.size,
          documentUploadedAt: new Date(),
          status: 'PENDING',
        },
        create: {
          rosterId,
          credentialType: type,
          documentPath: filePath,
          documentName: req.file.originalname,
          documentSize: req.file.size,
          documentUploadedAt: new Date(),
          status: 'PENDING',
        },
      })

      await logAccess(req.facilityId, req.credUser.id, rosterId, 'UPLOAD_DOCUMENT', type, req.file.originalname, req)
      res.json({ success: true, credential: updated })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
})

router.get('/roster/:rosterId/documents/:type/token', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { rosterId, type } = req.params
    // Tenant boundary: the roster entry must belong to THIS facility before we
    // mint a document-access token (mirrors /roster/:rosterId/file).
    const entry = await prisma.facilityRosterEntry.findFirst({ where: { id: rosterId, facilityId: req.facilityId } })
    if (!entry) return res.status(404).json({ error: 'Roster entry not found' })

    const cred = await prisma.providerCredential.findUnique({
      where: { rosterId_credentialType: { rosterId, credentialType: type } },
    })
    if (!cred?.documentPath) return res.status(404).json({ error: 'No document found' })

    await logAccess(req.facilityId, req.credUser.id, rosterId, 'VIEW_DOCUMENT', type, cred.documentName, req)
    const token = signDocToken(cred.documentPath)
    const apiBase = process.env.APP_URL || 'https://api.snapmedical.app'
    res.json({ token, url: `${apiBase}/api/credentialing/doc/${token}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Roster-keyed verify / flag / note / activity
router.post('/roster/:rosterId/credentials/:type/verify', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { rosterId, type } = req.params
    const cred = await prisma.providerCredential.upsert({
      where: { rosterId_credentialType: { rosterId, credentialType: type } },
      update: {},
      create: { rosterId, credentialType: type },
    })
    await prisma.credentialVerification.upsert({
      where: { facilityId_credentialId: { facilityId: req.facilityId, credentialId: cred.id } },
      update: { verifiedById: req.credUser.id, verifiedAt: new Date(), notes: req.body.notes },
      create: { facilityId: req.facilityId, credentialId: cred.id, verifiedById: req.credUser.id, notes: req.body.notes },
    })
    await logAccess(req.facilityId, req.credUser.id, rosterId, 'VERIFY', type, null, req)
    res.json({ success: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }) }
})

router.delete('/roster/:rosterId/credentials/:type/verify', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { rosterId, type } = req.params
    const cred = await prisma.providerCredential.findUnique({ where: { rosterId_credentialType: { rosterId, credentialType: type } } })
    if (cred) await prisma.credentialVerification.deleteMany({ where: { facilityId: req.facilityId, credentialId: cred.id } })
    res.json({ success: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }) }
})

router.post('/roster/:rosterId/credentials/:type/flag', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { rosterId, type } = req.params
    const cred = await prisma.providerCredential.upsert({
      where: { rosterId_credentialType: { rosterId, credentialType: type } },
      update: {},
      create: { rosterId, credentialType: type },
    })
    const flag = await prisma.credentialFlag.create({
      data: { facilityId: req.facilityId, credentialId: cred.id, flaggedById: req.credUser.id, notes: req.body.notes },
    })
    await logAccess(req.facilityId, req.credUser.id, rosterId, 'FLAG', type, null, req)
    res.json({ success: true, flag })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }) }
})

router.delete('/roster/:rosterId/credentials/:type/flag/:flagId', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { count } = await prisma.credentialFlag.updateMany({
      where: { id: req.params.flagId, facilityId: req.facilityId },
      data: { resolvedAt: new Date() },
    })
    if (!count) return res.status(404).json({ error: 'Not found' })
    res.json({ success: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }) }
})

router.post('/roster/:rosterId/notes', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { rosterId } = req.params
    const { noteText, credentialId } = req.body
    const note = await prisma.facilityCredentialNote.create({
      data: { facilityId: req.facilityId, credentialId: credentialId || null, authorId: req.credUser.id, noteText },
    })
    res.json({ success: true, note })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }) }
})

// ── Secure document serving ───────────────────────────────────────────────────

// Generate a temporary document URL (15-min expiry)
router.get('/providers/:providerId/documents/:type/token', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { providerId, type } = req.params

    // Tenant boundary: the provider must be on THIS facility's roster before we
    // mint a document-access token — otherwise any coordinator with a provider
    // id could pull another facility's credential document.
    const entry = await prisma.facilityRosterEntry.findFirst({
      where: { facilityId: req.facilityId, providerId },
    })
    if (!entry) return res.status(404).json({ error: 'Provider not on roster' })

    const cred = await prisma.providerCredential.findUnique({
      where: { providerId_credentialType: { providerId, credentialType: type } },
    })
    if (!cred?.documentPath) return res.status(404).json({ error: 'No document found' })

    await logAccess(req.facilityId, req.credUser.id, providerId, 'VIEW_DOCUMENT', type, cred.documentName, req)

    const token = signDocToken(cred.documentPath)
    const apiBase = process.env.APP_URL || 'https://api.snapmedical.app'
    res.json({ token, url: `${apiBase}/api/credentialing/doc/${token}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Rate-limited document serving endpoint.
// The in-memory Map could grow unbounded in long-running processes if a wide
// IP range hits this — sweep stale entries every minute (anything older than
// 2× the window). Also hard-cap the Map size at 5000 entries as a backstop
// for sudden bursts; oldest gets evicted via the natural Map iteration order.
const docRequestCounts = new Map()
const DOC_RATE_LIMIT_WINDOW_MS = 60000
const DOC_RATE_LIMIT_MAP_CAP = 5000
setInterval(() => {
  const cutoff = Date.now() - 2 * DOC_RATE_LIMIT_WINDOW_MS
  for (const [ip, record] of docRequestCounts) {
    if (record.start < cutoff) docRequestCounts.delete(ip)
  }
}, DOC_RATE_LIMIT_WINDOW_MS).unref()

router.get('/doc/:token', async (req, res) => {
  const ip = req.ip
  const now = Date.now()
  const window = DOC_RATE_LIMIT_WINDOW_MS
  const limit = 20

  // Backstop: if the Map ever grows past the cap (DoS-style flood), evict
  // the oldest insertion. Map iteration order is insertion order.
  if (docRequestCounts.size > DOC_RATE_LIMIT_MAP_CAP) {
    const oldestKey = docRequestCounts.keys().next().value
    if (oldestKey != null) docRequestCounts.delete(oldestKey)
  }

  const record = docRequestCounts.get(ip) || { count: 0, start: now }
  if (now - record.start > window) {
    docRequestCounts.set(ip, { count: 1, start: now })
  } else if (record.count >= limit) {
    return res.status(429).json({ error: 'Rate limit exceeded' })
  } else {
    record.count++
    docRequestCounts.set(ip, record)
  }

  try {
    const filePath = verifyDocToken(req.params.token)

    if (process.env.AWS_S3_BUCKET) {
      const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
      const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', followRegionRedirects: true })
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: filePath }), { expiresIn: 900 })
      return res.redirect(url)
    }

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
    res.sendFile(path.resolve(filePath))
  } catch {
    res.status(401).json({ error: 'Expired or invalid document link' })
  }
})

// ── Activity log ──────────────────────────────────────────────────────────────

router.get('/providers/:providerId/activity', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const logs = await prisma.credentialAccessLog.findMany({
      where: { facilityId: req.facilityId, providerId: req.params.providerId },
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
      take: 100,
    })

    const notes = await prisma.facilityCredentialNote.findMany({
      where: { facilityId: req.facilityId, providerId: req.params.providerId },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    const verifications = await prisma.credentialVerification.findMany({
      where: { facilityId: req.facilityId, credential: { providerId: req.params.providerId } },
      include: { verifiedBy: { select: { name: true } }, credential: { select: { credentialType: true } } },
      orderBy: { verifiedAt: 'desc' },
    })

    const activity = [
      ...logs.map((l) => ({ type: 'access', action: l.action, credentialType: l.credentialType, by: l.user.name, at: l.timestamp })),
      ...notes.map((n) => ({ type: 'note', action: 'Note added', credentialType: n.credentialId ? 'credential' : null, by: n.createdBy.name, at: n.createdAt, note: n.noteText })),
      ...verifications.map((v) => ({ type: 'verification', action: 'Credential verified', credentialType: v.credential.credentialType, by: v.verifiedBy.name, at: v.verifiedAt })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at))

    res.json(activity)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Audit log ─────────────────────────────────────────────────────────────────

router.get('/audit', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { page = 1, limit = 50, action, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const where = { facilityId: req.facilityId }
    if (action) where.action = action

    const [rawLogs, total] = await Promise.all([
      prisma.credentialAccessLog.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.credentialAccessLog.count({ where }),
    ])

    // Enrich with provider names from roster entries
    const providerIds = [...new Set(rawLogs.map(l => l.providerId).filter(Boolean))]
    let rosterMap = {}
    if (providerIds.length > 0) {
      const entries = await prisma.facilityRosterEntry.findMany({
        where: { facilityId: req.facilityId, providerId: { in: providerIds } },
        select: { providerId: true, firstName: true, lastName: true, npiNumber: true },
      })
      entries.forEach(e => {
        if (e.providerId) {
          rosterMap[e.providerId] = {
            name: `${e.lastName}, ${e.firstName}`,
            npi: e.npiNumber,
          }
        }
      })
    }

    const logs = rawLogs
      .map(l => ({
        id: l.id,
        createdAt: l.timestamp,
        action: l.action,
        providerName: rosterMap[l.providerId]?.name || null,
        npiNumber: rosterMap[l.providerId]?.npi || null,
        credentialType: l.credentialType,
        performedByName: l.user?.name || null,
        performedByEmail: l.user?.email || null,
        ipAddress: l.ipAddress,
        details: l.documentName,
      }))
      .filter(l => {
        if (!search) return true
        const s = search.toLowerCase()
        return (l.providerName || '').toLowerCase().includes(s)
          || (l.performedByName || '').toLowerCase().includes(s)
          || (l.performedByEmail || '').toLowerCase().includes(s)
      })

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/credentialing/savings
 *
 * Cost-savings widget on the credentialing facility portal dashboard.
 * Same shape as /api/automation-events/savings; this one is scoped via
 * credentialAuth instead of facilityAuth so credentialing-portal
 * coordinators (who have a separate token + token table) can hit it
 * without switching auth flows.
 */
router.get('/savings', credentialAuth, async (req, res) => {
  try {
    const savings = await getAutomationSavings({ facilityId: req.facilityId })
    res.json(savings)
  } catch (err) {
    console.error('[credentialing/savings] error:', err)
    res.status(500).json({ error: 'Failed to load savings.' })
  }
})

// GET /npi-search?firstName=Jane&lastName=Smith — proxy NPPES search through
// the backend to avoid browser CORS restrictions on the government API.
router.get('/npi-search', credentialAuth, async (req, res) => {
  try {
    const { firstName = '', lastName = '' } = req.query
    if (!lastName.trim()) return res.status(400).json({ error: 'lastName is required' })
    const matches = await nppesSearchByName({ firstName: firstName.trim(), lastName: lastName.trim() })
    res.json({ matches })
  } catch (err) {
    console.error('[credentialing/npi-search] error:', err)
    res.status(500).json({ error: 'NPI lookup failed' })
  }
})

// GET /provider/:providerId/cme — CME history for a provider (proxied from passport)
router.get('/provider/:providerId/cme', credentialAuth, async (req, res) => {
  try {
    // Tenant-scoped: the credential must belong to this facility via its
    // roster entry or provider profile. (Was unscoped + selected a
    // nonexistent `npi` field — FacilityRosterEntry's field is `npiNumber`.)
    const provider = await prisma.providerCredential.findFirst({
      where: {
        id: req.params.providerId,
        OR: [
          { rosterEntry: { facilityId: req.facilityId } },
          { provider: { rosterEntries: { some: { facilityId: req.facilityId } } } },
        ],
      },
      include: {
        rosterEntry: { select: { npiNumber: true } },
        provider: { select: { npiNumber: true } },
      },
    })
    const npi = provider?.rosterEntry?.npiNumber || provider?.provider?.npiNumber
    if (!npi) return res.json({ entries: [], totalHours: 0, found: false })
    if (!passportClient.isConfigured()) return res.json({ entries: [], totalHours: 0, found: false, bridgeUnconfigured: true })
    const data = await passportClient.getCmeHistory(npi)
    res.json(data)
  } catch (err) {
    console.error('[credentialing/cme] error:', err)
    res.status(500).json({ error: 'Failed to fetch CME history' })
  }
})

// GET /roster/:rosterId/cme — CME history looked up via roster entry NPI
router.get('/roster/:rosterId/cme', credentialAuth, async (req, res) => {
  try {
    // findFirst + facilityId so one facility can never read another's roster.
    const entry = await prisma.facilityRosterEntry.findFirst({
      where: { id: req.params.rosterId, facilityId: req.facilityId },
      select: { npiNumber: true },
    })
    const npi = entry?.npiNumber
    if (!npi) return res.json({ entries: [], totalHours: 0, found: false })
    if (!passportClient.isConfigured()) return res.json({ entries: [], totalHours: 0, found: false, bridgeUnconfigured: true })
    const data = await passportClient.getCmeHistory(npi)
    res.json(data)
  } catch (err) {
    console.error('[credentialing/cme] error:', err)
    res.status(500).json({ error: 'Failed to fetch CME history' })
  }
})

// ── Passport bridge (ONE SOURCE OF TRUTH, Phase 1) ───────────────────────────
// The coordinator portal reads credential data LIVE from the snap-credentialing
// passport backend — documents stream via short-lived URLs presigned by the
// passport service (which audits every issuance). Nothing is copied or stored
// locally. These three endpoints are the portal's pipe into the passport and
// the seed of the Phase 3 zero-storage viewer.

// GET /passport/:npi/status — does a passport exist, and do we have a grant?
// Returns grant-absence as data (not an error) so the UI can render
// "Request access" instead of an error state.
router.get('/passport/:npi/status', credentialAuth, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.json({ bridgeUnconfigured: true })
    const status = await passportClient.getGrantStatus(req.params.npi, req.facilityId)
    res.json(status)
  } catch (err) {
    console.error('[credentialing/passport-status] error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Passport status lookup failed' })
  }
})

// GET /passport/:npi — the provider's passport, scope-filtered by our grant.
// Credentials + verifications + presigned document URLs, straight from the
// source of truth.
router.get('/passport/:npi', credentialAuth, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured', bridgeUnconfigured: true })
    const passport = await passportClient.getPassport(req.params.npi, req.facilityId)
    res.json(passport)
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      // No grant / no passport — structured so the UI can offer "Request access".
      return res.status(err.status).json({ error: err.message, hint: err.hint || null })
    }
    console.error('[credentialing/passport] error:', err)
    res.status(500).json({ error: 'Failed to load passport' })
  }
})

// POST /passport/:npi/request-access — ask the provider to grant this
// facility access (push notification → provider approves in the app).
router.post('/passport/:npi/request-access', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured', bridgeUnconfigured: true })
    const facility = await prisma.facility.findUnique({
      where: { id: req.facilityId },
      select: { name: true },
    })
    const result = await passportClient.requestGrant(req.params.npi, req.facilityId, {
      facilityName: facility?.name || 'A SNAP facility',
    })
    res.json(result)
  } catch (err) {
    console.error('[credentialing/passport-request] error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Grant request failed' })
  }
})

// ── Phase 3: the zero-storage portal surface ─────────────────────────────────
// The portal's roster is the marketplace's ONE roster (InternalRosterEntry —
// the same one Shifts uses); credential data comes live from the passport in
// a single batch round-trip. Nothing credential-shaped is stored locally.

// GET /portal/roster — clinical roster + passport summary merged by NPI.
router.get('/portal/roster', credentialAuth, async (req, res) => {
  try {
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facilityId, isNonClinical: false, providerType: { not: null } },
      select: {
        id: true, providerName: true, providerType: true, npi: true,
        employmentCategory: true, credentialingStatus: true, inviteSentAt: true,
        externallyCredentialed: true, snapAccountEmail: true, phoneNumber: true,
      },
      orderBy: { providerName: 'asc' },
    })

    let summariesByNpi = new Map()
    let bridgeUnconfigured = false
    const npis = entries.map((e) => e.npi).filter(Boolean)
    if (!passportClient.isConfigured()) {
      bridgeUnconfigured = true
    } else if (npis.length > 0) {
      try {
        const { summaries } = await passportClient.batchSummary(req.facilityId, npis)
        summariesByNpi = new Map(summaries.map((s) => [s.npi, s]))
      } catch (err) {
        console.error('[credentialing/portal-roster] batch summary failed:', err.message)
        // Roster still renders; passport columns show as unavailable.
      }
    }

    res.json({
      bridgeUnconfigured,
      roster: entries.map((e) => ({
        ...e,
        passport: e.npi ? summariesByNpi.get(e.npi) || null : null,
      })),
    })
  } catch (err) {
    console.error('[credentialing/portal-roster] error:', err)
    res.status(500).json({ error: 'Failed to load roster' })
  }
})

// POST /portal/roster/:rosterId/invite — invite a roster provider to claim
// their passport. Same pipeline the facility portal uses (one invite flow),
// keyed on the shared InternalRosterEntry roster.
router.post('/portal/roster/:rosterId/invite', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured', bridgeUnconfigured: true })
    const entry = await prisma.internalRosterEntry.findFirst({
      where: { id: req.params.rosterId, facilityId: req.facilityId },
    })
    if (!entry) return res.status(404).json({ error: 'Roster entry not found' })
    const facility = await prisma.facility.findUnique({
      where: { id: req.facilityId },
      select: { id: true, name: true },
    })
    const { sendCredentialingInvite } = require('./roster')
    const result = await sendCredentialingInvite(entry, facility)
    res.status(result.ok ? 200 : 400).json(result)
  } catch (err) {
    console.error('[credentialing/portal-invite] error:', err)
    res.status(500).json({ error: 'Invite failed' })
  }
})

// PUT /passport/:npi/credentials/:type — coordinator records credential facts
// (e.g. malpractice expiry off the face sheet) straight onto the passport.
router.put('/passport/:npi/credentials/:type', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured', bridgeUnconfigured: true })
    const result = await passportClient.updateCredential(req.params.npi, req.facilityId, req.params.type, req.body || {})
    res.json(result)
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, hint: err.hint || null })
    console.error('[credentialing/passport-credential] error:', err)
    res.status(500).json({ error: 'Failed to save credential' })
  }
})

// POST /passport/:npi/documents — coordinator uploads a document for a
// granted provider; streamed through to the passport's encrypted store.
const portalDocUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
router.post('/passport/:npi/documents', credentialAuth, requireCoordinator, portalDocUpload.single('document'), async (req, res) => {
  try {
    if (!passportClient.isConfigured()) return res.status(503).json({ error: 'Passport bridge is not configured', bridgeUnconfigured: true })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const result = await passportClient.uploadDocument(req.params.npi, req.facilityId, req.file, {
      type: req.body.type,
      credentialType: req.body.credentialType,
    })
    res.status(201).json(result)
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message })
    console.error('[credentialing/passport-doc] error:', err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// ── Phase 4: unified login (SSO from the facility portal) ────────────────────
// A facility ADMIN clicks the "Credentialing" toggle → their facility session
// is exchanged for a credentialing-portal session. Find-or-create keeps a
// CredentialUser row per facility admin (portal roles/audit still work).
// DIRECTION RULE: this is the ONLY bridge, facility → credentialing. Portal-
// only credentialers have no facility account and can never cross back.
const facilityAuth = require('../middleware/facilityAuth')
router.post('/sso-exchange', facilityAuth, async (req, res) => {
  try {
    if (req.facilityRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Facility admin access required for the credentialing portal' })
    }
    const marketplaceUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true, name: true },
    })
    if (!marketplaceUser?.email) return res.status(400).json({ error: 'No email on account' })

    let credUser = await prisma.credentialUser.findFirst({
      where: { facilityId: req.facility.id, email: marketplaceUser.email },
    })
    if (!credUser) {
      credUser = await prisma.credentialUser.create({
        data: {
          facilityId: req.facility.id,
          email: marketplaceUser.email,
          name: marketplaceUser.name || marketplaceUser.email,
          permission: 'COORDINATOR',
          // Random unusable hash — this account authenticates via SSO only
          // (they can still set a password via forgot-password if ever needed).
          passwordHash: await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10),
          forcePasswordChange: false,
        },
      })
    }
    const token = await sign(credUser.id, req)
    res.json({
      token,
      user: { id: credUser.id, email: credUser.email, name: credUser.name, permission: credUser.permission, forcePasswordChange: false },
    })
  } catch (err) {
    console.error('[credentialing/sso-exchange] error:', err)
    res.status(500).json({ error: 'SSO exchange failed' })
  }
})

module.exports = router
