const REQUIRED_TYPES = [
  'STATE_LICENSE',
  'DEA_CERTIFICATE',
  'MA_CS_LICENSE',
  'BOARD_CERTIFICATION',
  'MALPRACTICE_INSURANCE',
  'ACLS_CERTIFICATION',
  'BLS_CERTIFICATION',
  'NPDB_AUTHORIZATION',
  'CV',
]

const TOTAL_TYPES = 13 // All CredentialType enum values

function daysUntil(date) {
  if (!date) return null
  return (new Date(date) - new Date()) / 86400000
}

function credentialColor(cred) {
  if (!cred) return 'RED' // missing
  const days = daysUntil(cred.expirationDate)
  if (cred.status === 'EXPIRED') return 'RED'
  if (days !== null && days < 0) return 'RED'
  if (days !== null && days <= 30) return 'RED'
  if (days !== null && days <= 90) return 'YELLOW'
  if (cred.status === 'PENDING') return 'YELLOW'
  return 'GREEN'
}

function overallStatusColor(credentials) {
  const credMap = {}
  for (const c of credentials) credMap[c.credentialType] = c

  // Missing required → RED
  for (const type of REQUIRED_TYPES) {
    if (!credMap[type]) return 'RED'
  }

  // Any expired or expiring ≤ 30 days → RED
  for (const c of credentials) {
    const days = daysUntil(c.expirationDate)
    if (c.status === 'EXPIRED') return 'RED'
    if (days !== null && days < 0) return 'RED'
    if (days !== null && days <= 30) return 'RED'
  }

  // Any expiring ≤ 90 days or pending → YELLOW
  for (const c of credentials) {
    const days = daysUntil(c.expirationDate)
    if (days !== null && days <= 90) return 'YELLOW'
    if (c.status === 'PENDING') return 'YELLOW'
  }

  return 'GREEN'
}

function passportCompletion(credentials) {
  return Math.round((credentials.length / TOTAL_TYPES) * 100)
}

function nextExpiration(credentials) {
  const withExpiry = credentials
    .filter((c) => c.expirationDate && daysUntil(c.expirationDate) > 0)
    .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate))
  return withExpiry[0]?.expirationDate || null
}

module.exports = {
  REQUIRED_TYPES,
  TOTAL_TYPES,
  daysUntil,
  credentialColor,
  overallStatusColor,
  passportCompletion,
  nextExpiration,
}
