const PDFDocument = require('pdfkit')

const SNAP_BLUE = '#2563EB'
const DARK = '#0F172A'
const MID = '#374151'
const LIGHT = '#64748B'
const RULE = '#E2E8F0'
const GREEN = '#15803D'
const GREEN_BG = '#F0FDF4'

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function dateStr(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Generate a SNAP invoice PDF and pipe it to `res` (Express response).
 * @param {object} invoice - SnapInvoice row with lineItems parsed
 * @param {object} res - Express response object
 */
function generateInvoicePdf(invoice, res) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 56, bufferPages: true })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="SNAP-Invoice-${invoice.invoiceNumber}.pdf"`)
  doc.pipe(res)

  const W = 504 // content width (612 - 2*54 margins)
  const L = 56  // left margin

  // ── Header bar ───────────────────────────────────────────────────────────
  doc.rect(0, 0, 612, 90).fill(SNAP_BLUE)
  doc.fill('#fff').fontSize(26).font('Helvetica-Bold').text('SNAP', L, 28)
  doc.fontSize(11).font('Helvetica').text('Medical Technologies', L, 58)
  doc.fontSize(22).font('Helvetica-Bold').text('INVOICE', 0, 34, { align: 'right', width: 556 })
  doc.fill('#fff').fontSize(10).font('Helvetica')
    .text(`# ${invoice.invoiceNumber}`, 0, 62, { align: 'right', width: 556 })

  // ── Bill To / Invoice Meta ────────────────────────────────────────────────
  doc.y = 110
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('BILL TO', L, 110)
  doc.fill(DARK).fontSize(12).font('Helvetica-Bold').text(invoice.billingName, L, 123)
  doc.fill(MID).fontSize(10).font('Helvetica').text(invoice.billingEmail, L, 138)
  if (invoice.billingAddress) doc.text(invoice.billingAddress, L, 152)

  const metaX = 380
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('INVOICE DATE', metaX, 110)
  doc.fill(DARK).fontSize(10).font('Helvetica').text(dateStr(invoice.invoiceDate), metaX, 123)
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('DUE DATE', metaX, 140)
  doc.fill(DARK).fontSize(10).font('Helvetica').text(dateStr(invoice.dueDate), metaX, 153)
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('STATUS', metaX, 170)
  doc.fill(invoice.status === 'PAID' ? GREEN : SNAP_BLUE)
    .fontSize(10).font('Helvetica-Bold').text(invoice.status, metaX, 183)

  // ── Promo callout box ─────────────────────────────────────────────────────
  let y = 215
  if (invoice.promoFeatures && invoice.promoExpiresAt) {
    doc.roundedRect(L, y, W, 44, 6).fill(GREEN_BG)
    doc.fill(GREEN).fontSize(9).font('Helvetica-Bold')
      .text(`★  FOUNDING PARTNER — ${invoice.promoFeatures} access included through ${dateStr(invoice.promoExpiresAt)}`, L + 12, y + 8, { width: W - 24 })
    doc.fill(GREEN).fontSize(8).font('Helvetica')
      .text('Pricing adjusts to standard rate after the promotional period ends unless you elect to downgrade.', L + 12, y + 22, { width: W - 24 })
    y += 56
  }

  // ── Line items table header ───────────────────────────────────────────────
  doc.rect(L, y, W, 24).fill('#F1F5F9')
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold')
  doc.text('DESCRIPTION', L + 8, y + 8)
  doc.text('LIST PRICE', 390, y + 8)
  doc.text('DISCOUNT', 445, y + 8)
  doc.text('AMOUNT', 506, y + 8, { width: 50, align: 'right' })
  y += 24

  // ── Line items ────────────────────────────────────────────────────────────
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : JSON.parse(invoice.lineItems || '[]')

  lineItems.forEach((item, i) => {
    const rowH = item.detail ? 42 : 28
    if (i % 2 === 1) doc.rect(L, y, W, rowH).fill('#FAFAFA')
    doc.rect(L, y, W, rowH).stroke(RULE)

    doc.fill(DARK).fontSize(10).font('Helvetica-Bold').text(item.description, L + 8, y + 7, { width: 310 })
    if (item.detail) {
      doc.fill(LIGHT).fontSize(8).font('Helvetica').text(item.detail, L + 8, y + 21, { width: 310 })
    }

    doc.fill(MID).fontSize(10).font('Helvetica').text(fmt(item.listPrice), 385, y + 7, { width: 55, align: 'right' })

    if (item.discount > 0) {
      doc.fill('#DC2626').fontSize(10).text(`-${fmt(item.discount)}`, 440, y + 7, { width: 60, align: 'right' })
      if (item.discountLabel) {
        doc.fill('#DC2626').fontSize(7).font('Helvetica').text(item.discountLabel, 440, y + 21, { width: 60, align: 'right' })
      }
    } else {
      doc.fill(LIGHT).fontSize(10).text('—', 440, y + 7, { width: 60, align: 'right' })
    }

    doc.fill(DARK).fontSize(10).font('Helvetica-Bold').text(fmt(item.amount), 506, y + 7, { width: 50, align: 'right' })
    y += rowH
  })

  // ── Totals ────────────────────────────────────────────────────────────────
  y += 12
  const totX = 390

  if (invoice.discountTotal > 0) {
    doc.fill(LIGHT).fontSize(9).font('Helvetica').text('List Price (Standard Rate):', L, y, { width: W - 160 })
    doc.fill(MID).fontSize(9).text(fmt(invoice.listTotal), totX, y, { width: 166, align: 'right' })
    y += 16

    doc.fill(LIGHT).fontSize(9).text('Founder\'s Discount:', L, y, { width: W - 160 })
    doc.fill('#DC2626').fontSize(9).font('Helvetica-Bold').text(`-${fmt(invoice.discountTotal)}`, totX, y, { width: 166, align: 'right' })
    y += 16

    doc.moveTo(L, y).lineTo(L + W, y).stroke(RULE)
    y += 10
  }

  doc.rect(L, y, W, 36).fill(SNAP_BLUE)
  doc.fill('#fff').fontSize(13).font('Helvetica-Bold').text('TOTAL DUE', L + 12, y + 11)
  doc.fill('#fff').fontSize(16).font('Helvetica-Bold').text(fmt(invoice.amountDue), 0, y + 9, { align: 'right', width: 556 })
  y += 48

  // ── Savings callout ───────────────────────────────────────────────────────
  if (invoice.listTotal > invoice.amountDue) {
    const savings = invoice.listTotal - invoice.amountDue
    doc.fill(GREEN).fontSize(10).font('Helvetica-Bold')
      .text(`You're saving ${fmt(savings)} as a SNAP Founding Partner.`, L, y, { width: W })
    y += 20
  }

  // ── Payment instructions ──────────────────────────────────────────────────
  y += 16
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1).stroke(RULE)
  y += 14
  doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('PAYMENT INSTRUCTIONS', L, y)
  y += 12
  doc.fill(MID).fontSize(9).font('Helvetica')
    .text('Please remit payment by the due date above. Make checks payable to SNAP Medical Technologies.', L, y, { width: W })
  y += 14

  if (invoice.paymentLink) {
    doc.fill(SNAP_BLUE).fontSize(9).font('Helvetica-Bold').text('Pay online:', L, y)
    doc.fill(SNAP_BLUE).fontSize(9).font('Helvetica').text(invoice.paymentLink, L + 58, y, { width: W - 58, link: invoice.paymentLink })
    y += 14
  }

  doc.fill(MID).fontSize(9).font('Helvetica')
    .text('For wire transfer or ACH details, contact billing@snapmedical.app', L, y, { width: W })
  y += 20
  doc.fill(LIGHT).fontSize(8).text('Questions? Contact us at billing@snapmedical.app  ·  snapmedical.app', L, y, { width: W })

  if (invoice.notes) {
    y += 24
    doc.fill(LIGHT).fontSize(8).font('Helvetica-Bold').text('NOTES', L, y)
    y += 12
    doc.fill(MID).fontSize(9).font('Helvetica').text(invoice.notes, L, y, { width: W })
  }

  doc.end()
}

module.exports = { generateInvoicePdf }
