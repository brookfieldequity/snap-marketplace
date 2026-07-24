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
const { VALUE_KEYS, resolveValue, fmtDate } = require('./passportFields')

const MODEL = process.env.CREDMAP_MODEL || 'claude-opus-4-8'

let _client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

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
async function renderFilledPdf({ packet, map, passport, engine }) {
  if (!process.env.AWS_S3_BUCKET) { const e = new Error('Document storage is not configured'); e.code = 'NOT_CONFIGURED'; throw e }

  // Native-form engine: SNAP renders its OWN document mirroring the facility's
  // application structure — no overlay, always perfect. The scalable default
  // once a form structure has been built (credFormStructure). Falls back to the
  // clean packet when no structure exists yet.
  if (engine === 'native') return renderNativeForm({ packet, map, passport })

  // Dormant advanced override: an explicitly-configured Anvil PDF Template.
  // Nothing depends on it — the automatic paths below need no setup.
  if (map.anvilCastEid) {
    return renderViaAnvil({ packet, map, passport })
  }

  // No uploaded form to overlay → the clean SNAP packet is the deliverable.
  if (!map.sourceDocPath) return renderCleanPacket({ packet, map, passport })

  const { PDFDocument } = require('pdf-lib')
  const sourceBuffer = await s3GetBuffer(map.sourceDocPath)
  const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const fields = form.getFields()
  const textFields = fields.filter((f) => f.constructor.name === 'PDFTextField')
  const textNames = textFields.map((f) => f.getName())

  // A form with only a stray field or two is really a flat print-to-fill PDF
  // (CAPA's case) — route it to the automatic overlay, and fall back to the
  // clean SNAP packet when the overlay can't read it confidently. A genuine
  // fillable form (many text fields) uses the AcroForm path below.
  if (textFields.length < 5) {
    let result
    try {
      result = await renderViaFlatOverlay({ packet, map, passport, sourceBuffer })
    } catch (err) {
      console.error('[credMapPdf] overlay failed, falling back to clean packet:', err.message)
      return renderCleanPacket({ packet, map, passport })
    }
    if (result.confidence === 'LOW' || result.filledCount === 0) {
      return renderCleanPacket({ packet, map, passport })
    }
    return result
  }

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
  const saved = await storeGeneratedPdf(packet, map, outBuffer)
  return { ...saved, fieldCount: textNames.length, filledCount, signatureStamped, engine: 'acroform' }
}

/**
 * Fill via an Anvil PDF Template (flat / print-to-fill packets). The map's
 * anvilAliasMap ties each Anvil field alias to a passport value-key; we
 * resolve those against the live passport, ask the cred backend to fill the
 * template, and store the result exactly like the AcroForm path.
 */
async function renderViaAnvil({ packet, map, passport }) {
  const passportClient = require('./passportClient')
  const aliasMap = (map.anvilAliasMap && typeof map.anvilAliasMap === 'object') ? map.anvilAliasMap : {}

  const data = {}
  let filledCount = 0
  for (const [alias, valueKey] of Object.entries(aliasMap)) {
    const value = resolveValue(valueKey, passport)
    if (value) { data[alias] = value; filledCount++ }
  }

  const filled = await passportClient.fillAnvilPdf(map.anvilCastEid, data, `${packet.providerName || packet.npi} — ${map.name}`)

  const providerSlug = (packet.providerName || packet.npi).replace(/[^A-Za-z0-9]+/g, '_')
  const generatedDocName = `${providerSlug}_${map.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60)}_filled.pdf`
  const generatedDocPath = `credpackets/${packet.facilityId}/${packet.id}/${Date.now()}_${crypto.randomUUID()}.pdf`
  await s3PutBuffer(generatedDocPath, filled, 'application/pdf')
  await prisma.credPacket.update({ where: { id: packet.id }, data: { generatedDocPath, generatedDocName } })

  return { generatedDocPath, generatedDocName, fieldCount: Object.keys(aliasMap).length, filledCount, signatureStamped: false, engine: 'anvil' }
}

// ── Automatic flat-form overlay ──────────────────────────────────────────────
// Print-to-fill PDFs (CAPA's, and most real credentialing forms) have no
// digital fields. Instead of anyone placing boxes, the AI reads the form ONCE:
// pdfjs gives every printed word + its coordinates, the AI says which words
// are labels wanting provider data and where the value goes (right of / below
// the label), and we draw the value there. Map once, automatically, zero
// human box-placement — the Cred Map thesis applied to flat forms. The plan
// (label → value-key + coordinates + a confidence) is stored on the map and
// reused for every provider; the coordinator can correct any mapping.

const FLAT_FILL_TOOL = {
  name: 'record_flat_fills',
  description: 'Record which printed labels on a flat credentialing form should receive provider data, and where the value goes.',
  input_schema: {
    type: 'object',
    properties: {
      fills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            runIndex: { type: 'number', description: 'Index of the printed text run that is the field LABEL' },
            valueKey: { type: 'string', enum: VALUE_KEYS, description: 'Passport value that fills the blank next to this label' },
            placement: { type: 'string', enum: ['right', 'below'], description: 'Where the blank sits relative to the label' },
          },
          required: ['runIndex', 'valueKey', 'placement'],
        },
      },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'Overall confidence that this form was read cleanly and the blanks located' },
    },
    required: ['fills', 'confidence'],
  },
}

const FLAT_FILL_PROMPT = (runs) => `This is every printed text run on a facility's blank credentialing application (anesthesia providers), each with an index. Blank spaces/underlines where an applicant writes are NOT listed — only printed text is.

${runs.map((r) => `${r.idx}: "${r.str}"`).join('\n')}

Identify the runs that are FIELD LABELS expecting the provider's data (e.g. "Name", "NPI", "DEA #", "License Number", "Expiration Date", "Date of Birth"), and for each: which passport value fills the blank, and whether the blank is to the right of the label (same line) or below it.

Rules:
- Only map labels a provider's own data answers. Skip facility-internal fields, references, attestations, yes/no questions, signature/date-signed lines, section headers, and instructions.
- If a date label clearly belongs to a specific credential (e.g. "DEA Expiration"), use that credential's expirationDate.
- Prefer "right" placement unless the label clearly sits above its blank.
- Lower confidence if the form is dense/tabular or the text is garbled. Call record_flat_fills exactly once.`

// Extract every printed text run with page + PDF-space coordinates (bottom-left
// origin, matching pdf-lib's draw coordinates).
async function extractRuns(buffer) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const runs = []
  let idx = 0
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items) {
      const str = (item.str || '').trim()
      if (!str) continue
      runs.push({ idx: idx++, page: p, x: item.transform[4], y: item.transform[5], w: item.width || 0, h: item.height || 10, str })
    }
  }
  return runs
}

// Build the overlay plan for a flat form: AI maps labels → values + placement,
// resolved to page coordinates. Returns { confidence, fills:[{label, valueKey,
// page, x, y, placement}] }.
async function detectFlatFills(buffer) {
  const client = getClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')
  const runs = await extractRuns(buffer)
  if (runs.length === 0) return { confidence: 'LOW', fills: [] }
  const byIdx = new Map(runs.map((r) => [r.idx, r]))

  const resp = await withApiRetries(() => client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [FLAT_FILL_TOOL],
    tool_choice: { type: 'tool', name: 'record_flat_fills' },
    messages: [{ role: 'user', content: FLAT_FILL_PROMPT(runs) }],
  }))
  const call = resp.content.find((b) => b.type === 'tool_use')
  if (!call) return { confidence: 'LOW', fills: [] }

  const fills = []
  for (const f of call.input.fills || []) {
    const run = byIdx.get(f.runIndex)
    if (!run || !VALUE_KEYS.includes(f.valueKey) || f.valueKey === 'LEAVE_BLANK') continue
    const placement = f.placement === 'below' ? 'below' : 'right'
    const x = placement === 'right' ? run.x + run.w + 6 : run.x
    const y = placement === 'right' ? run.y : run.y - (run.h + 4)
    fills.push({ label: run.str, valueKey: f.valueKey, page: run.page, x, y, placement })
  }
  const confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(call.input.confidence) ? call.input.confidence : 'LOW'
  return { confidence, fills }
}

// Draw the plan's values onto the flat PDF.
async function renderViaFlatOverlay({ packet, map, passport, sourceBuffer }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

  let plan = map.flatFillPlan
  if (!plan || !Array.isArray(plan.fills)) {
    plan = await detectFlatFills(sourceBuffer)
    await prisma.credProgramMap.update({ where: { id: map.id }, data: { flatFillPlan: plan } })
  }

  const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true })
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()
  let filledCount = 0
  for (const fill of plan.fills) {
    const value = resolveValue(fill.valueKey, passport)
    if (!value) continue
    const page = pages[fill.page - 1]
    if (!page) continue
    page.drawText(String(value), { x: fill.x, y: fill.y, size: 9.5, font, color: rgb(0.07, 0.09, 0.15) })
    filledCount++
  }

  const out = Buffer.from(await pdfDoc.save())
  const saved = await storeGeneratedPdf(packet, map, out)
  return { ...saved, fieldCount: plan.fills.length, filledCount, confidence: plan.confidence, engine: 'overlay' }
}

// Fallback: a clean, complete SNAP packet PDF (pdfkit) — pixel-perfect, no
// per-facility work, used when the overlay's confidence on a given form is low
// or it filled almost nothing.
async function renderCleanPacket({ packet, map, passport }) {
  const PDFDocument = require('pdfkit')
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise((resolve) => doc.on('end', resolve))

  const prov = passport?.provider || {}
  const creds = passport?.credentials || []
  const credByType = Object.fromEntries(creds.map((c) => [c.type, c]))
  const S = passport?.sections || {}

  doc.fontSize(17).fillColor('#0F172A').text(map.name || 'Credentialing Packet', { continued: false })
  doc.moveTo(54, doc.y + 4).lineTo(558, doc.y + 4).lineWidth(2).strokeColor('#0F172A').stroke()
  doc.moveDown(0.7)
  doc.fontSize(13).fillColor('#0F172A').text(`${prov.firstName || ''} ${prov.lastName || ''}`.trim() || packet.providerName || `NPI ${packet.npi}`)
  doc.fontSize(10).fillColor('#64748B').text(`NPI ${packet.npi}${prov.dateOfBirth ? ` · DOB ${prov.dateOfBirth}` : ''}${prov.specialty ? ` · ${prov.specialty}` : ''}`)
  doc.moveDown(0.8)

  const line = (label, value) => {
    doc.fontSize(10).fillColor('#334155').text(label + ':  ', { continued: true }).fillColor(value ? '#0F172A' : '#CBD5E1').text(value || '—')
  }
  const section = (title) => { doc.moveDown(0.6); doc.fontSize(11).fillColor('#0F172A').text(title.toUpperCase()); doc.moveDown(0.2) }
  const credLine = (label, type) => {
    const c = credByType[type]
    line(label, c ? `${c.identifier || ''}${c.expirationDate ? `  (exp ${fmtDate(c.expirationDate)})` : ''}${c.status ? `  · ${c.status}` : ''}`.trim() : '')
  }

  section('Licensure')
  credLine('State license', 'STATE_LICENSE')
  credLine('State controlled substance', 'STATE_CS_LICENSE')
  credLine('DEA registration', 'DEA')
  section('Certifications')
  credLine('Board certification', 'BOARD_CERTIFICATION')
  credLine('ACLS', 'ACLS'); credLine('BLS', 'BLS')
  section('Malpractice')
  line('Carrier', S.malpractice?.carrier || '')
  credLine('Policy', 'MALPRACTICE_INSURANCE')
  if (S.malpractice?.hasHistory === false) line('History', 'None reported (attested)')
  if (Array.isArray(S.workHistory) && S.workHistory.length) {
    section('Work history')
    for (const w of S.workHistory) doc.fontSize(10).fillColor('#0F172A').text(`• ${w.role || ''} — ${w.employer || ''}  (${w.startDate || '?'}–${w.currentlyEmployed ? 'present' : (w.endDate || '?')})`)
  }
  if (Array.isArray(S.education) && S.education.length) {
    section('Education & training')
    for (const e of S.education) doc.fontSize(10).fillColor('#0F172A').text(`• ${e.level}${e.institution ? ` — ${e.institution}` : ''}${e.graduationDate ? `  ${e.graduationDate}` : ''}`)
  }

  doc.moveDown(1)
  doc.fontSize(8).fillColor('#94A3B8').text('Unless otherwise noted, all information was populated directly from the provider\'s verified SNAP Passport, read live at the time of generation.', { align: 'left' })

  doc.end()
  await done
  const out = Buffer.concat(chunks)
  const saved = await storeGeneratedPdf(packet, map, out)
  return { ...saved, filledCount: creds.length, engine: 'clean-packet' }
}

// ── Native SNAP form ─────────────────────────────────────────────────────────
// The scaling reframe made real: instead of overlaying the facility's PDF, we
// render SNAP's OWN document that mirrors THAT facility's application —
// section-by-section, field-by-field — populated from the live passport and the
// provider's saved answers (CredFormAnswer). Always renders perfectly; no
// per-facility placement. Requires map.formStructure (credFormStructure); with
// none it degrades to the generic clean packet.
async function renderNativeForm({ packet, map, passport }) {
  const structure = map.formStructure
  if (!structure || !Array.isArray(structure.sections) || structure.sections.length === 0) {
    return renderCleanPacket({ packet, map, passport })
  }
  const { questionKeyFor } = require('./credFormStructure')

  // Provider's saved answers (attestations + typed fields), keyed by questionKey.
  const answerRows = await prisma.credFormAnswer.findMany({
    where: { facilityId: packet.facilityId, npi: packet.npi },
  })
  const answers = Object.fromEntries(answerRows.map((a) => [a.questionKey, a]))

  // Latest captured e-signature to stamp on signature lines.
  const sig = await prisma.credSignature.findFirst({ where: { packetId: packet.id }, orderBy: { signedAt: 'desc' } })
  const sigPng = sig?.signatureData?.startsWith('data:image/png;base64,')
    ? Buffer.from(sig.signatureData.split(',')[1], 'base64') : null

  const PDFDocument = require('pdfkit')
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise((resolve) => doc.on('end', resolve))

  const prov = passport?.provider || {}
  const left = doc.page.margins.left
  const rightX = doc.page.width - doc.page.margins.right
  const bottom = () => doc.page.height - doc.page.margins.bottom
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage() }

  // Header — the application title (their form's name) + who it's for.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0F172A').text(structure.title || map.name || 'Credentialing Application')
  doc.moveTo(left, doc.y + 3).lineTo(rightX, doc.y + 3).lineWidth(2).strokeColor('#0F172A').stroke()
  doc.moveDown(0.6)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F172A')
    .text([prov.firstName, prov.middleName, prov.lastName, prov.suffix].filter(Boolean).join(' ').trim() || packet.providerName || `NPI ${packet.npi}`)
  doc.font('Helvetica').fontSize(9).fillColor('#64748B')
    .text(`NPI ${packet.npi}${prov.specialty ? ` · ${prov.specialty}` : ''}${packet.cycle === 'RENEWAL' ? ' · Reappointment' : ''}`)
  doc.moveDown(0.5)

  const sectionHeading = (title, description) => {
    ensure(46)
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F172A').text(String(title || 'Section').toUpperCase())
    doc.moveTo(left, doc.y + 2).lineTo(rightX, doc.y + 2).lineWidth(0.75).strokeColor('#CBD5E1').stroke()
    doc.moveDown(0.35)
    if (description) { doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#64748B').text(description); doc.moveDown(0.2) }
  }

  const kv = (label, value) => {
    const empty = value == null || value === ''
    doc.fontSize(9.5)
    doc.font('Helvetica-Bold').fillColor('#334155').text(`${label}:  `, { continued: true })
    if (empty) doc.font('Helvetica').fillColor('#CBD5E1').text('______________________________')
    else doc.font('Helvetica').fillColor('#0F172A').text(String(value))
  }

  const multiline = (label, value) => {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155').text(`${label}:`)
    const lines = String(value || '').split('\n').filter((l) => l.trim())
    if (lines.length === 0) { doc.font('Helvetica').fontSize(9.5).fillColor('#CBD5E1').text('   ______________________________'); return }
    for (const l of lines) doc.font('Helvetica').fontSize(9.5).fillColor('#0F172A').text(`   •  ${l}`)
  }

  for (const section of structure.sections) {
    sectionHeading(section.heading, section.description)
    // Collapse a run of consecutive SIGNATURE fields into one stamped block.
    // The extractor sometimes emits a paired "Date" line (or a duplicate
    // "Signature of applicant") as a second signature field at the same spot;
    // rendering each would stamp the captured signature twice in one place.
    // Genuinely distinct signature lines are never adjacent, so they survive.
    const fieldsToRender = []
    for (const f of section.fields || []) {
      const prev = fieldsToRender[fieldsToRender.length - 1]
      if (f.source === 'SIGNATURE' && prev && prev.source === 'SIGNATURE') continue
      fieldsToRender.push(f)
    }
    for (const field of fieldsToRender) {
      const qk = questionKeyFor(field, map.id)

      if (field.source === 'STATIC') {
        doc.moveDown(0.15)
        doc.font('Helvetica').fontSize(9).fillColor('#475569').text(field.label)
        continue
      }

      if (field.source === 'SIGNATURE') {
        ensure(64)
        doc.moveDown(0.5)
        if (sigPng) {
          try { doc.image(sigPng, left, doc.y, { fit: [190, 44] }) } catch { /* ignore bad png */ }
          doc.y += 46
        } else {
          doc.moveDown(1.4)
        }
        doc.moveTo(left, doc.y).lineTo(left + 260, doc.y).lineWidth(0.75).strokeColor('#94A3B8').stroke()
        doc.moveTo(left + 300, doc.y).lineTo(left + 430, doc.y).lineWidth(0.75).strokeColor('#94A3B8').stroke()
        doc.moveDown(0.15)
        const dateStr = sig ? fmtDate(sig.signedAt) : ''
        doc.font('Helvetica').fontSize(8).fillColor('#64748B')
          .text(field.label || 'Signature', left, doc.y, { continued: true, width: 260 })
          .text(`          Date${dateStr ? `:  ${dateStr}` : ''}`)
        if (sig) doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#94A3B8').text(`Signed electronically by ${sig.signerName}`)
        continue
      }

      if (field.source === 'ATTESTATION') {
        ensure(30)
        // This tenant's saved answer wins; else a canonical attestation the
        // provider answered on another facility's form (carried on the passport).
        let ansVal = answers[qk]?.value
        if (!ansVal && field.canonicalAttestation && field.canonicalAttestation !== 'OTHER') {
          ansVal = passport?.sections?.attestations?.[field.canonicalAttestation]?.value
        }
        const ans = String(ansVal || '').toUpperCase()
        const yes = ans === 'YES', no = ans === 'NO'
        doc.font('Helvetica').fontSize(9.5).fillColor('#0F172A').text(field.label)
        doc.font(yes || no ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(yes || no ? '#0F172A' : '#334155')
          .text(`      ${yes ? '[X]' : '[  ]'}  Yes        ${no ? '[X]' : '[  ]'}  No`)
        if (field.explain) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#94A3B8').text(`      ${field.explain}`)
        doc.moveDown(0.15)
        continue
      }

      // PASSPORT (auto-filled) or PROVIDER (typed once, saved to the answer layer)
      const value = field.source === 'PASSPORT'
        ? resolveValue(field.valueKey, passport)
        : (answers[qk]?.value || '')
      ensure(18)
      if (field.type === 'longtext' || String(value).includes('\n')) multiline(field.label, value)
      else kv(field.label, value)
      doc.moveDown(0.1)
    }
  }

  // ONE footer provenance line (document-voice principle: whisper in documents).
  doc.moveDown(1)
  ensure(30)
  doc.font('Helvetica').fontSize(7.5).fillColor('#94A3B8').text(
    'Auto-filled fields were populated directly from the provider’s verified SNAP Passport, read live at generation. ' +
    'Yes/no attestations and typed responses are the provider’s own answers; signatures were captured electronically with recorded consent (ESIGN/UETA).',
    { align: 'left' }
  )

  doc.end()
  await done
  const out = Buffer.concat(chunks)
  const saved = await storeGeneratedPdf(packet, map, out)
  return { ...saved, engine: 'native', sections: structure.sections.length, signatureStamped: Boolean(sigPng) }
}

// Shared: store a generated PDF to encrypted S3 and record it on the packet.
async function storeGeneratedPdf(packet, map, buffer) {
  const providerSlug = (packet.providerName || packet.npi).replace(/[^A-Za-z0-9]+/g, '_')
  const generatedDocName = `${providerSlug}_${map.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60)}_filled.pdf`
  const generatedDocPath = `credpackets/${packet.facilityId}/${packet.id}/${Date.now()}_${crypto.randomUUID()}.pdf`
  await s3PutBuffer(generatedDocPath, buffer, 'application/pdf')
  await prisma.credPacket.update({ where: { id: packet.id }, data: { generatedDocPath, generatedDocName } })
  return { generatedDocPath, generatedDocName }
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

module.exports = { renderFilledPdf, renderNativeForm, inspectFields, detectFlatFills, buildFieldMap, resolveValue, VALUE_KEYS }
