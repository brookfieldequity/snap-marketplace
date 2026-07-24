/**
 * WC Recovery rung-1 packet rendering (2026-07-24).
 *
 * Renders the three first-line documents (brief §8/§8A) straight from the
 * normalized case + its entitlement calc — deterministic, citation-first:
 *
 *   AUDIT           — internal unit-math proof (entitled vs paid, line by line)
 *   DEMAND_LETTER   — payment demand to the carrier citing 114.3 CMR 40.05(2)
 *   CORRECTED_CLAIM — corrected claim summary for resubmission
 *
 * Rendered on demand and piped to the response (same posture as
 * invoicePdf.js); the WcDocument row is the staged/sent state, the PDF is a
 * pure function of case data. Document voice: ONE footer provenance line.
 */

const PDFDocument = require('pdfkit')
const { PATTERN_LABELS } = require('./wcEngine')

const SNAP_BLUE = '#2563EB'
const DARK = '#0F172A'
const MID = '#374151'
const LIGHT = '#64748B'
const RULE = '#E2E8F0'
const RED = '#B91C1C'
const RED_BG = '#FEF2F2'
const GREEN = '#15803D'

const L = 56
const W = 500

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
// Date-only values are stored as UTC midnight — format in UTC so a 2026-04-14
// DOS never prints as April 13 in Eastern time.
const dstr = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '—')

function header(doc, title, subtitle) {
  doc.rect(0, 0, 612, 84).fill(SNAP_BLUE)
  doc.fill('#fff').fontSize(20).font('Helvetica-Bold').text(title, L, 24)
  doc.fontSize(10).font('Helvetica').text(subtitle, L, 52)
  doc.y = 108
}

function footer(doc) {
  // Whisper in documents: one provenance statement, nothing else. (lineBreak
  // off + y above the bottom margin so this never spills onto a new page.)
  doc.fontSize(8).fill(LIGHT).font('Helvetica')
    .text('Prepared with SNAP WC Recovery — entitlement computed under 114.3 CMR 40.05(2).', L, 718, { width: W, align: 'center', lineBreak: false })
}

function kv(doc, rows) {
  doc.fontSize(10)
  for (const [k, v] of rows) {
    const y = doc.y
    doc.font('Helvetica-Bold').fill(MID).text(k, L, y, { width: 170 })
    doc.font('Helvetica').fill(DARK).text(v ?? '—', L + 180, y, { width: W - 180 })
    doc.moveDown(0.35)
  }
}

function caseHeaderRows(c, client) {
  return [
    ['Group', client?.name || '—'],
    ['Claim number', c.claimNumber || '—'],
    ['Patient ref', c.patientRef || '—'],
    ['Payer / carrier', c.payerName || '—'],
    ['Adjuster', c.adjusterName || '—'],
    ['Employer', c.employerName || '—'],
    ['Date of injury', dstr(c.dateOfInjury)],
    ['Date of service', dstr(c.dateOfService)],
    ['Body part', c.bodyPart || '—'],
    ['Authorization', c.authorization || '—'],
  ]
}

// The unit-math table every rung-1 document is built on.
function unitTable(doc, c, calc) {
  const rows = [
    ['Base units' + (c.asaCptCode ? `  (CPT ${c.asaCptCode})` : ''), calc.inputsJson.baseUnits],
    [`Time units  (${c.anesthesiaMinutes} min ÷ ${calc.minutesPerUnit} min/unit)`, calc.inputsJson.timeUnits],
    ...(calc.inputsJson.physicalStatusUnits
      ? [[`Physical-status units  (${c.physicalStatus})`, calc.inputsJson.physicalStatusUnits]] : []),
    ...(calc.inputsJson.qualifyingCircumstanceUnits
      ? [[`Qualifying-circumstance units  (${(c.qualifyingCircs || []).join(', ')})`, calc.inputsJson.qualifyingCircumstanceUnits]] : []),
  ]
  const startY = doc.y + 6
  doc.fontSize(10)
  let y = startY
  for (const [label, units] of rows) {
    doc.font('Helvetica').fill(DARK).text(label, L, y, { width: 360 })
    doc.font('Helvetica').fill(DARK).text(String(units), L + 380, y, { width: 100, align: 'right' })
    y = doc.y + 4
  }
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(RULE).stroke()
  y += 6
  doc.font('Helvetica-Bold').fill(DARK)
    .text('Total units', L, y, { width: 360 })
    .text(String(calc.totalUnits), L + 380, y, { width: 100, align: 'right' })
  y = doc.y + 4
  doc.font('Helvetica-Bold')
    .text(`× $${calc.conversionFactor.toFixed(2)} per unit (114.3 CMR 40.05(2))`, L, y, { width: 360 })
    .text(money(calc.entitledAmount), L + 380, y, { width: 100, align: 'right' })
  doc.moveDown(1)
}

function gapBox(doc, c) {
  const y = doc.y + 6
  doc.rect(L, y, W, 58).fill(RED_BG)
  doc.fontSize(10).font('Helvetica-Bold').fill(RED).text('UNDERPAYMENT', L + 14, y + 10)
  // ASCII minus — U+2212 is outside WinAnsi and renders as a stray quote.
  doc.fontSize(10).font('Helvetica').fill(DARK)
    .text(`Entitled ${money(c.entitledAmount)}   -   Paid ${money(c.paidAmount)}   =   `, L + 14, y + 28, { continued: true })
    .font('Helvetica-Bold').fill(RED).text(`${money(c.gapAmount)} owed`)
  doc.y = y + 70
}

function renderAudit(doc, c, calc, client) {
  header(doc, 'Entitlement Audit', 'Workers’ Compensation anesthesia — Massachusetts')
  kv(doc, caseHeaderRows(c, client))
  doc.moveDown(0.6)
  doc.fontSize(12).font('Helvetica-Bold').fill(DARK).text('Massachusetts entitlement (114.3 CMR 40.05(2))', L)
  unitTable(doc, c, calc)
  if (c.gapAmount != null && c.gapAmount > 0) {
    gapBox(doc, c)
    if (c.underpaymentReason && PATTERN_LABELS[c.underpaymentReason]) {
      doc.fontSize(10).font('Helvetica-Bold').fill(MID).text('Detected pattern: ', L, doc.y, { continued: true })
        .font('Helvetica').fill(DARK).text(PATTERN_LABELS[c.underpaymentReason])
    }
  } else if (c.paidAmount != null) {
    doc.fontSize(10).font('Helvetica-Bold').fill(GREEN).text('Paid at or above the schedule entitlement.', L)
  }
  doc.moveDown(1)
  doc.fontSize(9).font('Helvetica').fill(LIGHT).text(
    `Computation method: ${calc.method} · Schedule version: ${calc.scheduleVersion} · Generated ${dstr(new Date())}. ` +
    'Under M.G.L. c. 152 § 13, a rate below the schedule is valid only where negotiated by the insurer, employer, and provider together.',
    L, doc.y, { width: W })
}

function renderDemand(doc, c, calc, client) {
  header(doc, 'Demand for Payment — Corrected Reimbursement', 'Workers’ Compensation anesthesia — Massachusetts')
  doc.fontSize(10).font('Helvetica').fill(DARK)
  doc.text(dstr(new Date()), L)
  doc.moveDown(0.8)
  doc.text(`To: ${c.payerName || 'Claims Department'}${c.adjusterName ? `, Attn: ${c.adjusterName}` : ''}`, L)
  doc.text(`Re: WC claim ${c.claimNumber || '—'} · Patient ref ${c.patientRef || '—'} · DOS ${dstr(c.dateOfService)}`, L)
  doc.moveDown(1)

  doc.text(
    `${client?.name || 'The anesthesia group'} provided anesthesia services on the above claim. ` +
    'Under M.G.L. c. 152 § 13, reimbursement for these services is governed by the rates established at ' +
    '114.3 CMR 40.00; the anesthesia methodology at 114.3 CMR 40.05(2) provides that payment equals ' +
    `(base units + time units + modifying units) × $${calc.conversionFactor.toFixed(2)} per unit, with each time unit equal to ${calc.minutesPerUnit} minutes.`,
    L, doc.y, { width: W, align: 'justify' })
  doc.moveDown(0.8)

  doc.fontSize(11).font('Helvetica-Bold').text('Schedule entitlement for this case', L)
  unitTable(doc, c, calc)
  gapBox(doc, c)

  if (c.underpaymentReason && PATTERN_LABELS[c.underpaymentReason] && c.underpaymentReason !== 'PAID_IN_FULL') {
    doc.fontSize(10).font('Helvetica').fill(DARK).text(
      `Our review indicates the following: ${PATTERN_LABELS[c.underpaymentReason]}. ` +
      'No rate below the schedule has been negotiated with this group under § 13, and payment below the ' +
      'established rate absent such an agreement is a practice prohibited under 452 CMR 7.00.',
      L, doc.y, { width: W, align: 'justify' })
    doc.moveDown(0.8)
  }

  doc.font('Helvetica').text(
    `Demand is made for payment of the outstanding balance of ${money(c.gapAmount)} within 30 days of this letter. ` +
    'Supporting unit-level computation is enclosed (Entitlement Audit). Absent correction, the group reserves all ' +
    'remedies, including complaint to the Department of Industrial Accidents.',
    L, doc.y, { width: W, align: 'justify' })
  doc.moveDown(1.2)
  doc.text('Sincerely,', L)
  doc.moveDown(1.4)
  doc.text(`${client?.name || ''} — Billing`, L)
}

function renderCorrectedClaim(doc, c, calc, client) {
  header(doc, 'Corrected Claim Summary', 'Workers’ Compensation anesthesia — Massachusetts')
  kv(doc, caseHeaderRows(c, client))
  doc.moveDown(0.6)
  doc.fontSize(12).font('Helvetica-Bold').fill(DARK).text('Corrected billing detail', L)
  doc.moveDown(0.3)
  kv(doc, [
    ['Anesthesia CPT', c.asaCptCode || '—'],
    ['Physical status', c.physicalStatus || 'None billed'],
    ['Qualifying circumstances', (c.qualifyingCircs || []).join(', ') || 'None billed'],
    ['Anesthesia time', c.anesthesiaMinutes != null ? `${c.anesthesiaMinutes} minutes` : '—'],
  ])
  doc.moveDown(0.4)
  unitTable(doc, c, calc)
  doc.fontSize(10).font('Helvetica').fill(DARK).text(
    `Correct reimbursement under 114.3 CMR 40.05(2): ${money(calc.entitledAmount)}. ` +
    `Amount received to date: ${money(c.paidAmount)}. Balance due: ${money(c.gapAmount)}.`,
    L, doc.y, { width: W })
}

const RENDERERS = {
  AUDIT: renderAudit,
  DEMAND_LETTER: renderDemand,
  CORRECTED_CLAIM: renderCorrectedClaim,
}

/**
 * Render one rung-1 document for a case and pipe it to the Express response.
 * `c` must include entitlementCalc + client.
 */
function renderDocPdf(type, c, res) {
  const render = RENDERERS[type]
  if (!render) throw new Error(`No renderer for ${type}`)
  if (!c.entitlementCalc) throw new Error('Entitlement not computed yet')

  const doc = new PDFDocument({ size: 'LETTER', margin: 56 })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="WC-${type}-${(c.claimNumber || c.id).replace(/[^\w.-]/g, '_')}.pdf"`)
  doc.pipe(res)
  render(doc, c, c.entitlementCalc, c.client)
  footer(doc)
  doc.end()
}

module.exports = { renderDocPdf, RENDERABLE_TYPES: Object.keys(RENDERERS) }
