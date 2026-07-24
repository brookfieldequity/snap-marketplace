/**
 * Passport value vocabulary + resolver (2026-07-23).
 *
 * ONE canonical list of the scalar values a facility form field can be filled
 * with from a provider's passport, and one resolver that turns a value-key into
 * a string against the live passport payload. Shared by every fill path:
 *   - credMapPdf   (AcroForm mapping, flat overlay, native form renderer)
 *   - credFormStructure (AI form-structure extraction — the native template)
 *
 * The passport payload shape (see snap-credentialing passport service):
 *   provider   { npi, firstName, middleName, lastName, suffix, specialty,
 *                dateOfBirth, licenseState, email, phone, addressStreet,
 *                addressCity, addressState, addressZip }
 *   credentials[ { type, identifier, expirationDate, status } ]
 *   sections   { education[], workHistory[], hospitalPrivileges[],
 *                malpractice{ hasHistory, carrier, incidents[] }, npdbAuthorized }
 *
 * Repeating data (work history, education, privileges) is NOT a scalar value —
 * the native renderer reads those directly off `sections`. This module covers
 * the single-value fills only.
 */

// The value vocabulary the AI maps single-value form fields onto. Kept as a
// flat enum so it can drop straight into a tool input_schema.
const VALUE_KEYS = [
  // Identity / demographics
  'provider.fullName', 'provider.firstName', 'provider.middleName', 'provider.lastName',
  'provider.suffix', 'provider.profTitle', 'provider.npi', 'provider.dateOfBirth', 'provider.specialty',
  'provider.licenseState', 'provider.email', 'provider.phone',
  'address.full', 'address.street', 'address.city', 'address.state', 'address.zip',
  // Credentials (number + expiry + status)
  'cred.STATE_LICENSE.identifier', 'cred.STATE_LICENSE.expirationDate', 'cred.STATE_LICENSE.status',
  'cred.STATE_CS_LICENSE.identifier', 'cred.STATE_CS_LICENSE.expirationDate',
  'cred.DEA.identifier', 'cred.DEA.expirationDate',
  'cred.BOARD_CERTIFICATION.identifier', 'cred.BOARD_CERTIFICATION.expirationDate',
  'cred.MALPRACTICE_INSURANCE.identifier', 'cred.MALPRACTICE_INSURANCE.expirationDate',
  'cred.ACLS.expirationDate', 'cred.BLS.expirationDate',
  'malpractice.carrier',
  // Repeating passport sections, rendered as a multi-line summary (native form
  // only — a work-history/education grid maps to one of these).
  'list.workHistory', 'list.education', 'list.hospitalPrivileges',
  // Context
  'today', 'LEAVE_BLANK',
]

// Human labels for the value keys — used in the field-mapping panel and the
// native-form builder so a coordinator reviews meaning, not dotted keys.
const VALUE_KEY_LABELS = {
  'provider.fullName': 'Full name',
  'provider.firstName': 'First name',
  'provider.middleName': 'Middle name',
  'provider.lastName': 'Last name',
  'provider.suffix': 'Suffix (Jr., II)',
  'provider.profTitle': 'Professional title / degree',
  'provider.npi': 'NPI',
  'provider.dateOfBirth': 'Date of birth',
  'provider.specialty': 'Specialty',
  'provider.licenseState': 'License state',
  'provider.email': 'Email',
  'provider.phone': 'Phone',
  'address.full': 'Mailing address (full)',
  'address.street': 'Street address',
  'address.city': 'City',
  'address.state': 'State',
  'address.zip': 'ZIP',
  'cred.STATE_LICENSE.identifier': 'State license #',
  'cred.STATE_LICENSE.expirationDate': 'State license expiry',
  'cred.STATE_LICENSE.status': 'State license status',
  'cred.STATE_CS_LICENSE.identifier': 'Controlled-substance reg #',
  'cred.STATE_CS_LICENSE.expirationDate': 'Controlled-substance expiry',
  'cred.DEA.identifier': 'DEA #',
  'cred.DEA.expirationDate': 'DEA expiry',
  'cred.BOARD_CERTIFICATION.identifier': 'Board certification #',
  'cred.BOARD_CERTIFICATION.expirationDate': 'Board certification expiry',
  'cred.MALPRACTICE_INSURANCE.identifier': 'Malpractice policy #',
  'cred.MALPRACTICE_INSURANCE.expirationDate': 'Malpractice policy expiry',
  'cred.ACLS.expirationDate': 'ACLS expiry',
  'cred.BLS.expirationDate': 'BLS expiry',
  'malpractice.carrier': 'Malpractice carrier',
  'list.workHistory': 'Work history (all entries)',
  'list.education': 'Education & training (all entries)',
  'list.hospitalPrivileges': 'Hospital affiliations (all entries)',
  'today': "Today's date",
  'LEAVE_BLANK': '(leave blank)',
}

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// Humanize the education level enum for rendered output ("MED_SCHOOL" reads as
// "Medical school", not the raw key).
const EDU_LEVEL_LABELS = {
  HIGH_SCHOOL: 'High school',
  COLLEGE: 'College',
  MED_SCHOOL: 'Medical school',
  RESIDENCY: 'Residency',
  FELLOWSHIP: 'Fellowship',
  INTERNSHIP: 'Internship',
}
function eduLevel(v) {
  if (!v) return ''
  return EDU_LEVEL_LABELS[v] || String(v).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

// A passport "suffix" field frequently holds a professional degree (MD, DO,
// PhD) instead of a generational name suffix (Jr., II). Split the two so the
// degree lands in the professional-title field and the name suffix stays part
// of the name — never render "Matthew Haverkamp MD" with MD as a name suffix,
// and never put MD in a "Suffix (Jr., II)" blank.
const NAME_SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|2nd|3rd|4th)$/i
function nameSuffixOnly(s) {
  const t = String(s || '').trim()
  return NAME_SUFFIX_RE.test(t.replace(/\.$/, '')) ? t : ''
}
function degreeFromSuffix(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  return NAME_SUFFIX_RE.test(t.replace(/\.$/, '')) ? '' : t
}

/** Resolve a value key against the full passport payload → string (never null). */
function resolveValue(source, passport) {
  if (!source || source === 'LEAVE_BLANK') return ''
  if (source === 'today') return fmtDate(new Date())

  const prov = passport?.provider || {}
  const creds = passport?.credentials || []
  const credByType = Object.fromEntries(creds.map((c) => [c.type, c]))
  const parts = source.split('.')

  if (parts[0] === 'provider') {
    if (parts[1] === 'profTitle') return degreeFromSuffix(prov.suffix)
    if (parts[1] === 'suffix') return nameSuffixOnly(prov.suffix)
    if (parts[1] === 'fullName') {
      return [prov.firstName, prov.middleName, prov.lastName, nameSuffixOnly(prov.suffix)]
        .filter(Boolean).join(' ').trim()
    }
    return String(prov[parts[1]] || '')
  }

  if (parts[0] === 'address') {
    if (parts[1] === 'full') {
      const line1 = prov.addressStreet || ''
      const line2 = [prov.addressCity, prov.addressState].filter(Boolean).join(', ')
      return [line1, [line2, prov.addressZip].filter(Boolean).join(' ')].filter(Boolean).join(', ').trim()
    }
    const map = { street: 'addressStreet', city: 'addressCity', state: 'addressState', zip: 'addressZip' }
    return String(prov[map[parts[1]]] || '')
  }

  if (parts[0] === 'cred') {
    const c = credByType[parts[1]]
    if (!c) return ''
    if (parts[2] === 'expirationDate') return fmtDate(c.expirationDate)
    return String(c[parts[2]] || '')
  }

  if (source === 'malpractice.carrier') return passport?.sections?.malpractice?.carrier || ''

  if (parts[0] === 'list') {
    const S = passport?.sections || {}
    if (parts[1] === 'workHistory') {
      return (S.workHistory || [])
        .map((w) => `${w.role || ''} — ${w.employer || ''} (${w.startDate || '?'}–${w.currentlyEmployed ? 'present' : (w.endDate || '?')})`.trim())
        .join('\n')
    }
    if (parts[1] === 'education') {
      return (S.education || [])
        .map((e) => `${eduLevel(e.level)}${e.institution ? ` — ${e.institution}` : ''}${e.graduationDate ? ` (${e.graduationDate})` : ''}`.trim())
        .join('\n')
    }
    if (parts[1] === 'hospitalPrivileges') {
      return (S.hospitalPrivileges || [])
        .map((h) => `${h.hospitalName || ''} (${h.startDate || '?'}–${h.currentlyActive ? 'present' : (h.endDate || '?')})`.trim())
        .join('\n')
    }
  }
  return ''
}

module.exports = { VALUE_KEYS, VALUE_KEY_LABELS, resolveValue, fmtDate }
