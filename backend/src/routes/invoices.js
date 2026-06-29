const express = require('express')
const sgMail = require('@sendgrid/mail')
const prisma = require('../config/db')
const adminAuth = require('../middleware/adminAuth')
const { generateInvoicePdf } = require('../services/invoicePdf')

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

const FROM_EMAIL = process.env.SENDGRID_FROM || 'noreply@snapmedical.app'
const router = express.Router()

// Pricing table — Ryan's doc (annual, per provider band)
const PRICING = {
  CORE:     { '25': 18000,  '75': 30000,  '150': 48000  },
  STAFF_IQ: { '25': 30000,  '75': 48000,  '150': 78000  },
  COMPLETE: { '25': 40000,  '75': 65000,  '150': 105000 },
}
const CRED_LIST_PRICE = 500    // per provider, initial setup
const CRED_ANNUAL_PRICE = 250  // per provider, ongoing

function bandKey(count) {
  if (count <= 25) return '25'
  if (count <= 75) return '75'
  return '150'
}

function bandLabel(count) {
  if (count <= 25) return 'up to 25 providers'
  if (count <= 75) return '26–75 providers'
  return '76–150 providers'
}

function nextInvoiceNumber(last) {
  if (!last) return 'SNAP-2026-001'
  const parts = last.split('-')
  const n = parseInt(parts[2] || '0', 10) + 1
  return `SNAP-${parts[1]}-${String(n).padStart(3, '0')}`
}

// ── GET /api/admin/invoices — list all ──────────────────────────────────────
router.get('/', adminAuth, async (req, res) => {
  try {
    const invoices = await prisma.snapInvoice.findMany({
      include: { facility: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(invoices)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/admin/invoices/pricing — return pricing table ─────────────────
router.get('/pricing', adminAuth, (req, res) => {
  res.json({ tiers: PRICING, credListPrice: CRED_LIST_PRICE, credAnnualPrice: CRED_ANNUAL_PRICE })
})

// ── GET /api/admin/invoices/facility-admins/:facilityId ─────────────────────
router.get('/facility-admins/:facilityId', adminAuth, async (req, res) => {
  try {
    const members = await prisma.facilityUser.findMany({
      where: { facilityId: req.params.facilityId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { facilityRole: 'asc' },
    })
    res.json(members.map(m => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.facilityRole,
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/admin/invoices/:id — single invoice ────────────────────────────
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const inv = await prisma.snapInvoice.findUnique({
      where: { id: req.params.id },
      include: { facility: { select: { id: true, name: true } } },
    })
    if (!inv) return res.status(404).json({ error: 'Not found' })
    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/admin/invoices/:id/pdf — download PDF ──────────────────────────
router.get('/:id/pdf', adminAuth, async (req, res) => {
  try {
    const inv = await prisma.snapInvoice.findUnique({ where: { id: req.params.id } })
    if (!inv) return res.status(404).json({ error: 'Not found' })
    generateInvoicePdf(inv, res)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/admin/invoices — create ───────────────────────────────────────
router.post('/', adminAuth, async (req, res) => {
  try {
    const {
      facilityId,
      billingName,
      billingEmail,
      billingAddress,
      // Platform subscription
      platformTier,       // 'CORE' | 'STAFF_IQ' | 'COMPLETE'
      providerCount,      // number
      platformListPrice,  // override (or computed)
      // Credentialing
      credProviderCount,  // number (0 = no cred line item)
      credType,           // 'INITIAL' | 'ANNUAL'
      credListPrice: credListPriceOverride,
      // Marketplace fees
      marketplaceFeeAmount, // optional manual entry
      // Discount
      discountType,         // 'FOUNDER' | null
      discountMonths,       // 1 | 2 | 3 | 6 | null
      promoFeatures,        // e.g. 'SNAP Complete'
      // Custom line items
      extraLineItems,       // [{description, detail, listPrice, discount, discountLabel, amount}]
      // Meta
      notes,
      dueDays = 30,
      billingCycle = 'ONCE', // 'ONCE' | 'MONTHLY'
    } = req.body

    // Compute platform line item
    const lineItems = []

    if (platformTier && providerCount > 0) {
      const band = bandKey(providerCount)
      const list = platformListPrice || PRICING[platformTier]?.[band] || 0

      let discount = 0
      let discountLabel = null

      if (discountType === 'FOUNDER') {
        // Founder gets CORE pricing (cheapest tier for their band) regardless of what they're getting
        const corePrice = PRICING['CORE'][band]
        discount = Math.max(0, list - corePrice)
        if (discount > 0) discountLabel = 'Founding Partner Rate'
      }

      const tierLabel = platformTier === 'STAFF_IQ' ? 'SNAP Staff IQ' : `SNAP ${platformTier.charAt(0) + platformTier.slice(1).toLowerCase()}`
      const upgradeNote = (promoFeatures && discountMonths && promoFeatures !== platformTier)
        ? ` — includes ${promoFeatures} features for ${discountMonths} month${discountMonths > 1 ? 's' : ''}`
        : ''

      lineItems.push({
        description: `${tierLabel} — Annual Platform Subscription`,
        detail: `${bandLabel(providerCount)}${upgradeNote}`,
        listPrice: list,
        discount,
        discountLabel,
        amount: list - discount,
      })
    }

    // Credentialing line item
    if (credProviderCount > 0) {
      const isAnnual = credType === 'ANNUAL'
      const perProvider = credListPriceOverride || (isAnnual ? CRED_ANNUAL_PRICE : CRED_LIST_PRICE)
      const list = perProvider * credProviderCount

      let discount = 0
      let discountLabel = null

      if (discountType === 'FOUNDER') {
        // Founder rate: 50% off the list price
        const founderPer = Math.floor(perProvider / 2)
        discount = (perProvider - founderPer) * credProviderCount
        discountLabel = 'Founding Partner Rate'
      }

      lineItems.push({
        description: `SNAP Credentialing Passport — ${credProviderCount} Provider${credProviderCount > 1 ? 's' : ''}`,
        detail: `${isAnnual ? 'Annual renewal' : 'Initial setup'} @ ${discountType === 'FOUNDER' ? `$${Math.floor(perProvider / 2)}/provider (Founding Partner rate, standard $${perProvider})` : `$${perProvider}/provider`}`,
        listPrice: list,
        discount,
        discountLabel,
        amount: list - discount,
      })
    }

    // Marketplace transactions
    if (marketplaceFeeAmount > 0) {
      lineItems.push({
        description: 'Marketplace Transactions — 4% Platform Fee',
        detail: 'External shift fills via SNAP Marketplace',
        listPrice: marketplaceFeeAmount,
        discount: 0,
        discountLabel: null,
        amount: marketplaceFeeAmount,
      })
    }

    // Extra custom line items
    if (Array.isArray(extraLineItems)) {
      lineItems.push(...extraLineItems)
    }

    const listTotal = lineItems.reduce((s, i) => s + (i.listPrice || 0), 0)
    const discountTotal = lineItems.reduce((s, i) => s + (i.discount || 0), 0)
    const amountDue = listTotal - discountTotal

    // Compute promo expiry
    let promoExpiresAt = null
    if (discountMonths && promoFeatures) {
      const d = new Date()
      d.setMonth(d.getMonth() + discountMonths)
      promoExpiresAt = d
    }

    // Get last invoice number for auto-increment
    const last = await prisma.snapInvoice.findFirst({ orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } })
    const invoiceNumber = nextInvoiceNumber(last?.invoiceNumber)

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + dueDays)

    // For monthly billing, schedule first auto-send on the 1st of next month
    let nextRecurAt = null
    if (billingCycle === 'MONTHLY') {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      d.setDate(1)
      d.setHours(8, 0, 0, 0)
      nextRecurAt = d
    }

    const inv = await prisma.snapInvoice.create({
      data: {
        invoiceNumber,
        facilityId: facilityId || null,
        billingName,
        billingEmail,
        billingAddress: billingAddress || null,
        lineItems,
        listTotal,
        discountTotal,
        amountDue,
        discountType: discountType || null,
        promoFeatures: promoFeatures || null,
        promoExpiresAt,
        notes: notes || null,
        dueDate,
        billingCycle,
        nextRecurAt,
      },
    })

    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── PATCH /api/admin/invoices/:id — update status / notes ───────────────────
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { status, notes, paidAt } = req.body
    const data = {}
    if (status) data.status = status
    if (notes !== undefined) data.notes = notes
    if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt) : null
    const inv = await prisma.snapInvoice.update({ where: { id: req.params.id }, data })
    res.json(inv)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/admin/invoices/:id/send — email PDF to billing contact ─────────
router.post('/:id/send', adminAuth, async (req, res) => {
  try {
    const inv = await prisma.snapInvoice.findUnique({ where: { id: req.params.id } })
    if (!inv) return res.status(404).json({ error: 'Not found' })

    if (!process.env.SENDGRID_API_KEY) {
      return res.status(503).json({ error: 'SendGrid not configured — set SENDGRID_API_KEY' })
    }

    const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    const dateStr = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const lineItems = Array.isArray(inv.lineItems) ? inv.lineItems : JSON.parse(inv.lineItems || '[]')

    const lineRows = lineItems.map(item => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;">
          <strong style="color:#0F172A">${esc(item.description)}</strong>
          ${item.detail ? `<br><span style="font-size:12px;color:#64748B">${esc(item.detail)}</span>` : ''}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;text-align:right;color:#374151">${fmt(item.listPrice)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;text-align:right;color:${item.discount > 0 ? '#DC2626' : '#94A3B8'}">
          ${item.discount > 0 ? `-${fmt(item.discount)}` : '—'}
          ${item.discountLabel ? `<br><span style="font-size:11px">${esc(item.discountLabel)}</span>` : ''}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700;color:#0F172A">${fmt(item.amount)}</td>
      </tr>`).join('')

    const promoBox = (inv.promoFeatures && inv.promoExpiresAt) ? `
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:14px 18px;margin:20px 0;">
        <strong style="color:#15803D">★ FOUNDING PARTNER</strong> — ${inv.promoFeatures} access included through ${dateStr(inv.promoExpiresAt)}.<br>
        <span style="font-size:12px;color:#166534">Pricing adjusts to standard rate after the promotional period ends unless you elect to downgrade.</span>
      </div>` : ''

    const savingsLine = inv.listTotal > inv.amountDue
      ? `<p style="color:#15803D;font-weight:600;margin-top:12px">You're saving ${fmt(inv.listTotal - inv.amountDue)} as a SNAP Founding Partner.</p>`
      : ''

    const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F8FAFC;margin:0;padding:20px">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
  <div style="background:#2563EB;padding:28px 32px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="color:#fff;font-size:24px;font-weight:800">SNAP</div>
      <div style="color:#BFDBFE;font-size:12px">Medical Technologies</div>
    </div>
    <div style="text-align:right">
      <div style="color:#fff;font-size:22px;font-weight:700">INVOICE</div>
      <div style="color:#BFDBFE;font-size:13px"># ${inv.invoiceNumber}</div>
    </div>
  </div>
  <div style="padding:28px 32px">
    <div style="display:flex;justify-content:space-between;margin-bottom:24px">
      <div>
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Bill To</div>
        <div style="font-size:16px;font-weight:700;color:#0F172A">${esc(inv.billingName)}</div>
        <div style="color:#475569">${esc(inv.billingEmail)}</div>
        ${inv.billingAddress ? `<div style="color:#475569;font-size:13px">${esc(inv.billingAddress)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Invoice Date</div>
        <div style="color:#0F172A;margin-bottom:8px">${dateStr(inv.invoiceDate)}</div>
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Due Date</div>
        <div style="color:#0F172A">${dateStr(inv.dueDate)}</div>
      </div>
    </div>
    ${promoBox}
    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <thead>
        <tr style="background:#F1F5F9">
          <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase">Description</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase">List Price</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase">Discount</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>
    ${inv.discountTotal > 0 ? `
    <div style="text-align:right;margin-bottom:8px;color:#64748B">
      List Price (Standard Rate): <strong style="margin-left:16px">${fmt(inv.listTotal)}</strong>
    </div>
    <div style="text-align:right;margin-bottom:12px;color:#DC2626">
      Founder's Discount: <strong style="margin-left:16px">-${fmt(inv.discountTotal)}</strong>
    </div>` : ''}
    <div style="background:#2563EB;border-radius:8px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
      <span style="color:#fff;font-size:15px;font-weight:700">TOTAL DUE</span>
      <span style="color:#fff;font-size:20px;font-weight:800">${fmt(inv.amountDue)}</span>
    </div>
    ${savingsLine}
    ${inv.notes ? `<div style="margin-top:16px;padding:12px 16px;background:#F8FAFC;border-radius:6px;font-size:13px;color:#475569">${esc(inv.notes)}</div>` : ''}
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0">
    <div style="font-size:12px;color:#64748B">
      <strong>Payment Instructions:</strong><br>
      Please remit payment by ${dateStr(inv.dueDate)}. Make checks payable to SNAP Medical Technologies.<br>
      For wire transfer or ACH details, contact <a href="mailto:billing@snapmedical.app" style="color:#2563EB">billing@snapmedical.app</a>
    </div>
  </div>
</div>
</body></html>`

    // Build recipient list — billingEmail always included, plus any extra admins
    const { recipientEmails } = req.body
    const allEmails = Array.from(new Set([
      inv.billingEmail,
      ...(Array.isArray(recipientEmails) ? recipientEmails : []),
    ].filter(Boolean)))

    await sgMail.send({
      to: allEmails.length === 1 ? allEmails[0] : allEmails.map(e => ({ email: e })),
      from: { email: FROM_EMAIL, name: 'SNAP Medical Technologies' },
      subject: `Invoice ${inv.invoiceNumber} from SNAP Medical — Due ${dateStr(inv.dueDate)}`,
      html,
    })

    const updated = await prisma.snapInvoice.update({
      where: { id: inv.id },
      data: { sentAt: new Date(), status: inv.status === 'DRAFT' ? 'SENT' : inv.status },
    })

    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/admin/invoices/:id — void/delete ─────────────────────────────
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await prisma.snapInvoice.update({ where: { id: req.params.id }, data: { status: 'VOID' } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Monthly recurring invoice auto-send ──────────────────────────────────────
// Called by the daily cron in src/index.js. Finds all MONTHLY invoices whose
// nextRecurAt is today or earlier (non-VOID), sends the email, then advances
// nextRecurAt by one month.
async function processMonthlyInvoices() {
  if (!process.env.SENDGRID_API_KEY) return

  const due = await prisma.snapInvoice.findMany({
    where: { billingCycle: 'MONTHLY', nextRecurAt: { lte: new Date() }, status: { not: 'VOID' } },
  })
  if (!due.length) return

  const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const dateStr = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const monthLabel = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  for (const inv of due) {
    try {
      const period = monthLabel(inv.nextRecurAt)
      const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F8FAFC;margin:0;padding:20px">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
  <div style="background:#2563EB;padding:28px 32px;display:flex;justify-content:space-between;align-items:center">
    <div><div style="color:#fff;font-size:24px;font-weight:800">SNAP</div><div style="color:#BFDBFE;font-size:12px">Medical Technologies</div></div>
    <div style="text-align:right"><div style="color:#fff;font-size:22px;font-weight:700">INVOICE</div><div style="color:#BFDBFE;font-size:13px"># ${esc(inv.invoiceNumber)} · ${esc(period)}</div></div>
  </div>
  <div style="padding:28px 32px">
    <div style="background:#EFF6FF;border-radius:8px;padding:12px 18px;margin-bottom:20px;font-size:13px;color:#1D4ED8">
      <strong>Monthly installment</strong> — ${esc(period)}. This invoice is sent automatically each month.
    </div>
    <div style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Bill To</div>
      <div style="font-size:16px;font-weight:700;color:#0F172A">${esc(inv.billingName)}</div>
      <div style="color:#475569">${esc(inv.billingEmail)}</div>
    </div>
    <div style="background:#2563EB;border-radius:8px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
      <span style="color:#fff;font-size:15px;font-weight:700">AMOUNT DUE — ${esc(period)}</span>
      <span style="color:#fff;font-size:20px;font-weight:800">${fmt(inv.amountDue)}</span>
    </div>
    ${inv.notes ? `<div style="margin-top:16px;padding:12px 16px;background:#F8FAFC;border-radius:6px;font-size:13px;color:#475569">${esc(inv.notes)}</div>` : ''}
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0">
    <div style="font-size:12px;color:#64748B">
      <strong>Payment Instructions:</strong><br>
      Monthly installment due within 30 days. Make checks payable to SNAP Medical Technologies.<br>
      For wire / ACH details contact <a href="mailto:billing@snapmedical.app" style="color:#2563EB">billing@snapmedical.app</a>
    </div>
  </div>
</div>
</body></html>`

      await sgMail.send({
        to: inv.billingEmail,
        from: { email: FROM_EMAIL, name: 'SNAP Medical Technologies' },
        subject: `Monthly invoice ${inv.invoiceNumber} from SNAP Medical — ${period}`,
        html,
      })

      // Advance nextRecurAt by one month
      const next = new Date(inv.nextRecurAt)
      next.setMonth(next.getMonth() + 1)

      await prisma.snapInvoice.update({
        where: { id: inv.id },
        data: { sentAt: new Date(), status: 'SENT', nextRecurAt: next },
      })

      console.log(`[invoices] Monthly auto-send: ${inv.invoiceNumber} → ${period}`)
    } catch (e) {
      console.error(`[invoices] Monthly auto-send failed for ${inv.invoiceNumber}:`, e.message)
    }
  }
}

module.exports = { router, processMonthlyInvoices }
