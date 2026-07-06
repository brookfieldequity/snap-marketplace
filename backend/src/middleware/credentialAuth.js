const jwt = require('jsonwebtoken')
const prisma = require('../config/db')
const { JWT_SECRET } = require('../config/env')
const { assertSession, issueSession, TTL_JWT } = require('../services/authSessions')
const { sendSessionExpired } = require('./sessionUtil')

// Credentialing-portal JWT verify + server-side session check (Security
// HIGH-1), then the existing CredentialUser load. Short-lived doc tokens
// (signDocToken/verifyDocToken) stay stateless — they're 15-minute,
// single-purpose S3 links, not login sessions.
module.exports = async function credentialAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = header.slice(7)
  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET)
  } catch {
    return sendSessionExpired(res, 'CREDENTIAL')
  }
  if (payload.type !== 'credential') {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await assertSession(payload.jti)
  } catch {
    return sendSessionExpired(res, 'CREDENTIAL')
  }

  try {
    const user = await prisma.credentialUser.findUnique({
      where: { id: payload.userId },
      include: { facility: { select: { id: true, name: true } } },
    })
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    req.credUser = user
    req.facilityId = user.facilityId
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Now async — issues the server-side session the middleware checks.
module.exports.sign = async function signCredToken(userId, req) {
  const { jti } = await issueSession({ audience: 'CREDENTIAL', userId, req })
  return jwt.sign({ userId, type: 'credential', jti }, JWT_SECRET, { expiresIn: TTL_JWT.CREDENTIAL })
}

module.exports.signDocToken = function signDocToken(filePath) {
  return jwt.sign({ filePath, type: 'doc' }, JWT_SECRET, { expiresIn: '15m' })
}

module.exports.verifyDocToken = function verifyDocToken(token) {
  const payload = jwt.verify(token, JWT_SECRET)
  if (payload.type !== 'doc') throw new Error('Invalid token type')
  return payload.filePath
}
