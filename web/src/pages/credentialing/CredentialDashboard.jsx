import React, { useEffect, useState } from 'react'
import { credentialAPI } from '../../api.js'

// Phase 3 (one source of truth): the dashboard is the coordinator's EXPIRY
// view over the roster — every number computed live from the passport batch
// summary. Zero local credential storage.

function StatCard({ label, value, color, sub, onClick }) {
  return (
    <div onClick={onClick} style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

const TYPE_SHORT = {
  STATE_LICENSE: 'License', STATE_CS_LICENSE: 'CS License', DEA: 'DEA',
  BOARD_CERTIFICATION: 'Board Cert', MALPRACTICE_INSURANCE: 'Malpractice',
  ACLS: 'ACLS', BLS: 'BLS',
}

export default function CredentialDashboard({ onNavigate }) {
  const [rows, setRows] = useState([])
  const [bridgeDown, setBridgeDown] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    credentialAPI.getPortalRoster()
      .then((data) => { setRows(data.roster || []); setBridgeDown(!!data.bridgeUnconfigured) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading dashboard…</div>

  const granted = rows.filter((r) => r.passport?.hasGrant)
  const notLinked = rows.filter((r) => !r.passport?.hasGrant)

  // Flatten every dated credential across the granted roster.
  const now = Date.now()
  const horizon = now + 90 * 86400000
  const dated = granted.flatMap((r) =>
    (r.passport.credentials || [])
      .filter((c) => c.expirationDate)
      .map((c) => ({
        rosterId: r.id, npi: r.npi, providerName: r.providerName,
        type: c.type, expirationDate: new Date(c.expirationDate), status: c.status,
      }))
  )
  const expired = dated.filter((c) => c.expirationDate.getTime() <= now || c.status === 'EXPIRED')
  const expiringSoon = dated.filter((c) => c.status !== 'EXPIRED' && c.expirationDate.getTime() > now && c.expirationDate.getTime() <= horizon)
  const missingCount = granted.reduce((s, r) => s + (r.passport.completeness?.missingRequired?.length || 0), 0)
  const watchlist = [...expired, ...expiringSoon].sort((a, b) => a.expirationDate - b.expirationDate).slice(0, 12)

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '0 0 4px' }}>Credentialing Dashboard</h1>
      <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px' }}>Live expiry view across your roster's credentialing passports.</p>

      {bridgeDown && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400E', marginBottom: 16 }}>
          Passport connection isn't configured — credential data unavailable.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        <StatCard label="Roster providers" value={rows.length} color="#0F172A" sub={`${granted.length} passport-linked`} onClick={() => onNavigate('providers')} />
        <StatCard label="Expired items" value={expired.length} color={expired.length ? '#EF4444' : '#10B981'} sub={expired.length ? 'need renewal now' : 'all current'} onClick={() => onNavigate('expiring')} />
        <StatCard label="Expiring ≤ 90 days" value={expiringSoon.length} color={expiringSoon.length ? '#F59E0B' : '#10B981'} onClick={() => onNavigate('expiring')} />
        <StatCard label="Missing required" value={missingCount} color={missingCount ? '#F59E0B' : '#10B981'} sub="across linked passports" onClick={() => onNavigate('providers')} />
        <StatCard label="Not yet linked" value={notLinked.length} color={notLinked.length ? '#64748B' : '#10B981'} sub="invite from Providers" onClick={() => onNavigate('providers')} />
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
          ⏰ Expiry watchlist {watchlist.length > 0 && <span style={{ color: '#94A3B8', fontWeight: 600 }}>· next {watchlist.length}</span>}
        </div>
        {watchlist.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            {granted.length === 0 ? 'No passport-linked providers yet — invite your roster from the Providers page.' : 'Nothing expired or expiring in the next 90 days. 🎉'}
          </div>
        ) : (
          watchlist.map((c, i) => {
            const days = Math.ceil((c.expirationDate.getTime() - now) / 86400000)
            const isPast = days <= 0
            return (
              <div
                key={`${c.npi}-${c.type}-${i}`}
                onClick={() => onNavigate(`pfile:${c.rosterId}:${c.npi}`)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 20px', borderTop: i > 0 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
              >
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>{c.providerName}</span>
                  <span style={{ fontSize: 12.5, color: '#64748B', marginLeft: 8 }}>{TYPE_SHORT[c.type] || c.type}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: '#64748B' }}>{c.expirationDate.toLocaleDateString('en-US')}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: isPast ? '#EF4444' : days <= 30 ? '#F59E0B' : '#64748B', minWidth: 90, textAlign: 'right' }}>
                    {isPast ? `${-days}d overdue` : `in ${days}d`}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
