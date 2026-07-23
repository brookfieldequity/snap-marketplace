/**
 * Native-form structure extraction (2026-07-23).
 *
 * The scaling reframe: we do NOT reproduce a facility's PDF. We reproduce their
 * INFORMATION — every field, organized the way their application organizes it.
 * This service reads a facility's blank credentialing packet and returns a
 * SNAP-native form template: ordered sections, each with typed fields tagged by
 * where the value comes from —
 *
 *   PASSPORT    — filled automatically from the verified passport (valueKey)
 *   PROVIDER    — the provider types it once (address extras, references…)
 *   ATTESTATION — a yes/no legal statement the provider must answer + attest
 *   SIGNATURE   — a signature/date line
 *   STATIC      — a heading/instruction with no input
 *
 * The template renders as SNAP's OWN document (credMapPdf.renderNativeForm) —
 * always perfect, no per-facility placement, no overlay. Attestation fields
 * carry a canonical key so an answer given on one application pre-fills every
 * future one (the common-app seed; see CredFormAnswer).
 *
 * Privacy: blank packets are facility paperwork (no PHI). Analyzed in memory,
 * same retry posture as credMapIntake.
 */

const Anthropic = require('@anthropic-ai/sdk')
const { VALUE_KEYS } = require('./passportFields')

const MODEL = process.env.CREDMAP_MODEL || 'claude-opus-4-8'
const MAX_SECTIONS = 60
const MAX_FIELDS = 500 // runaway-output cap across all sections
const MAX_OUTPUT_TOKENS = 32000 // big multi-site packets need room; streamed to dodge HTTP timeouts

// Canonical attestation questions. Every medical-staff application asks a
// recurring set of yes/no legal questions; normalizing them to these keys is
// what lets "ever convicted of a felony?" answered at facility A pre-fill the
// same question at facility B — and builds the overlap dataset behind the
// eventual common-app case. OTHER for anything facility-unique.
const ATTESTATION_KEYS = [
  'felony_conviction',
  'misdemeanor_conviction',
  'license_denied_revoked_suspended',
  'license_voluntarily_surrendered',
  'license_disciplinary_action',
  'dea_action_surrendered',
  'board_certification_revoked',
  'hospital_privileges_denied',
  'hospital_privileges_revoked_suspended',
  'privileges_voluntarily_relinquished',
  'membership_denied_other_facility',
  'resigned_under_investigation',
  'malpractice_claims_history',
  'malpractice_settlements_judgments',
  'professional_liability_denied_cancelled',
  'medicare_medicaid_sanctioned',
  'opted_out_of_medicare',
  'npdb_reported',
  'oig_sam_excluded',
  'substance_abuse_impairment',
  'physical_mental_health_impairment',
  'able_to_perform_privileges',
  'OTHER',
]

const FIELD_TYPES = ['text', 'date', 'longtext', 'yesno', 'signature', 'static']
const FIELD_SOURCES = ['PASSPORT', 'PROVIDER', 'ATTESTATION', 'SIGNATURE', 'STATIC']

let _client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const STRUCTURE_TOOL = {
  name: 'record_form_structure',
  description: "Record the full structure of a facility's credentialing application as an ordered list of sections and typed fields.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Facility + application title as printed, e.g. "Beacon Harbor ASC — Medical Staff Application"' },
      sections: {
        type: 'array',
        description: 'Every section of the application, in the order it appears.',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string', description: "The section heading as printed (e.g. 'Personal Information', 'Professional Liability', 'Attestation')" },
            description: { type: 'string', description: 'One short line of instruction shown under the heading, if the form gives one, else empty' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'The field/question exactly as the form words it' },
                  type: { type: 'string', enum: FIELD_TYPES, description: "Input shape: 'text' one line, 'date', 'longtext' multi-line (explanations), 'yesno' a yes/no question, 'signature' a signature line, 'static' a heading/instruction with no input" },
                  source: { type: 'string', enum: FIELD_SOURCES, description: "Where the value comes from: PASSPORT (SNAP fills it from verified data), PROVIDER (provider types it), ATTESTATION (yes/no legal statement to answer + attest), SIGNATURE (a signature/date line), STATIC (label only)" },
                  valueKey: { type: 'string', enum: VALUE_KEYS, description: 'REQUIRED when source=PASSPORT: which passport value fills this field. Use the closest match; omit for non-PASSPORT fields.' },
                  canonicalAttestation: { type: 'string', enum: ATTESTATION_KEYS, description: 'REQUIRED when source=ATTESTATION: the canonical key for this yes/no legal question, or OTHER if none fits.' },
                  explain: { type: 'string', description: 'For attestations: one short phrase like "If yes, attach explanation." Else empty.' },
                  required: { type: 'boolean', description: 'False only if the form marks it optional/if-applicable' },
                },
                required: ['label', 'type', 'source'],
              },
            },
          },
          required: ['heading', 'fields'],
        },
      },
      notes: { type: 'string', description: 'One or two sentences for the coordinator (anything unusual about this application)' },
    },
    required: ['title', 'sections'],
  },
}

const STRUCTURE_PROMPT = `You are reading a facility's BLANK credentialing application (a surgical center / hospital medical-staff application for anesthesia providers). Reproduce its STRUCTURE so SNAP can render its own native version of this exact application, filled from a provider's verified passport.

Walk the application top to bottom. Output every section in order, and within each section every field/question the applicant is asked to complete.

For each field, decide the SOURCE:
- PASSPORT — data SNAP holds on the provider's verified passport. This is BROAD — especially once the provider's CV has been read in, the passport holds far more than just license numbers. It covers:
  · Identity: full legal name, first/middle/last, suffix, former names, date of birth, NPI, specialty
  · Contact: mailing address (street, city, state, zip), phone, email
  · Licensure & certifications: state license number + expiration, controlled-substance registration, DEA number + expiration, board certification + expiration, ACLS expiration, BLS expiration
  · Malpractice: carrier, policy number + expiration
  · History — render each of these as ONE longtext field: complete work / employment history (valueKey list.workHistory), education & training history (valueKey list.education), hospital / facility affiliations (valueKey list.hospitalPrivileges)
  Choose the closest valueKey from the list. PREFER PASSPORT for any field the passport could answer — SNAP fills what it has and leaves the rest blank, which is always better than making the provider re-type information it already holds.
- PROVIDER — only for things genuinely NOT on the passport: professional references / peers, a specific written explanation, or a facility-internal detail SNAP has no source for. Do not use PROVIDER for standard demographics, contact info, work history, education, or affiliations — those are PASSPORT.
- ATTESTATION — a yes/no legal question ("Have you ever been convicted of a felony?", "Have your privileges ever been suspended?"). Set canonicalAttestation to the matching key, or OTHER. Put any "if yes, explain" instruction in explain.
- SIGNATURE — a signature line or "date signed" line.
- STATIC — a heading or instruction with no input.

Rules:
- Keep the facility's own wording as the label.
- Prefer PASSPORT for anything SNAP can fill; only use PROVIDER when it genuinely cannot.
- Group fields under the section headings the form actually uses.
- Work-history grids, education grids, and reference blocks: represent them as ONE field each (type longtext, source PASSPORT with the closest valueKey for history/education, or PROVIDER for references) — do not enumerate every row.
- If the packet repeats a near-identical form for multiple sites/locations (e.g. one privilege or delineation form per facility), capture it ONCE as a single section and note in the section description that it applies per site — do NOT duplicate the whole section for every location. Keep the output focused on distinct fields.
- Never invent sections or fields not in the application. If a page is unreadable, still record what you can and say so in notes.

Call record_form_structure exactly once.`

async function withApiRetries(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = err.status || err.response?.status
      const retryable = status === 529 || status === 429 || (status >= 500 && status < 600)
      if (!retryable || i >= 3) throw err
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, i)))
    }
  }
}

function bufferContentBlock(buffer, mimeType) {
  const isPdf = (mimeType || '').includes('pdf')
  return isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: buffer.toString('base64') } }
}

// Stable, safe field key from a label (+ index for uniqueness).
function slugKey(label, idx) {
  const base = String(label || 'field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field'
  return `${base}_${idx}`
}

/**
 * Analyze a blank facility packet → native form template.
 * Returns { version, title, notes, sections: [{ heading, description, fields:
 *   [{ key, label, type, source, valueKey|null, canonicalAttestation|null,
 *      explain|null, required }] }] }.
 * Throws on API failure / missing key — the route degrades gracefully.
 */
async function analyzeFormStructure(files) {
  const client = getClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')

  const content = [
    ...files.map((f) => bufferContentBlock(f.buffer, f.mimeType)),
    { type: 'text', text: STRUCTURE_PROMPT },
  ]
  // Stream: a long/multi-site packet can emit a large structure, and a big
  // max_tokens on a non-streaming call risks an HTTP timeout. finalMessage()
  // gives us the completed tool call plus stop_reason.
  const resp = await withApiRetries(async () => {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [STRUCTURE_TOOL],
      tool_choice: { type: 'tool', name: 'record_form_structure' },
      messages: [{ role: 'user', content }],
    })
    return stream.finalMessage()
  })
  const call = resp.content.find((b) => b.type === 'tool_use')
  if (!call) { const e = new Error('The reader did not return a form structure'); e.code = 'NO_STRUCTURE'; throw e }

  const structure = normalizeStructure(call.input)
  // If we hit the token cap the tail of the form was cut off — the caller keeps
  // what we got but warns, so a partial native form is never mistaken for whole.
  structure.truncated = resp.stop_reason === 'max_tokens'
  return structure
}

// Validate + normalize the AI output into the stored shape (safe against bad
// enums, assigns stable keys, enforces caps).
function normalizeStructure(input) {
  const clean = (v, max) => String(v || '').trim().slice(0, max)
  const rawSections = Array.isArray(input?.sections) ? input.sections.slice(0, MAX_SECTIONS) : []

  let fieldCount = 0
  const sections = []
  for (const s of rawSections) {
    const rawFields = Array.isArray(s.fields) ? s.fields : []
    const fields = []
    for (const f of rawFields) {
      if (fieldCount >= MAX_FIELDS) break
      const type = FIELD_TYPES.includes(f.type) ? f.type : 'text'
      let source = FIELD_SOURCES.includes(f.source) ? f.source : 'PROVIDER'
      // Coherence guards: a PASSPORT field needs a real valueKey; an ATTESTATION
      // is a yes/no; a signature is a SIGNATURE.
      let valueKey = source === 'PASSPORT' && VALUE_KEYS.includes(f.valueKey) && f.valueKey !== 'LEAVE_BLANK'
        ? f.valueKey : null
      if (source === 'PASSPORT' && !valueKey) source = 'PROVIDER'
      let canonicalAttestation = null
      if (source === 'ATTESTATION') {
        canonicalAttestation = ATTESTATION_KEYS.includes(f.canonicalAttestation) ? f.canonicalAttestation : 'OTHER'
      }
      if (type === 'signature') source = 'SIGNATURE'
      if (type === 'static') source = 'STATIC'
      fields.push({
        key: slugKey(f.label, fieldCount),
        label: clean(f.label, 240) || 'Field',
        type,
        source,
        valueKey,
        canonicalAttestation,
        explain: clean(f.explain, 200) || null,
        required: f.required !== false,
      })
      fieldCount++
    }
    if (fields.length === 0 && !clean(s.heading, 120)) continue
    sections.push({
      heading: clean(s.heading, 120) || 'Section',
      description: clean(s.description, 200) || null,
      fields,
    })
  }

  return {
    version: 1,
    title: clean(input?.title, 160) || 'Credentialing Application',
    notes: clean(input?.notes, 500) || null,
    sections,
  }
}

/**
 * The stable answer key for a field — how CredFormAnswer rows are keyed.
 * Canonical attestations key on the shared taxonomy so an answer given on ONE
 * facility's form pre-fills the same question everywhere ("att:felony_conviction");
 * everything else keys per-map ("map:<mapId>:<fieldKey>").
 */
function questionKeyFor(field, mapId) {
  if (field.source === 'ATTESTATION' && field.canonicalAttestation && field.canonicalAttestation !== 'OTHER') {
    return `att:${field.canonicalAttestation}`
  }
  return `map:${mapId}:${field.key}`
}

/** The provider-answerable fields (PROVIDER + ATTESTATION) across a structure. */
function answerableFields(structure, mapId) {
  const out = []
  if (!structure || !Array.isArray(structure.sections)) return out
  for (const sec of structure.sections) {
    for (const f of sec.fields || []) {
      if (f.source === 'PROVIDER' || f.source === 'ATTESTATION') {
        out.push({ ...f, section: sec.heading, questionKey: questionKeyFor(f, mapId) })
      }
    }
  }
  return out
}

// Counts for the coordinator's review ("SNAP fills 24, you answer 6, 4 to sign").
function structureStats(structure) {
  const s = { sections: 0, total: 0, passport: 0, provider: 0, attestation: 0, signature: 0 }
  if (!structure || !Array.isArray(structure.sections)) return s
  s.sections = structure.sections.length
  for (const sec of structure.sections) {
    for (const f of sec.fields || []) {
      if (f.source === 'STATIC') continue
      s.total++
      if (f.source === 'PASSPORT') s.passport++
      else if (f.source === 'PROVIDER') s.provider++
      else if (f.source === 'ATTESTATION') s.attestation++
      else if (f.source === 'SIGNATURE') s.signature++
    }
  }
  return s
}

module.exports = {
  isConfigured,
  analyzeFormStructure,
  normalizeStructure,
  structureStats,
  questionKeyFor,
  answerableFields,
  ATTESTATION_KEYS,
  FIELD_TYPES,
  FIELD_SOURCES,
}
