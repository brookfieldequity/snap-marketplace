const jwt = require('jsonwebtoken')
const prisma = require('../config/db')
const { JWT_SECRET } = require('../config/env')

module.exports = async function credentialAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.type !== 'credential') {
      return res.status(401).json({ error: 'Unauthorized' })
    }

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

module.exports.sign = function signCredToken(userId) {
  return jwt.sign({ userId, type: 'credential' }, JWT_SECRET, { expiresIn: '12h' })
}

module.exports.signDocToken = function signDocToken(filePath) {
  return jwt.sign({ filePath, type: 'doc' }, JWT_SECRET, { expiresIn: '15m' })
}

module.exports.verifyDocToken = function verifyDocToken(token) {
  const payload = jwt.verify(token, JWT_SECRET)
  if (payload.type !== 'doc') throw new Error('Invalid token type')
  return payload.filePath
}
