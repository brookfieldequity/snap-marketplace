/**
 * Cred Map packet analysis (2026-07-22).
 *
 * A coordinator uploads a facility's BLANK credentialing packet (application
 * PDF / checklist); this service reads it with the Claude API and proposes the
 * facility's Cred Map: one item per requirement, normalized to the canonical
 * taxonomy, with the passport auto-fill wiring pre-computed. Nothing is
 * committed here — the route stages a DRAFT map the coordinator reviews in
 * the builder.
 *
 * Privacy note: blank packets are facility paperwork — no provider or patient
 * data. Buffers are analyzed in memory; same retry posture as the passport
 * backend's documentIntake service.
 */

const Anthropic = require('@anthropic-ai/sdk')
const { CANONICAL_KEYS, defaultsFor } = require('./credMapTaxonomy')

const MODEL = process.env.CREDMAP_MODEL || 'claude-opus-4-8'
const MAX_ITEMS = 60 // runaway-output cap: no real packet asks for more

let _client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

const MAP_TOOL = {
  name: 'record_packet_map',
  description: "Record the credentialing requirements found in one facility's blank application packet.",
  input_schema: {
    type: 'object',
    properties: {
      mapName: { type: 'string', description: 'Facility/organization name + packet title as printed, e.g. "Beacon Harbor ASC — Medical Staff Application"' },
      cycleMonths: { type: 'number', description: 'Reappointment/recredentialing cycle in months if the packet states one (e.g. 24), else 0' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The requirement exactly as the facility words it' },
            section: { type: 'string', description: 'Packet section heading this appears under, else empty' },
            canonicalType: { type: 'string', enum: CANONICAL_KEYS, description: 'Closest canonical requirement type; FACILITY_SPECIFIC for forms unique to this facility; OTHER only as a last resort' },
            requiresSignature: { type: 'boolean', description: 'True if this item is a signature/attestation/release the provider must sign' },
            wetInkRequired: { type: 'boolean', description: 'True ONLY if the packet explicitly demands original/wet-ink signature or notarization' },
            required: { type: 'boolean', description: 'False only if the packet marks it optional/if-applicable' },
            notes: { type: 'string', description: 'One short phrase: anything the coordinator should double-check, else empty' },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          },
          required: ['label', 'canonicalType', 'confidence'],
        },
      },
      notes: { type: 'string', description: 'One or two sentences summarizing the packet for the coordinator (what it is, anything unusual)' },
    },
    required: ['mapName', 'items'],
  },
}

const MAP_PROMPT = `You are reading a facility's BLANK credentialing application packet (a surgical center / hospital medical-staff application for anesthesia providers). Extract the facility's complete requirement list — every document, form, verification, attestation, and signature the packet asks the applicant to provide.

Rules:
- One item per distinct requirement, in packet order, keeping the facility's own wording as the label.
- Include signature/attestation pages as their own items (requiresSignature=true). Set wetInkRequired=true only when the packet explicitly says original signature, blue ink, or notarized.
- Include fill-in application sections (demographics, license numbers, work history grids) as items too — normalize them to the matching canonicalType (e.g. a work-history grid is WORK_HISTORY_CV).
- Use FACILITY_SPECIFIC for forms unique to this facility; OTHER only as a last resort.
- If the packet states a reappointment cycle (e.g. "reappointment every two years"), record cycleMonths.
- Never invent requirements that are not in the packet. If a page is unreadable, lower confidence and mention it in notes.

Call record_packet_map exactly once.`

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

/** One document/image content block for a Claude message, from a raw buffer. */
function bufferContentBlock(buffer, mimeType) {
  const isPdf = (mimeType || '').includes('pdf')
  return isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: buffer.toString('base64') } }
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Analyze a blank facility packet (one or more files) and return the proposed
 * map. Throws on API failure or missing key — the route degrades to the
 * starter-checklist path.
 *
 * Returns { mapName, cycleMonths|null, notes|null, items: [{ label, section,
 * canonicalType, credentialType, fulfillment, required, esignOk, notes,
 * aiConfidence }] }.
 */
async function analyzePacket(files) {
  const client = getClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')

  const content = [
    ...files.map((f) => bufferContentBlock(f.buffer, f.mimeType)),
    { type: 'text', text: MAP_PROMPT },
  ]
  const resp = await withApiRetries(() => client.messages.create({
    model: MODEL,
    max_tokens: 6000, // hard output cap — ~MAX_ITEMS items fit comfortably
    tools: [MAP_TOOL],
    tool_choice: { type: 'tool', name: 'record_packet_map' },
    messages: [{ role: 'user', content }],
  }))
  const call = resp.content.find((b) => b.type === 'tool_use')
  if (!call) throw new Error('no map returned')

  const a = call.input
  const clean = (v, max) => String(v || '').trim().slice(0, max)
  const items = (Array.isArray(a.items) ? a.items : []).slice(0, MAX_ITEMS).map((it) => {
    const canonicalType = CANONICAL_KEYS.includes(it.canonicalType) ? it.canonicalType : 'OTHER'
    const d = defaultsFor(canonicalType)
    return {
      label: clean(it.label, 200) || 'Requirement',
      section: clean(it.section, 80) || null,
      canonicalType,
      credentialType: d.credentialType,
      // A signature ask overrides the taxonomy default — the signing IS the item.
      fulfillment: it.requiresSignature ? 'SIGNATURE' : d.fulfillment,
      required: it.required !== false,
      esignOk: !it.wetInkRequired,
      notes: clean(it.notes, 300) || null,
      aiConfidence: ['HIGH', 'MEDIUM', 'LOW'].includes(it.confidence) ? it.confidence : 'LOW',
    }
  })

  const cycle = Number(a.cycleMonths)
  return {
    mapName: clean(a.mapName, 140) || 'Untitled packet',
    cycleMonths: Number.isFinite(cycle) && cycle >= 1 && cycle <= 120 ? Math.round(cycle) : null,
    notes: clean(a.notes, 500) || null,
    items,
  }
}

module.exports = { isConfigured, analyzePacket }
