import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'
import WeeklyScorecard from '../../components/WeeklyScorecard.jsx'

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function StatCard({ label, value, icon, color = '#0F172A', sub, danger }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: '20px 24px',
        border: danger ? '1px solid #FCA5A5' : '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {label}
        </div>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: danger ? '#EF4444' : color, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.getAnalytics()
      .then(setData)
      .catch(() => setData(null)) // never fall back to fabricated metrics
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: '80px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading analytics…</div>

  const o = data?.overview || {}
  const billing = data?.billing || {}
  const licenseExpiringSoon = data?.licenseExpiringSoon || []

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Platform Overview</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Real-time SNAP marketplace metrics</p>
      </div>

      <WeeklyScorecard />

      {/* Primary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Providers"  value={o.totalProviders || 0}   icon="👩‍⚕️" color="#2563EB" />
        <StatCard label="Active Providers" value={o.activeProviders || 0}  icon="🟢" color="#10B981" />
        <StatCard label="Total Facilities" value={o.totalFacilities || 0}  icon="🏥" color="#0F172A" />
        <StatCard label="Fill Rate"        value={`${o.fillRate || 0}%`}   icon="🎯" color="#2563EB" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Gross Total Value"  value={fmt(o.totalGTV)}          icon="💰" color="#10B981" sub="All-time platform GTV" />
        <StatCard label="Platform Fees"      value={fmt(o.totalPlatformFees)} icon="📊" color="#2563EB" sub="5% platform fee" />
        <StatCard label="Disputed Shifts"    value={o.disputedShifts || 0}   icon="⚖️" danger={o.disputedShifts > 0} />
        <StatCard label="Flagged Messages"   value={o.flaggedMessages || 0}  icon="🚩" danger={o.flaggedMessages > 0} />
      </div>

      {/* Billing — real numbers from actual invoices only */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Billing</h3>
          <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>From actual invoices — manage in the Invoices tab</p>
          {[
            { label: 'Monthly recurring', value: fmt(billing.monthlyRecurring) + '/mo', sub: `${billing.monthlyInvoiceCount || 0} active monthly invoice${billing.monthlyInvoiceCount === 1 ? '' : 's'}`, color: '#2563EB' },
            { label: 'Outstanding (sent, unpaid)', value: fmt(billing.outstanding), sub: `${billing.outstandingCount || 0} invoice${billing.outstandingCount === 1 ? '' : 's'}`, color: (billing.outstanding || 0) > 0 ? '#D97706' : '#0F172A' },
            { label: 'Collected this year', value: fmt(billing.collectedYtd), sub: `${billing.collectedCount || 0} paid invoice${billing.collectedCount === 1 ? '' : 's'}`, color: '#15803D' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>{sub}</div>
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, color }}>{value}</span>
            </div>
          ))}
        </div>

        {/* License expiring */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
            MA License Expiring Soon
          </h3>
          <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>Providers with licenses expiring within 90 days</p>

          {licenseExpiringSoon.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#10B981', fontWeight: 600, fontSize: 14 }}>
              ✓ All licenses current
            </div>
          ) : (
            licenseExpiringSoon.map((p) => (
              <div
                key={p.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: p.daysLeft < 30 ? '#FEF2F2' : '#FFFBEB',
                  border: `1px solid ${p.daysLeft < 30 ? '#FCA5A5' : '#FCD34D'}`,
                  borderRadius: 10,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{p.firstName} {p.lastName}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{p.specialty}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: p.daysLeft < 30 ? '#DC2626' : '#D97706' }}>
                    {Math.max(0, Math.ceil((new Date(p.maLicenseExpiry) - new Date()) / 86400000))}d
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{p.maLicenseExpiry?.slice(0, 10)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  )
}
