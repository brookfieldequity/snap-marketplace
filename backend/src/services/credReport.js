/**
 * Reports (2026-07-23) — the customizable roster export.
 *
 * The credentialer picks specific providers (a facility only credentials a
 * handful) and the columns she wants (license #, DEA, expirations, contact…),
 * and SNAP compiles one spreadsheet: a row per provider, a column per field,
 * pulled live from each provider's passport. Her hand-built spreadsheet,
 * generated and always current — exportable to any facility. CSV or Excel.
 *
 * This is the N-providers × chosen-items face of the same output engine that
 * powers the Complete File (1 provider × everything) and the Facility Packet
 * (1 provider × a facility's requirements).
 */

const passportClient = require('./passportClient')

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// The column catalog. Each field extracts from a provider's full passport.
const FIELDS = [
  { key: 'name', label: 'Provider Name', get: (p) => `${p.provider?.firstName || ''} ${p.provider?.lastName || ''}`.trim() },
  { key: 'npi', label: 'NPI', get: (p) => p.provider?.npi || '' },
  { key: 'specialty', label: 'Specialty', get: (p) => p.provider?.specialty || '' },
  { key: 'email', label: 'Email', get: (p) => p.provider?.email || '' },
  { key: 'phone', label: 'Phone', get: (p) => p.provider?.phone || '' },
  { key: 'address', label: 'Address', get: (p) => [p.provider?.addressStreet, p.provider?.addressCity, p.provider?.addressState, p.provider?.addressZip].filter(Boolean).join(', ') },
  { key: 'dob', label: 'Date of Birth', get: (p) => p.provider?.dateOfBirth || '' },
  { key: 'stateLicense', label: 'State License #', cred: 'STATE_LICENSE', part: 'identifier' },
  { key: 'stateLicenseState', label: 'License State', cred: 'STATE_LICENSE', part: 'jurisdiction' },
  { key: 'stateLicenseExp', label: 'License Expiration', cred: 'STATE_LICENSE', part: 'exp' },
  { key: 'csLicense', label: 'Controlled Substance #', cred: 'STATE_CS_LICENSE', part: 'identifier' },
  { key: 'csLicenseExp', label: 'CS Expiration', cred: 'STATE_CS_LICENSE', part: 'exp' },
  { key: 'dea', label: 'DEA #', cred: 'DEA', part: 'identifier' },
  { key: 'deaExp', label: 'DEA Expiration', cred: 'DEA', part: 'exp' },
  { key: 'boardCert', label: 'Board Certification', cred: 'BOARD_CERTIFICATION', part: 'identifier' },
  { key: 'boardCertExp', label: 'Board Cert Expiration', cred: 'BOARD_CERTIFICATION', part: 'exp' },
  { key: 'acls', label: 'ACLS Expiration', cred: 'ACLS', part: 'exp' },
  { key: 'bls', label: 'BLS Expiration', cred: 'BLS', part: 'exp' },
  { key: 'malpractice', label: 'Malpractice Policy #', cred: 'MALPRACTICE_INSURANCE', part: 'identifier' },
  { key: 'malpracticeExp', label: 'Malpractice Expiration', cred: 'MALPRACTICE_INSURANCE', part: 'exp' },
]
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]))

function cellValue(field, passport, credByType) {
  if (field.get) return field.get(passport)
  const c = credByType[field.cred]
  if (!c) return ''
  if (field.part === 'exp') return fmtDate(c.expirationDate)
  if (field.part === 'jurisdiction') return c.jurisdiction || ''
  return c[field.part] || ''
}

// Small concurrency limiter so a roster of granted passports fetches in
// parallel batches rather than one slow serial chain.
async function mapLimit(items, limit, fn) {
  const out = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)))
  }
  return out
}

/**
 * Build the report. providers = [{ npi, name }] (already facility-scoped),
 * fieldKeys = ordered column keys, format = 'csv' | 'xlsx'.
 * Returns { filename, mime, base64 }.
 */
async function buildRosterReport({ facilityId, providers, fieldKeys, format }) {
  const fields = fieldKeys.map((k) => FIELD_BY_KEY[k]).filter(Boolean)
  if (fields.length === 0) throw new Error('Pick at least one column.')
  if (providers.length === 0) throw new Error('Pick at least one provider.')

  const rows = await mapLimit(providers, 6, async (prov) => {
    let passport = null
    try {
      passport = await passportClient.getPassport(prov.npi, facilityId)
    } catch { /* no grant / no passport → blank row with the roster name */ }
    const credByType = Object.fromEntries((passport?.credentials || []).map((c) => [c.type, c]))
    return fields.map((f) => {
      // Provider name falls back to the roster name when there's no passport.
      if (f.key === 'name' && !passport) return prov.name || ''
      if (f.key === 'npi') return prov.npi
      return cellValue(f, passport || {}, credByType)
    })
  })

  const XLSX = require('xlsx')
  const aoa = [fields.map((f) => f.label), ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Credentials')
  const type = format === 'xlsx' ? 'xlsx' : 'csv'
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: type })
  return {
    filename: `credential-report-${new Date().toISOString().slice(0, 10)}.${type}`,
    mime: type === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    base64: Buffer.from(buffer).toString('base64'),
  }
}

module.exports = { FIELDS, buildRosterReport }
