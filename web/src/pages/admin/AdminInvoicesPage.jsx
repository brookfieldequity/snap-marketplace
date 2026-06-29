import { useState, useEffect } from 'react'
import { adminAPI } from '../../api'

const TIERS = [
  { value: 'CORE', label: 'SNAP Core', desc: 'Scheduling + credentials + Snappy' },
  { value: 'STAFF_IQ', label: 'SNAP Staff IQ', desc: '+ optimization, savings, analytics' },
  { value: 'COMPLETE', label: 'SNAP Complete', desc: '+ marketplace, provider search' },
]
const BANDS = [
  { value: 25, label: 'Up to 25 providers' },
  { value: 75, label: '26–75 providers' },
  { value: 150, label: '76–150 providers' },
]
const PROMO_DURATIONS = [
  { value: 1, label: '1 Month' },
  { value: 2, label: '2 Months' },
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
]

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function bandKey(count) {
  if (count <= 25) return '25'
  if (count <= 75) return '75'
  return '150'
}

const STATUS_COLORS = {
  DRAFT: { bg: '#F1F5F9', color: '#475569' },
  SENT: { bg: '#EFF6FF', color: '#2563EB' },
  PAID: { bg: '#F0FDF4', color: '#15803D' },
  VOID: { bg: '#FEF2F2', color: '#DC2626' },
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.DRAFT
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: c.bg, color: c.color }}>
      {status}
    </span>
  )
}

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState([])
  const [pricing, setPricing] = useState(null)
  const [facilities, setFacilities] = useState([])
  const [showBuilder, setShowBuilder] = useState(false)
  const [sending, setSending] = useState({})
  const [marking, setMarking] = useState({})
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')

  // Builder form state
  const [form, setForm] = useState({
    facilityId: '',
    billingName: '',
    billingEmail: '',
    billingAddress: '',
    platformTier: 'CORE',
    providerBand: 75,
    includePlatform: true,
    credProviderCount: 0,
    credType: 'INITIAL',
    includeCred: false,
    marketplaceFeeAmount: 0,
    includeMarketplace: false,
    discountType: '',       // '' | 'FOUNDER'
    discountMonths: null,   // 1 | 2 | 3 | 6 — promo upgrade duration
    promoFeatures: 'SNAP Complete',
    notes: '',
    dueDays: 30,
  })

  useEffect(() => {
    adminAPI.listInvoices().then(setInvoices).catch(() => {})
    adminAPI.getInvoicePricing().then(setPricing).catch(() => {})
    adminAPI.getFacilities().then(d => setFacilities(d.facilities || d)).catch(() => {})
  }, [])

  // Auto-populate billing name/email when facility selected
  function handleFacilityChange(id) {
    const fac = facilities.find(f => f.id === id)
    setForm(f => ({
      ...f,
      facilityId: id,
      billingName: fac ? fac.name : f.billingName,
      billingEmail: fac?.billingEmail || fac?.users?.[0]?.user?.email || f.billingEmail,
    }))
  }

  // Compute live totals for the preview pane
  function computeTotals() {
    if (!pricing) return { lines: [], listTotal: 0, discountTotal: 0, amountDue: 0 }

    const lines = []
    const band = bandKey(form.providerBand)
    const isFounder = form.discountType === 'FOUNDER'

    if (form.includePlatform && form.platformTier) {
      const list = pricing.tiers[form.platformTier]?.[band] || 0
      const coreList = pricing.tiers['CORE']?.[band] || 0
      const discount = isFounder ? Math.max(0, list - coreList) : 0
      const promoNote = (form.discountMonths && form.promoFeatures && form.promoFeatures !== form.platformTier)
        ? ` + ${form.promoFeatures} free for ${form.discountMonths} month${form.discountMonths > 1 ? 's' : ''}`
        : ''
      const tierName = form.platformTier === 'STAFF_IQ' ? 'SNAP Staff IQ' : `SNAP ${form.platformTier.charAt(0) + form.platformTier.slice(1).toLowerCase()}`
      lines.push({
        label: `${tierName} (Annual)${promoNote}`,
        list,
        discount,
        amount: list - discount,
      })
    }

    if (form.includeCred && form.credProviderCount > 0) {
      const perProvider = form.credType === 'ANNUAL' ? pricing.credAnnualPrice : pricing.credListPrice
      const list = perProvider * form.credProviderCount
      const founderPer = Math.floor(perProvider / 2)
      const discount = isFounder ? (perProvider - founderPer) * form.credProviderCount : 0
      lines.push({
        label: `SNAP Credentialing — ${form.credProviderCount} providers (${form.credType === 'ANNUAL' ? 'annual' : 'initial setup'})`,
        list,
        discount,
        amount: list - discount,
      })
    }

    if (form.includeMarketplace && form.marketplaceFeeAmount > 0) {
      lines.push({
        label: 'Marketplace Transactions (4% fee)',
        list: form.marketplaceFeeAmount,
        discount: 0,
        amount: form.marketplaceFeeAmount,
      })
    }

    const listTotal = lines.reduce((s, l) => s + l.list, 0)
    const discountTotal = lines.reduce((s, l) => s + l.discount, 0)
    const amountDue = listTotal - discountTotal
    return { lines, listTotal, discountTotal, amountDue }
  }

  async function handleCreate() {
    if (!form.billingName || !form.billingEmail) return setMsg('Billing name and email are required.')
    setCreating(true)
    setMsg('')
    try {
      const payload = {
        facilityId: form.facilityId || undefined,
        billingName: form.billingName,
        billingEmail: form.billingEmail,
        billingAddress: form.billingAddress || undefined,
        ...(form.includePlatform ? { platformTier: form.platformTier, providerCount: form.providerBand } : {}),
        ...(form.includeCred ? { credProviderCount: form.credProviderCount, credType: form.credType } : { credProviderCount: 0 }),
        ...(form.includeMarketplace ? { marketplaceFeeAmount: form.marketplaceFeeAmount } : {}),
        discountType: form.discountType || undefined,
        discountMonths: form.discountMonths || undefined,
        promoFeatures: (form.discountMonths && form.promoFeatures) ? form.promoFeatures : undefined,
        notes: form.notes || undefined,
        dueDays: form.dueDays,
      }
      const inv = await adminAPI.createInvoice(payload)
      setInvoices(prev => [inv, ...prev])
      setShowBuilder(false)
      setMsg(`Invoice ${inv.invoiceNumber} created.`)
    } catch (e) {
      setMsg('Failed to create invoice: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleSend(id) {
    setSending(s => ({ ...s, [id]: true }))
    setMsg('')
    try {
      const inv = await adminAPI.sendInvoice(id)
      setInvoices(prev => prev.map(i => i.id === id ? inv : i))
      setMsg(`Invoice sent to ${inv.billingEmail}`)
    } catch (e) {
      setMsg('Send failed: ' + e.message)
    } finally {
      setSending(s => ({ ...s, [id]: false }))
    }
  }

  async function handleMarkPaid(id) {
    setMarking(s => ({ ...s, [id]: true }))
    try {
      const inv = await adminAPI.updateInvoice(id, { status: 'PAID', paidAt: new Date().toISOString() })
      setInvoices(prev => prev.map(i => i.id === id ? inv : i))
    } catch (e) {
      setMsg('Failed: ' + e.message)
    } finally {
      setMarking(s => ({ ...s, [id]: false }))
    }
  }

  async function handleVoid(id) {
    if (!confirm('Void this invoice?')) return
    try {
      await adminAPI.voidInvoice(id)
      setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'VOID' } : i))
    } catch (e) {
      setMsg('Failed: ' + e.message)
    }
  }

  const totals = computeTotals()

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0F172A' }}>Invoices</h2>
          <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>Generate and send invoices to facilities before Stripe is live.</p>
        </div>
        <button
          onClick={() => setShowBuilder(true)}
          style={{ background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          + New Invoice
        </button>
      </div>

      {msg && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#1E40AF', fontSize: 14 }}>
          {msg}
        </div>
      )}

      {/* Invoice builder modal */}
      {showBuilder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 860, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '20px 28px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>New Invoice</h3>
              <button onClick={() => setShowBuilder(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748B' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
              {/* Left: form */}
              <div style={{ padding: '24px 28px', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Bill to */}
                <div>
                  <Label>Facility (optional)</Label>
                  <select
                    value={form.facilityId}
                    onChange={e => handleFacilityChange(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— Custom billing info below —</option>
                    {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Label>Billing Name *</Label>
                    <input value={form.billingName} onChange={e => setForm(f => ({ ...f, billingName: e.target.value }))} style={inputStyle} placeholder="CAPA, LLC" />
                  </div>
                  <div>
                    <Label>Billing Email *</Label>
                    <input value={form.billingEmail} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} style={inputStyle} placeholder="billing@capa.com" />
                  </div>
                </div>

                <div>
                  <Label>Billing Address</Label>
                  <input value={form.billingAddress} onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))} style={inputStyle} placeholder="123 Main St, Boston MA 02101" />
                </div>

                {/* Platform subscription */}
                <SectionCard
                  checked={form.includePlatform}
                  onToggle={() => setForm(f => ({ ...f, includePlatform: !f.includePlatform }))}
                  title="Platform Subscription"
                >
                  {form.includePlatform && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                      <div>
                        <Label>Tier</Label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          {TIERS.map(t => (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() => setForm(f => ({ ...f, platformTier: t.value }))}
                              style={{
                                border: `2px solid ${form.platformTier === t.value ? '#2563EB' : '#E2E8F0'}`,
                                borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                                background: form.platformTier === t.value ? '#EFF6FF' : '#fff',
                                textAlign: 'left',
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700, color: form.platformTier === t.value ? '#2563EB' : '#0F172A' }}>{t.label}</div>
                              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{t.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Provider Band</Label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {BANDS.map(b => (
                            <button
                              key={b.value}
                              type="button"
                              onClick={() => setForm(f => ({ ...f, providerBand: b.value }))}
                              style={{
                                border: `2px solid ${form.providerBand === b.value ? '#2563EB' : '#E2E8F0'}`,
                                borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                                background: form.providerBand === b.value ? '#EFF6FF' : '#fff',
                                color: form.providerBand === b.value ? '#2563EB' : '#374151',
                                fontWeight: form.providerBand === b.value ? 700 : 400,
                              }}
                            >
                              {b.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>

                {/* Credentialing */}
                <SectionCard
                  checked={form.includeCred}
                  onToggle={() => setForm(f => ({ ...f, includeCred: !f.includeCred }))}
                  title="SNAP Credentialing Passport"
                >
                  {form.includeCred && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                      <div style={{ flex: 1 }}>
                        <Label>Provider Count</Label>
                        <input
                          type="number" min="0" value={form.credProviderCount}
                          onChange={e => setForm(f => ({ ...f, credProviderCount: parseInt(e.target.value) || 0 }))}
                          style={inputStyle}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <Label>Type</Label>
                        <select value={form.credType} onChange={e => setForm(f => ({ ...f, credType: e.target.value }))} style={inputStyle}>
                          <option value="INITIAL">Initial Setup ($500/provider)</option>
                          <option value="ANNUAL">Annual Renewal ($250/provider)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </SectionCard>

                {/* Marketplace fees */}
                <SectionCard
                  checked={form.includeMarketplace}
                  onToggle={() => setForm(f => ({ ...f, includeMarketplace: !f.includeMarketplace }))}
                  title="Marketplace Transaction Fee (4%)"
                >
                  {form.includeMarketplace && (
                    <div style={{ marginTop: 12 }}>
                      <Label>Fee Amount ($)</Label>
                      <input
                        type="number" min="0" value={form.marketplaceFeeAmount}
                        onChange={e => setForm(f => ({ ...f, marketplaceFeeAmount: parseFloat(e.target.value) || 0 }))}
                        style={inputStyle} placeholder="0"
                      />
                    </div>
                  )}
                </SectionCard>

                {/* Discount */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Label style={{ margin: 0 }}>Discount</Label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <DiscBtn active={!form.discountType} onClick={() => setForm(f => ({ ...f, discountType: '', discountMonths: null }))}>
                      No Discount
                    </DiscBtn>
                    <DiscBtn
                      active={form.discountType === 'FOUNDER'}
                      onClick={() => setForm(f => ({ ...f, discountType: 'FOUNDER' }))}
                      accent
                    >
                      ★ Founder's Pricing
                    </DiscBtn>
                  </div>

                  {form.discountType === 'FOUNDER' && (
                    <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
                        Promo Upgrade — include higher-tier features free for:
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {PROMO_DURATIONS.map(d => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, discountMonths: f.discountMonths === d.value ? null : d.value }))}
                            style={{
                              border: `2px solid ${form.discountMonths === d.value ? '#EA580C' : '#FED7AA'}`,
                              borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12,
                              background: form.discountMonths === d.value ? '#FFF7ED' : '#fff',
                              color: form.discountMonths === d.value ? '#EA580C' : '#92400E',
                              fontWeight: form.discountMonths === d.value ? 700 : 400,
                            }}
                          >
                            {d.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, discountMonths: null }))}
                          style={{
                            border: `2px solid ${!form.discountMonths ? '#EA580C' : '#FED7AA'}`,
                            borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12,
                            background: !form.discountMonths ? '#FFF7ED' : '#fff',
                            color: !form.discountMonths ? '#EA580C' : '#92400E',
                            fontWeight: !form.discountMonths ? 700 : 400,
                          }}
                        >
                          Pricing only
                        </button>
                      </div>
                      {form.discountMonths && (
                        <div>
                          <Label>Features to include free</Label>
                          <select
                            value={form.promoFeatures}
                            onChange={e => setForm(f => ({ ...f, promoFeatures: e.target.value }))}
                            style={inputStyle}
                          >
                            <option value="SNAP Staff IQ">SNAP Staff IQ</option>
                            <option value="SNAP Complete">SNAP Complete</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Label>Notes (appear on invoice)</Label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                    placeholder="Founding Partner agreement dated June 2026..."
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <Label>Due in (days)</Label>
                    <input
                      type="number" min="1" value={form.dueDays}
                      onChange={e => setForm(f => ({ ...f, dueDays: parseInt(e.target.value) || 30 }))}
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* Right: live preview */}
              <div style={{ padding: '24px 20px', background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                  Invoice Preview
                </div>

                {totals.lines.length === 0 ? (
                  <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    Select items on the left to preview pricing.
                  </div>
                ) : (
                  <>
                    {totals.lines.map((line, i) => (
                      <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '12px 14px', border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{line.label}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {line.discount > 0 ? (
                            <>
                              <span style={{ fontSize: 11, color: '#DC2626' }}>-{fmt(line.discount)} off</span>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: 11, color: '#94A3B8', textDecoration: 'line-through', marginRight: 6 }}>{fmt(line.list)}</span>
                                <span style={{ fontSize: 14, fontWeight: 800, color: '#15803D' }}>{fmt(line.amount)}</span>
                              </div>
                            </>
                          ) : (
                            <span style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', marginLeft: 'auto' }}>{fmt(line.amount)}</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {totals.discountTotal > 0 && (
                      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#15803D', fontWeight: 600 }}>
                        Saving {fmt(totals.discountTotal)} vs. standard rate
                      </div>
                    )}

                    <div style={{ background: '#2563EB', borderRadius: 8, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>TOTAL DUE</span>
                      <span style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>{fmt(totals.amountDue)}</span>
                    </div>

                    {totals.discountTotal > 0 && (
                      <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center' }}>
                        Standard rate: {fmt(totals.listTotal)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: '16px 28px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {msg && <span style={{ fontSize: 13, color: '#DC2626', alignSelf: 'center', marginRight: 'auto' }}>{msg}</span>}
              <button onClick={() => setShowBuilder(false)} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || totals.lines.length === 0}
                style={{ background: creating ? '#93C5FD' : '#2563EB', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer', fontSize: 14 }}
              >
                {creating ? 'Creating...' : 'Generate Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {invoices.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            No invoices yet. Click "New Invoice" to create the first one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Invoice #', 'Bill To', 'List Price', 'Discount', 'Amount Due', 'Due Date', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? '1px solid #F1F5F9' : 'none', background: i % 2 === 1 ? '#FAFAFA' : '#fff' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0F172A', fontSize: 13 }}>
                    {inv.invoiceNumber}
                    {inv.discountType === 'FOUNDER' && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#D97706', fontWeight: 700 }}>★ FOUNDER</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{inv.billingName}</div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>{inv.billingEmail}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B' }}>{fmt(inv.listTotal)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: inv.discountTotal > 0 ? '#DC2626' : '#94A3B8' }}>
                    {inv.discountTotal > 0 ? `-${fmt(inv.discountTotal)}` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 800, color: '#0F172A' }}>{fmt(inv.amountDue)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{fmtDate(inv.dueDate)}</td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={inv.status} /></td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <a
                        href={adminAPI.getInvoicePdfUrl(inv.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#F1F5F9', color: '#374151', fontWeight: 600, textDecoration: 'none', border: '1px solid #E2E8F0' }}
                      >
                        PDF
                      </a>
                      {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                        <button
                          onClick={() => handleSend(inv.id)}
                          disabled={!!sending[inv.id]}
                          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#EFF6FF', color: '#2563EB', fontWeight: 600, border: '1px solid #BFDBFE', cursor: 'pointer' }}
                        >
                          {sending[inv.id] ? '...' : 'Send'}
                        </button>
                      )}
                      {inv.status === 'SENT' && (
                        <button
                          onClick={() => handleMarkPaid(inv.id)}
                          disabled={!!marking[inv.id]}
                          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#F0FDF4', color: '#15803D', fontWeight: 600, border: '1px solid #BBF7D0', cursor: 'pointer' }}
                        >
                          {marking[inv.id] ? '...' : 'Paid'}
                        </button>
                      )}
                      {inv.status !== 'VOID' && inv.status !== 'PAID' && (
                        <button
                          onClick={() => handleVoid(inv.id)}
                          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', fontWeight: 600, border: '1px solid #FECACA', cursor: 'pointer' }}
                        >
                          Void
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Small reusable components ─────────────────────────────────────────────────

function Label({ children, style }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5, ...style }}>{children}</div>
}

const inputStyle = {
  width: '100%', padding: '8px 11px', borderRadius: 7, border: '1.5px solid #E2E8F0',
  fontSize: 13, color: '#0F172A', background: '#fff', boxSizing: 'border-box',
  outline: 'none',
}

function SectionCard({ checked, onToggle, title, children }) {
  return (
    <div style={{ border: `1.5px solid ${checked ? '#2563EB' : '#E2E8F0'}`, borderRadius: 10, padding: '12px 16px', transition: 'border-color .15s' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 16, height: 16, accentColor: '#2563EB' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: checked ? '#1D4ED8' : '#374151' }}>{title}</span>
      </label>
      {children}
    </div>
  )
}

function DiscBtn({ active, onClick, children, accent }) {
  const activeColor = accent ? '#B45309' : '#2563EB'
  const activeBg = accent ? '#FFFBEB' : '#EFF6FF'
  const activeBorder = accent ? '#FCD34D' : '#BFDBFE'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `2px solid ${active ? activeBorder : '#E2E8F0'}`,
        borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13,
        background: active ? activeBg : '#fff',
        color: active ? activeColor : '#374151',
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  )
}
