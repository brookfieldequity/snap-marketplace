import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

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

const MOCK = {
  providers: { total: 48, active: 31, credentialed: 42 },
  facilities: { total: 17, basic: 8, professional: 7, enterprise: 2 },
  shifts: { total: 284, disputed: 3, filled: 241, fillRate: 84.9 },
  revenue: {
    gtv: 1240000,
    platformFees: 124000,
    subscriptionRevenue: {
      basic: 6000,
      professional: 14000,
      enterprise: 10000,
    },
  },
  flaggedMessages: 4,
  licenseExpiringSoon: [
    { name: 'Dr. Tom Walsh',   specialty: 'CRNA',             daysLeft: 22, expiry: '2026-06-14' },
    { name: 'Dr. Raj Patel',   specialty: 'Anesthesiologist', daysLeft: 45, expiry: '2026-07-07' },
    { name: 'Dr. Claire Dunn', specialty: 'CRNA',             daysLeft: 68, expiry: '2026-07-30' },
  ],
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.getAnalytics()
      .then(setData)
      .catch(() => setData(MOCK))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: '80px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading analytics…</div>

  const o = data?.overview || {}
  const subRev = data?.subscriptionRevenue || {}
  const subCounts = data?.subscriptionCounts || {}
  const subRevTotal = (subRev.BASIC || 0) + (subRev.PROFESSIONAL || 0) + (subRev.ENTERPRISE || 0)
  const licenseExpiringSoon = data?.licenseExpiringSoon || []

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Platform Overview</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Real-time SNAP marketplace metrics</p>
      </div>

      {/* Primary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Providers"  value={o.totalProviders || 0}   icon="👩‍⚕️" color="#2563EB" />
        <StatCard label="Active Providers" value={o.activeProviders || 0}  icon="🟢" color="#10B981" />
        <StatCard label="Total Facilities" value={o.totalFacilities || 0}  icon="🏥" color="#0F172A" />
        <StatCard label="Fill Rate"        value={`${o.fillRate || 0}%`}   icon="🎯" color="#2563EB" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Gross Total Value"  value={fmt(o.totalGTV)}          icon="💰" color="#10B981" sub="All-time platform GTV" />
        <StatCard label="Platform Fees"      value={fmt(o.totalPlatformFees)} icon="📊" color="#2563EB" sub="10% of GTV" />
        <StatCard label="Disputed Shifts"    value={o.disputedShifts || 0}   icon="⚖️" danger={o.disputedShifts > 0} />
        <StatCard label="Flagged Messages"   value={o.flaggedMessages || 0}  icon="🚩" danger={o.flaggedMessages > 0} />
      </div>

      {/* Subscription breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 20 }}>Subscription Revenue (MRR)</h3>
          {[
            { label: 'Basic',        count: subCounts.BASIC || 0,        rev: subRev.BASIC || 0,        color: '#2563EB' },
            { label: 'Professional', count: subCounts.PROFESSIONAL || 0, rev: subRev.PROFESSIONAL || 0, color: '#1E3A8A' },
            { label: 'Enterprise',   count: subCounts.ENTERPRISE || 0,   rev: subRev.ENTERPRISE || 0,   color: '#0F172A' },
          ].map(({ label, count, rev, color }) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>{count} facilities</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{fmt(rev)}</span>
              </div>
              <div style={{ height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: subRevTotal > 0 ? `${(rev / subRevTotal) * 100}%` : '0%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>Total MRR</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: '#2563EB' }}>{fmt(subRevTotal)}</span>
          </div>
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

      {/* Shift stats */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 20 }}>Shift Breakdown</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {[
            { label: 'Total Shifts',       value: o.totalShifts || 0,      color: '#0F172A' },
            { label: 'Fill Rate',          value: `${o.fillRate || 0}%`,   color: '#10B981' },
            { label: 'Disputed',           value: o.disputedShifts || 0,   color: '#EF4444' },
            { label: 'Total Providers',    value: o.totalProviders || 0,   color: '#2563EB' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: 'center', padding: '16px', background: '#F8FAFC', borderRadius: 12 }}>
              <div style={{ fontSize: 32, fontWeight: 900, color }}>{value}</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
