/**
 * WC Recovery ingestion reader (2026-07-24) — the adapter layer.
 *
 * One reader, many sources: a billing-company export (CSV/PDF), an EMR
 * anesthesia-record export, or a payer EOB — all normalize into the same
 * WcCase shape (brief §7). SNAP bends to the group's data; the group never
 * changes their workflow to onboard.
 *
 * Same Claude tool_use pattern + retry posture as credMapIntake.js. The
 * reader is ruthless about the anesthesia-math fields (base units, minutes,
 * modifiers) — the entitlement is proven or lost there — and accuracy-first:
 * a field the document doesn't state is left null, never guessed. Low-
 * confidence cases are parked for human confirmation by the engine.
 *
 * PHI posture: extraction is instructed to carry a claim-scoped patientRef
 * (initials / last-4) rather than full patient names. NOTE for production:
 * WC billing documents inherently contain injured-worker PHI — confirm the
 * Anthropic BAA / zero-retention posture before processing live CAPA files
 * (same open item as Snappy's no-PHI rule).
 */

const Anthropic = require('@anthropic-ai/sdk')

const MODEL = process.env.WC_INTAKE_MODEL || 'claude-opus-4-8'
const MAX_CASES = 80 // runaway cap per uploaded file batch

let _client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const CASES_TOOL = {
  name: 'record_wc_cases',
  description: 'Record every workers-compensation anesthesia case found in the uploaded billing/EMR/EOB document(s).',
  input_schema: {
    type: 'object',
    properties: {
      sourceKind: {
        type: 'string',
        enum: ['BILLING_EXPORT', 'EMR_EXPORT', 'EOB_PDF'],
        description: 'What kind of document this is: a billing-system export, an EMR/anesthesia-record export, or a payer EOB/remittance.',
      },
      cases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            patientRef: { type: 'string', description: 'Claim-scoped reference ONLY — patient initials or last-4 of an ID. NEVER the full patient name.' },
            claimNumber: { type: 'string', description: 'WC claim number exactly as printed, else empty' },
            payerName: { type: 'string', description: 'WC carrier / bill-review vendor name, else empty' },
            adjusterName: { type: 'string' },
            employerName: { type: 'string' },
            dateOfInjury: { type: 'string', description: 'YYYY-MM-DD, else empty' },
            dateOfService: { type: 'string', description: 'YYYY-MM-DD, else empty' },
            bodyPart: { type: 'string' },
            asaCptCode: { type: 'string', description: 'Anesthesia CPT (00100–01999) as printed, else empty' },
            baseUnits: { type: 'number', description: 'Base anesthesia units ONLY if the document states them. Do not derive or guess.' },
            anesthesiaMinutes: { type: 'number', description: 'Total anesthesia time in MINUTES only if stated (convert hh:mm). Do not guess.' },
            physicalStatus: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], description: 'Physical-status modifier if billed (e.g. 00790-P3)' },
            qualifyingCircs: {
              type: 'array', items: { type: 'string', enum: ['99100', '99116', '99135', '99140'] },
              description: 'Qualifying-circumstance add-on codes billed with the case',
            },
            billedAmount: { type: 'number', description: 'Amount the group billed, if shown' },
            paidAmount: { type: 'number', description: 'Amount the payer actually paid/allowed, if shown (EOB "paid" column)' },
            authorization: { type: 'string', description: 'Prior-auth / authorization number if shown' },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'LOW when key fields were unreadable or ambiguous' },
          },
          required: ['confidence'],
        },
      },
      notes: { type: 'string', description: 'One or two sentences: what the document is, anything unusual (columns missing, pages unreadable).' },
    },
    required: ['sourceKind', 'cases'],
  },
}

const INTAKE_PROMPT = `You are reading a document from an anesthesia group's workers'-compensation billing: either a billing-system export, an EMR/anesthesia-record export, or a payer EOB / remittance advice.

Extract EVERY workers'-comp anesthesia case (one entry per case/claim line). Rules:
- Accuracy first: a field the document does not state is omitted — NEVER derived, estimated, or guessed. Base units and anesthesia minutes are the fields the whole downstream calculation depends on; only record them when explicitly present.
- Convert anesthesia time to total minutes (e.g. "1:15" → 75). If only start/stop times are given, compute the difference.
- patientRef: initials or last-4 only. Never record a full patient name.
- Physical status (P1–P6) and qualifying circumstances (99100/99116/99135/99140) only when actually billed/shown.
- paidAmount is what the payer PAID or allowed (from an EOB); billedAmount is what the group charged. Don't swap them.
- If a page or column is unreadable, still record the case with what is legible and set confidence LOW, noting it.

Call record_wc_cases exactly once.`

// Retry on transient API failures (529 overloaded / 429 / 5xx).
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

/** One content block per uploaded file: PDFs/images as documents, CSV/text inlined. */
function fileContentBlock(file) {
  const mime = file.mimeType || ''
  if (mime.includes('pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } }
  }
  if (mime.startsWith('image/')) {
    return { type: 'image', source: { type: 'base64', media_type: mime, data: file.buffer.toString('base64') } }
  }
  // CSV / TSV / plain text exports — inline as text (cap pathological sizes).
  const text = file.buffer.toString('utf8').slice(0, 400_000)
  return { type: 'text', text: `--- Uploaded file: ${file.name || 'export'} ---\n${text}` }
}

const clean = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null)
const date = (v) => {
  const d = new Date(String(v || ''))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Read one or more uploaded files into normalized case records.
 * Returns { sourceKind, notes, cases: [normalized WcCase-shaped objects] }.
 */
async function readFiles(files) {
  const client = getClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')

  const content = [
    ...files.map(fileContentBlock),
    { type: 'text', text: INTAKE_PROMPT },
  ]
  const resp = await withApiRetries(() => client.messages.create({
    model: MODEL,
    max_tokens: 16000, // billing exports can carry dozens of case lines
    tools: [CASES_TOOL],
    tool_choice: { type: 'tool', name: 'record_wc_cases' },
    messages: [{ role: 'user', content }],
  }))
  const call = resp.content.find((b) => b.type === 'tool_use')
  if (!call) throw new Error('no cases returned')

  const a = call.input
  const VALID_QC = ['99100', '99116', '99135', '99140']
  const cases = (Array.isArray(a.cases) ? a.cases : []).slice(0, MAX_CASES).map((r) => ({
    patientRef: clean(r.patientRef, 40),
    claimNumber: clean(r.claimNumber, 80),
    payerName: clean(r.payerName, 140),
    adjusterName: clean(r.adjusterName, 120),
    employerName: clean(r.employerName, 160),
    dateOfInjury: date(r.dateOfInjury),
    dateOfService: date(r.dateOfService),
    bodyPart: clean(r.bodyPart, 80),
    asaCptCode: clean(r.asaCptCode, 12),
    baseUnits: num(r.baseUnits),
    anesthesiaMinutes: num(r.anesthesiaMinutes) != null ? Math.round(num(r.anesthesiaMinutes)) : null,
    physicalStatus: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].includes(r.physicalStatus) ? r.physicalStatus : null,
    qualifyingCircs: (Array.isArray(r.qualifyingCircs) ? r.qualifyingCircs : []).filter((q) => VALID_QC.includes(q)),
    billedAmount: num(r.billedAmount),
    paidAmount: num(r.paidAmount),
    authorization: clean(r.authorization, 80),
    aiConfidence: ['HIGH', 'MEDIUM', 'LOW'].includes(r.confidence) ? r.confidence : 'LOW',
  }))

  const sourceKind = ['BILLING_EXPORT', 'EMR_EXPORT', 'EOB_PDF'].includes(a.sourceKind)
    ? a.sourceKind
    : 'BILLING_EXPORT'

  return { sourceKind, notes: clean(a.notes, 500), cases }
}

module.exports = { isConfigured, readFiles }
