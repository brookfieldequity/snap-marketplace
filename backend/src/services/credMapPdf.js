/**
 * Filled facility PDF (2026-07-22) — the packet in the facility's OWN form.
 *
 * For fillable (AcroForm) packets: enumerate the PDF's field names, have the
 * Claude API map each field to a passport value-key ONCE per facility (stored
 * on CredProgramMap.formFieldMap — the Cred Map philosophy: map once, reuse
 * for every provider), then each render types the provider's live passport
 * data into the facility's exact form and stamps the captured e-signature
 * onto signature lines. Scanned/flat packets return NOT_FILLABLE — Anvil
 * box-detection is the planned path for those.
 *
 * Provenance voice: the form itself is untouched apart from filled values —
 * no SNAP branding is injected (see document-voice principle).
 */

const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')
const prisma = require('../config/db')

const MODEL = process.env.CREDMAP_MODEL || 'claude-opus-4-8'

let _client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// The value vocabulary the AI maps form fields onto. Everything resolvable
// from the passport payload (provider + credentials + sections) or context.
const VALUE_KEYS = [
  'provider.fullName', 'provider.firstName', 'provider.lastName', 'provider.npi',
  'provider.dateOfBirth', 'provider.specialty', 'provider.licenseState',
  'cred.STATE_LICENSE.identifier', 'cred.STATE_LICENSE.expirationDate',
  'cred.STATE_CS_LICENSE.identifier', 'cred.STATE_CS_LICENSE.expirationDate',
  'cred.DEA.identifier', 'cred.DEA.expirationDate',
  'cred.BOARD_CERTIFICATION.identifier', 'cred.BOARD_CERTIFICATION.expirationDate',
  'cred.MALPRACTICE_INSURANCE.identifier', 'cred.MALPRACTICE_INSURANCE.expirationDate',
  'cred.ACLS.expirationDate', 'cred.BLS.expirationDate',
  'malpractice.carrier', 'today', 'LEAVE_BLANK',
]

const MAPPING_TOOL = {
  name: 'record_field_mapping',
  description: 'Record which passport value fills each PDF form field.',
  input_schema: {
    type: 'object',
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'The PDF field name, exactly as given' },
            source: { type: 'string', enum: VALUE_KEYS, description: 'Value to fill it with; LEAVE_BLANK when unsure or not applicable' },
          },
          required: ['field', 'source'],
        },
      },
    },
    required: ['mappings'],
  },
}

const MAPPING_PROMPT = (fieldNames, labels = {}) => `You are mapping the form fields of a surgical facility's credentialing application PDF (anesthesia providers) to the data keys that should fill them.

Each field is listed as: FIELD_NAME — nearby label text on the form (the label is the reliable signal; field names are often generic like "Text12").
${fieldNames.map((n) => `- ${n}${labels[n] ? ` — "${labels[n]}"` : ''}`).join('\n')}

Rules:
- Use the nearby label text to decide what a field is for; the field name alone is often meaningless.
- Map each field to the single best value key. "today" is the date the form is being completed.
- License/DEA/certification numbers map to the matching cred.*.identifier; their expiration fields to cred.*.expirationDate.
- Use LEAVE_BLANK for anything ambiguous, facility-internal (office use, approvals), reference/peer fields, yes/no questions, or fields SNAP data cannot confidently fill. Never guess.
- Map EVERY field name given, exactly once. Call record_field_mapping exactly once.`

async function withApiRetries(fn) {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (err) {
      const status = err.status || err.response?.status
      const retryable = status === 529 || status === 429 || (status >= 500 && status < 600)
      if (!retryable || i >= 3) throw err
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, i)))
    }
  }
}

// AI pass: field names (+ nearby labels) in, { fieldName: valueKey } out.
async function buildFieldMap(fieldNames, labels = {}) {
  const client = getClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')
  const resp = await withApiRetries(() => client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [MAPPING_TOOL],
    tool_choice: { type: 'tool', name: 'record_field_mapping' },
    messages: [{ role: 'user', content: MAPPING_PROMPT(fieldNames, labels) }],
  }))
  const call = resp.content.find((b) => b.type === 'tool_use')
  if (!call) throw new Error('no mapping returned')
  const map = {}
  for (const m of call.input.mappings || []) {
    if (fieldNames.includes(m.field) && VALUE_KEYS.includes(m.source)) map[m.field] = m.source
  }
  return map
}

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// Resolve a value key against the full passport payload.
function resolveValue(source, passport) {
  if (!source || source === 'LEAVE_BLANK') return ''
  const prov = passport?.provider || {}
  const creds = passport?.credentials || []
  const credByType = Object.fromEntries(creds.map((c) => [c.type, c]))
  const parts = source.split('.')
  if (source === 'today') return fmtDate(new Date())
  if (parts[0] === 'provider') {
    if (parts[1] === 'fullName') return `${prov.firstName || ''} ${prov.lastName || ''}`.trim()
    if (parts[1] === 'dateOfBirth') return prov.dateOfBirth || ''
    return String(prov[parts[1]] || '')
  }
  if (parts[0] === 'cred') {
    const c = credByType[parts[1]]
    if (!c) return ''
    if (parts[2] === 'expirationDate') return fmtDate(c.expirationDate)
    return String(c[parts[2]] || '')
  }
  if (source === 'malpractice.carrier') return passport?.sections?.malpractice?.carrier || ''
  return ''
}

async function s3GetBuffer(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  const { clientForBucket } = require('./s3Buckets')
  const s3 = await clientForBucket(process.env.AWS_S3_BUCKET)
  const resp = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }))
  const chunks = []
  for await (const chunk of resp.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function s3PutBuffer(key, buffer, contentType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3')
  const { clientForBucket } = require('./s3Buckets')
  const s3 = await clientForBucket(process.env.AWS_S3_BUCKET)
  const sse = process.env.AWS_KMS_KEY_ID
    ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: process.env.AWS_KMS_KEY_ID }
    : { ServerSideEncryption: 'AES256' }
  await s3.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key, Body: buffer, ContentType: contentType, ...sse }))
}

/**
 * Render the filled facility PDF for a packet. Returns
 * { generatedDocPath, generatedDocName, fieldCount, filledCount, signatureStamped }.
 * Throws coded errors: NOT_CONFIGURED, NO_SOURCE_DOC, NOT_FILLABLE.
 */
async function renderFilledPdf({ packet, map, passport }) {
  if (!process.env.AWS_S3_BUCKET) { const e = new Error('Document storage is not configured'); e.code = 'NOT_CONFIGURED'; throw e }
  if (!map.sourceDocPath) { const e = new Error('This map has no uploaded facility PDF'); e.code = 'NO_SOURCE_DOC'; throw e }

  const { PDFDocument } = require('pdf-lib')
  const sourceBuffer = await s3GetBuffer(map.sourceDocPath)
  const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const fields = form.getFields()
  if (fields.length === 0) {
    const e = new Error('This facility packet is not a fillable PDF — no form fields found. Use the packet preview for now; box-mapped filling for scanned packets is coming.')
    e.code = 'NOT_FILLABLE'
    throw e
  }

  // Text fields get mapped values; everything else (checkboxes, radio,
  // dropdowns) is deliberately left for the human pass — never guess.
  const textFields = fields.filter((f) => f.constructor.name === 'PDFTextField')
  const textNames = textFields.map((f) => f.getName())

  // Map once per facility, reuse forever (coordinator can re-map / correct
  // via the field-mapping panel). Build label-aware so generic field names
  // ("Text12") still map via the text printed next to them.
  let fieldMap = map.formFieldMap
  if (!fieldMap || typeof fieldMap !== 'object' || Object.keys(fieldMap).length === 0) {
    const { labels } = await inspectFields(sourceBuffer)
    fieldMap = await buildFieldMap(textNames, labels)
    await prisma.credProgramMap.update({ where: { id: map.id }, data: { formFieldMap: fieldMap } })
  }

  let filledCount = 0
  for (const f of textFields) {
    const source = fieldMap[f.getName()]
    const value = resolveValue(source, passport)
    if (!value) continue
    try {
      f.setText(value)
      filledCount++
    } catch { /* protected/combed field — leave it */ }
  }

  // Collect signature-line targets BEFORE flattening (flatten drops fields);
  // the image is drawn after flatten so the field's empty appearance can
  // never paint over it.
  const pages = pdfDoc.getPages()
  const sigTargets = []
  for (const f of fields) {
    if (!/sign/i.test(f.getName()) || /print|date/i.test(f.getName())) continue
    for (const widget of f.acroField.getWidgets()) {
      const rect = widget.getRectangle()
      const pageRef = widget.P()
      const page = pageRef
        ? pages.find((p) => p.ref === pageRef || p.ref.toString() === pageRef.toString()) || null
        : null
      if (page) sigTargets.push({ page, rect })
    }
  }

  try { form.updateFieldAppearances() } catch { /* non-fatal */ }
  try { form.flatten() } catch { /* some packets have odd fields; deliver unflattened */ }

  // Stamp the captured e-signature onto the collected signature lines.
  let signatureStamped = false
  const sig = await prisma.credSignature.findFirst({ where: { packetId: packet.id }, orderBy: { signedAt: 'desc' } })
  if (sig?.signatureData?.startsWith('data:image/png;base64,') && sigTargets.length > 0) {
    try {
      const png = await pdfDoc.embedPng(Buffer.from(sig.signatureData.split(',')[1], 'base64'))
      for (const { page, rect } of sigTargets) {
        const scale = Math.min(rect.width / png.width, rect.height / png.height, 1)
        const w = png.width * scale
        const h = png.height * scale
        page.drawImage(png, { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h })
        signatureStamped = true
      }
    } catch (err) {
      console.error('[credMapPdf] signature stamp failed (continuing):', err.message)
    }
  }

  const outBuffer = Buffer.from(await pdfDoc.save())
  const providerSlug = (packet.providerName || packet.npi).replace(/[^A-Za-z0-9]+/g, '_')
  const generatedDocName = `${providerSlug}_${map.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60)}_filled.pdf`
  const generatedDocPath = `credpackets/${packet.facilityId}/${packet.id}/${Date.now()}_${crypto.randomUUID()}.pdf`
  await s3PutBuffer(generatedDocPath, outBuffer, 'application/pdf')

  await prisma.credPacket.update({
    where: { id: packet.id },
    data: { generatedDocPath, generatedDocName },
  })

  return { generatedDocPath, generatedDocName, fieldCount: textNames.length, filledCount, signatureStamped }
}

/**
 * Enumerate a fillable packet's text fields + nearby label text, for the
 * mapping review panel and for label-aware AI mapping. Returns
 * { fieldNames: [...], labels: { field: "text near it" }, notFillable: bool }.
 * Label extraction is best-effort (pdfjs) — field names still work without it.
 */
async function inspectFields(sourceBuffer) {
  const { PDFDocument } = require('pdf-lib')
  const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const textFields = form.getFields().filter((f) => f.constructor.name === 'PDFTextField')
  if (textFields.length === 0) return { fieldNames: [], labels: {}, notFillable: true }

  const fieldNames = textFields.map((f) => f.getName())

  // Best-effort: pull the text word closest-left / closest-above each field
  // widget so generic field names ("Text12") gain human meaning.
  const labels = {}
  try {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(sourceBuffer), useSystemFonts: true }).promise
    const pageWords = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const vh = page.getViewport({ scale: 1 }).height
      for (const item of content.items) {
        if (!item.str.trim()) continue
        // pdf.js transform origin is top-left; convert to PDF bottom-left y.
        const x = item.transform[4]
        const y = vh - item.transform[5]
        pageWords.push({ page: p, x, y, str: item.str.trim() })
      }
    }
    for (const f of textFields) {
      const widget = f.acroField.getWidgets()[0]
      if (!widget) continue
      const r = widget.getRectangle()
      const pageRef = widget.P()
      const pageIndex = pdfDoc.getPages().findIndex((pg) => pg.ref === pageRef || pg.ref.toString() === pageRef?.toString())
      const pageNo = pageIndex + 1
      const midY = r.y + r.height / 2
      // Nearest words to the left on the same line, then above.
      const left = pageWords
        .filter((w) => w.page === pageNo && Math.abs(w.y - midY) < r.height && w.x < r.x)
        .sort((a, b) => (r.x - a.x) - (r.x - b.x))
        .slice(0, 4).map((w) => w.str)
      const above = pageWords
        .filter((w) => w.page === pageNo && w.y > midY && w.y - midY < 24 && Math.abs(w.x - r.x) < 120)
        .sort((a, b) => (a.y - midY) - (b.y - midY))
        .slice(0, 4).map((w) => w.str)
      const label = (left.length ? left.join(' ') : above.join(' ')).slice(0, 80)
      if (label) labels[f.getName()] = label
    }
  } catch (err) {
    console.error('[credMapPdf] label extraction skipped:', err.message)
  }

  return { fieldNames, labels, notFillable: false }
}

module.exports = { renderFilledPdf, inspectFields, buildFieldMap, resolveValue, VALUE_KEYS }
