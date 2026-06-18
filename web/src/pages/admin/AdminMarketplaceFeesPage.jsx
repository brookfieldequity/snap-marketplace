import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_STYLE = {
  PENDING: { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  CHARGED: { bg: '#ECFDF5', color: '#059669', border: '#6EE7B7' },
  FAILED: { bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5' },
  NOT_APPLICABLE: { bg: '#F1F5F9', color: '#64748B', border: '#E2E8F0' },
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.NOT_APPLICABLE
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 20, padding: '2px 8px' }}>
      {status === 'NOT_APPLICABLE' ? 'N/A' : status}
    </span>
  )
}

export default function AdminMarketplaceFeesPage() {
  const [summary, setSummary] = useState(null)
  const [fees, setFees] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([adminAPI.getMarketplaceFeeSummary(), adminAPI.getMarketplaceFees(filter)])
      .then(([sum, list]) => {
        setSummary(sum)
        setFees(list.fees || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [filter])

  const providerName = (f) => {
    const p = f.booking?.provider
    return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : '—'
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Marketplace Fees</h1>
      <div style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 20 }}>
        SNAP's 5% platform fee on dual-verified marketplace shifts. Fees accrue as <strong>Pending</strong> (a ledger of what
        facilities owe) — automatic charging turns on once Stripe billing is wired.
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Pending Fees', value: fmtMoney(summary.pendingAmount), sub: `${summary.pendingCount} shifts` },
            { label: 'Fees This Week', value: fmtMoney(summary.feesThisWeek) },
            { label: 'Charged (lifetime)', value: fmtMoney(summary.chargedAmount) },
            { label: 'Failed Charges', value: summary.failedCount, alert: summary.failedCount > 0 },
          ].map((c) => (
            <div key={c.label} style={card}>
              <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.alert ? '#DC2626' : '#0F172A' }}>{c.value}</div>
              {c.sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['', 'PENDING', 'CHARGED', 'FAILED'].map((s) => (
          <button
            key={s || 'ALL'}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid',
              borderColor: filter === s ? '#2563EB' : '#E2E8F0',
              background: filter === s ? '#EFF6FF' : '#fff',
              color: filter === s ? '#1D4ED8' : '#64748B',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ ...card, color: '#64748B' }}>Loading…</div>
      ) : fees.length === 0 ? (
        <div style={{ ...card, color: '#64748B' }}>No fees recorded yet.</div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr', padding: '10px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div>Facility</div>
            <div>Provider</div>
            <div>Shift Date</div>
            <div>Shift Value</div>
            <div>Fee (5%)</div>
            <div>Accrued</div>
            <div>Status</div>
          </div>
          {fees.map((f) => (
            <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1fr 1fr 1fr 1fr 0.8fr', padding: '12px 16px', borderBottom: '1px solid #F1F5F9', alignItems: 'center', fontSize: 13 }}>
              <div style={{ color: '#0F172A', fontWeight: 600 }}>{f.facility?.name || '—'}</div>
              <div style={{ color: '#64748B' }}>{providerName(f)}</div>
              <div style={{ color: '#64748B' }}>{f.booking?.shift?.date?.slice(0, 10) || '—'}</div>
              <div style={{ color: '#64748B' }}>{fmtMoney(f.shiftValue)}</div>
              <div style={{ color: '#059669', fontWeight: 700 }}>{fmtMoney(f.feeAmount)}</div>
              <div style={{ color: '#94A3B8', fontSize: 12 }}>{f.accruedAt?.slice(0, 10)}</div>
              <div>
                <StatusPill status={f.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
