import React, { useEffect, useState, useCallback } from 'react'
import { credentialAPI } from '../../api.js'

const STATUS_COLORS = { GREEN: '#10B981', YELLOW: '#F59E0B', RED: '#EF4444' }
const STATUS_LABELS = { GREEN: 'Active', YELLOW: 'Attention', RED: 'Urgent' }
const MATCH_COLORS = { LINKED: '#10B981', INVITED: '#F59E0B', NOT_INVITED: '#94A3B8' }
const MATCH_LABELS = { LINKED: 'Passport Linked', INVITED: 'Invitation Sent', NOT_INVITED: 'Not Invited' }

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#94A3B8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: `${color}18`, color, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function MatchBadge({ status }) {
  const color = MATCH_COLORS[status] || '#94A3B8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: `${color}12`, color, fontSize: 11, fontWeight: 600 }}>
      {MATCH_LABELS[status] || status}
    </span>
  )
}

function CompletionBar({ pct }) {
  const color = pct === 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

export default function CredentialProviderList({ onNavigate, permission, filterExpiring }) {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(filterExpiring ? '' : '')
  const [typeFilter, setTypeFilter] = useState('')
  const [sortKey, setSortKey] = useState('lastName')
  const [sortDir, setSortDir] = useState('asc')

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (search) params.search = search
    if (statusFilter) params.status = statusFilter
    if (typeFilter) params.credType = typeFilter

    credentialAPI.getProviders(params)
      .then(data => setProviders(Array.isArray(data) ? data : []))
      .catch(() => setProviders([]))
      .finally(() => setLoading(false))
  }, [search, statusFilter, typeFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (filterExpiring) setStatusFilter('YELLOW')
  }, [filterExpiring])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = [...providers].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey]
    if (sortKey === 'nextExpiration') {
      va = va ? new Date(va).getTime() : Infinity
      vb = vb ? new Date(vb).getTime() : Infinity
    }
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    return (va < vb ? -1 : va > vb ? 1 : 0) * (sortDir === 'asc' ? 1 : -1)
  })

  function SortHeader({ label, field }) {
    const active = sortKey === field
    return (
      <th onClick={() => handleSort(field)} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: active ? '#6366F1' : '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    )
  }

  // Billing view — name + NPI only
  if (permission === 'BILLING') {
    return (
      <div style={{ padding: '32px 40px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginBottom: 24, letterSpacing: '-0.02em' }}>Providers</h1>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC' }}>
              <tr>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Provider Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>NPI Number</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p, i) => (
                <tr key={p.rosterId} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{p.lastName}, {p.firstName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B', fontFamily: 'monospace' }}>{p.npiNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
            {filterExpiring ? 'Expiring Soon' : 'Providers'}
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{providers.length} provider{providers.length !== 1 ? 's' : ''} found</p>
        </div>
        {permission === 'COORDINATOR' && (
          <a
            href={credentialAPI.exportProviders()}
            style={{ padding: '10px 18px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10, color: '#374151', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
          >
            Export CSV ↓
          </a>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', width: 220 }}
          placeholder="Search name or NPI…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff' }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="GREEN">Active</option>
          <option value="YELLOW">Attention</option>
          <option value="RED">Urgent</option>
        </select>
        <select
          style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff' }}
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="Anesthesiologist">Anesthesiologist</option>
          <option value="CRNA">CRNA</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading providers…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>No providers match your filters.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <tr>
                <SortHeader label="Provider Name" field="lastName" />
                <SortHeader label="Type" field="credentialType" />
                {permission === 'COORDINATOR' && <SortHeader label="Status" field="status" />}
                {permission === 'COORDINATOR' && <SortHeader label="Next Expiration" field="nextExpiration" />}
                <SortHeader label="Passport %" field="passportCompletion" />
                {permission === 'COORDINATOR' && <SortHeader label="Passport Status" field="matchStatus" />}
                {permission === 'COORDINATOR' && <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Last Updated</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr
                  key={p.rosterId}
                  onClick={() => permission === 'COORDINATOR' && onNavigate(p.providerId ? `provider:${p.providerId}` : `roster:${p.rosterId}`)}
                  style={{
                    borderTop: '1px solid #F1F5F9',
                    background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                    cursor: permission === 'COORDINATOR' ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (permission === 'COORDINATOR') e.currentTarget.style.background = '#F0F4FF' }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#FAFAFA' }}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{p.lastName}, {p.firstName}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace', marginTop: 2 }}>NPI: {p.npiNumber}</div>
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{p.credentialType}</td>
                  {permission === 'COORDINATOR' && (
                    <td style={{ padding: '14px 16px' }}>
                      <StatusBadge status={p.status} />
                    </td>
                  )}
                  {permission === 'COORDINATOR' && (
                    <td style={{ padding: '14px 16px', fontSize: 13, color: p.nextExpiration ? '#374151' : '#CBD5E1' }}>
                      {p.nextExpiration ? new Date(p.nextExpiration).toLocaleDateString('en-US') : '—'}
                    </td>
                  )}
                  <td style={{ padding: '14px 16px', minWidth: 130 }}>
                    <CompletionBar pct={p.passportCompletion ?? 0} />
                  </td>
                  {permission === 'COORDINATOR' && (
                    <td style={{ padding: '14px 16px' }}>
                      <MatchBadge status={p.matchStatus} />
                    </td>
                  )}
                  {permission === 'COORDINATOR' && (
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#94A3B8' }}>
                      {p.lastUpdated ? new Date(p.lastUpdated).toLocaleDateString('en-US') : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
