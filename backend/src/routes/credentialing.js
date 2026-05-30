const express = require('express')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const prisma = require('../config/db')
const credentialAuth = require('../middleware/credentialAuth')
const { sign, signDocToken, verifyDocToken } = require('../middleware/credentialAuth')
const { sendProviderInvitation, sendDocumentRequest, sendCredentialReminder, credTypeName } = require('../services/credentialEmail')
const { overallStatusColor, passportCompletion, nextExpiration, daysUntil } = require('../utils/credentialStatus')

const router = express.Router()

// ── Document storage ──────────────────────────────────────────────────────────
// TODO: migrate to AWS S3 with encryption before production deployment.
// Set AWS_S3_BUCKET env var to automatically switch from local to S3 storage.
const STORAGE_BASE = process.env.CREDENTIAL_STORAGE_PATH || path.join(__dirname, '../../credential_storage')

function getUpload(facilityId, providerId, credType) {
  if (process.env.AWS_S3_BUCKET) {
    // S3 storage — multer-s3 wired up when AWS_S3_BUCKET is set
    const multerS3 = require('multer-s3')
    const { S3Client } = require('@aws-sdk/client-s3')
    const s3 = new S3Client({})
    return multer({
      storage: multerS3({
        s3,
        bucket: process.env.AWS_S3_BUCKET,
        key: (req, file, cb) =>
          cb(null, `credentials/${facilityId}/${providerId}/${credType}/${Date.now()}_${file.originalname}`),
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    })
  }

  const dir = path.join(STORAGE_BASE, facilityId, providerId, credType)
  fs.mkdirSync(dir, { recursive: true })
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  })
}

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

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

    await prisma.credentialUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const token = sign(user.id)
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        permission: user.permission,
        facilityId: user.facilityId,
        facilityName: user.facility.name,
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
  })
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
    const { name, email, password, permission } = req.body
    if (!name || !email || !password || !permission) {
      return res.status(400).json({ error: 'name, email, password, permission required' })
    }
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.credentialUser.create({
      data: {
        facilityId: req.facilityId,
        name,
        email: email.toLowerCase(),
        passwordHash,
        permission,
      },
      select: { id: true, name: true, email: true, permission: true, createdAt: true },
    })
    res.status(201).json(user)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already in use' })
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/users/:id', credentialAuth, requireCoordinator, async (req, res) => {
  try {
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
    await prisma.credentialFlag.update({
      where: { id: req.params.flagId },
      data: { resolvedAt: new Date() },
    })
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
  const upload = getUpload(req.facilityId, providerId, type)

  upload.single('document')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      const filePath = process.env.AWS_S3_BUCKET ? req.file.key : req.file.path
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

// ── Secure document serving ───────────────────────────────────────────────────

// Generate a temporary document URL (15-min expiry)
router.get('/providers/:providerId/documents/:type/token', credentialAuth, requireCoordinator, async (req, res) => {
  try {
    const { providerId, type } = req.params

    const cred = await prisma.providerCredential.findUnique({
      where: { providerId_credentialType: { providerId, credentialType: type } },
    })
    if (!cred?.documentPath) return res.status(404).json({ error: 'No document found' })

    await logAccess(req.facilityId, req.credUser.id, providerId, 'VIEW_DOCUMENT', type, cred.documentName, req)

    const token = signDocToken(cred.documentPath)
    res.json({ token, url: `/api/credentialing/doc/${token}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Rate-limited document serving endpoint
const docRequestCounts = new Map()
router.get('/doc/:token', async (req, res) => {
  const ip = req.ip
  const now = Date.now()
  const window = 60000
  const limit = 20

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
      const s3 = new S3Client({})
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

module.exports = router
