import React, { useEffect, useState } from 'react'
import { credentialAPI } from '../../api.js'

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = { GREEN: '#10B981', YELLOW: '#F59E0B', RED: '#EF4444' }
  const labels = { GREEN: 'Active', YELLOW: 'Attention', RED: 'Urgent' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: `${colors[status]}18`, color: colors[status], fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[status], display: 'inline-block' }} />
      {labels[status] || status}
    </span>
  )
}

import AutomationSavingsCard from '../../components/AutomationSavingsCard.jsx'

export default function CredentialDashboard({ onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      credentialAPI.getSummary(),
      credentialAPI.getProviders(),
    ]).then(([s, p]) => {
      setSummary(s)
      setProviders(Array.isArray(p) ? p : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const urgent = providers.filter(p => p.status === 'RED').slice(0, 5)
  const attention = providers.filter(p => p.status === 'YELLOW').slice(0, 5)

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading dashboard…</div>
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Credentialing Dashboard</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Overview of your facility's provider credential status</p>
      </div>

      {/* Cost-savings widget — time saved by SNAP automation, $50/hr */}
      <div style={{ marginBottom: 28 }}>
        <AutomationSavingsCard fetcher={credentialAPI.getSavings} />
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Providers" value={summary?.total ?? 0} color="#0F172A" />
        <StatCard label="Active" value={summary?.GREEN ?? 0} color="#10B981" sub="All credentials current" />
        <StatCard label="Attention" value={summary?.YELLOW ?? 0} color="#F59E0B" sub="Expiring within 90 days" />
        <StatCard label="Urgent" value={summary?.RED ?? 0} color="#EF4444" sub="Expired or missing" />
        <StatCard label="Pending Passport" value={summary?.pendingPassport ?? 0} color="#6366F1" sub="No SNAP account yet" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Urgent providers */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #FCA5A5', padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>🚨 Requires Immediate Action</div>
            {urgent.length > 0 && (
              <button onClick={() => onNavigate('expiring')} style={{ fontSize: 12, color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                View all →
              </button>
            )}
          </div>
          {urgent.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#10B981', fontSize: 13, fontWeight: 600 }}>
              ✓ No urgent credential issues
            </div>
          ) : urgent.map(p => (
            <div
              key={p.rosterId}
              onClick={() => p.providerId && onNavigate(`provider:${p.providerId}`)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9', cursor: p.providerId ? 'pointer' : 'default' }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{p.lastName}, {p.firstName}</div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{p.credentialType}</div>
              </div>
              <StatusBadge status="RED" />
            </div>
          ))}
        </div>

        {/* Attention providers */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #FCD34D', padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>⚠️ Expiring Soon</div>
            {attention.length > 0 && (
              <button onClick={() => onNavigate('expiring')} style={{ fontSize: 12, color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                View all →
              </button>
            )}
          </div>
          {attention.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#10B981', fontSize: 13, fontWeight: 600 }}>
              ✓ No credentials expiring within 90 days
            </div>
          ) : attention.map(p => (
            <div
              key={p.rosterId}
              onClick={() => p.providerId && onNavigate(`provider:${p.providerId}`)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9', cursor: p.providerId ? 'pointer' : 'default' }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{p.lastName}, {p.firstName}</div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  {p.nextExpiration ? `Next: ${new Date(p.nextExpiration).toLocaleDateString('en-US')}` : p.credentialType}
                </div>
              </div>
              <StatusBadge status="YELLOW" />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button
          onClick={() => onNavigate('providers')}
          style={{ padding: '12px 28px', background: '#6366F1', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
        >
          View All Providers →
        </button>
      </div>
    </div>
  )
}
