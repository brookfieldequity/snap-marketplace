import React, { useEffect, useState, useCallback } from 'react'
import { credentialAPI } from '../../api.js'

const ACTION_COLORS = {
  UPLOAD: '#2563EB',
  DOWNLOAD: '#0EA5E9',
  VIEW_TOKEN: '#1E40AF',
  VERIFY: '#10B981',
  UNVERIFY: '#F59E0B',
  FLAG: '#EF4444',
  UNFLAG: '#F59E0B',
  NOTE: '#64748B',
  INVITE: '#F59E0B',
  REMIND: '#F59E0B',
  LOGIN: '#94A3B8',
}

function ActionBadge({ action }) {
  const color = ACTION_COLORS[action] || '#94A3B8'
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      color,
      background: `${color}15`,
      padding: '2px 8px',
      borderRadius: 4,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {action?.replace(/_/g, ' ')}
    </span>
  )
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function CredentialAuditLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 50

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, limit: PAGE_SIZE }
    if (actionFilter) params.action = actionFilter
    if (search) params.search = search

    credentialAPI.getAuditLog(params)
      .then(data => {
        setLogs(Array.isArray(data?.logs) ? data.logs : Array.isArray(data) ? data : [])
        setTotal(data?.total ?? 0)
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [page, actionFilter, search])

  useEffect(() => { load() }, [load])

  function handleFilterChange(key, val) {
    setPage(1)
    if (key === 'action') setActionFilter(val)
    if (key === 'search') setSearch(val)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Audit Log</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>All credentialing activity across your facility</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', width: 220 }}
          placeholder="Search provider or user…"
          value={search}
          onChange={e => handleFilterChange('search', e.target.value)}
        />
        <select
          style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff' }}
          value={actionFilter}
          onChange={e => handleFilterChange('action', e.target.value)}
        >
          <option value="">All actions</option>
          <option value="UPLOAD">Upload</option>
          <option value="DOWNLOAD">Download</option>
          <option value="VIEW_TOKEN">View (token)</option>
          <option value="VERIFY">Verify</option>
          <option value="UNVERIFY">Unverify</option>
          <option value="FLAG">Flag</option>
          <option value="UNFLAG">Unflag</option>
          <option value="NOTE">Note added</option>
          <option value="INVITE">Invite sent</option>
          <option value="REMIND">Reminder sent</option>
          <option value="LOGIN">Login</option>
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#64748B', alignSelf: 'center' }}>
          {total > 0 ? `${total} event${total !== 1 ? 's' : ''}` : ''}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading audit log…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>No events found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <tr>
                {['Timestamp', 'Action', 'Provider', 'Credential Type', 'Performed By', 'IP Address', 'Details'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr
                  key={log.id}
                  style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}
                >
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748B', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <ActionBadge action={log.action} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {log.providerName ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{log.providerName}</div>
                        {log.npiNumber && <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>NPI: {log.npiNumber}</div>}
                      </div>
                    ) : <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#374151' }}>
                    {log.credentialType ? log.credentialType.replace(/_/g, ' ') : <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {log.performedByName ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{log.performedByName}</div>
                        {log.performedByEmail && <div style={{ fontSize: 11, color: '#94A3B8' }}>{log.performedByEmail}</div>}
                      </div>
                    ) : <span style={{ fontSize: 12, color: '#94A3B8' }}>System</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
                    {log.ipAddress || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748B', maxWidth: 220 }}>
                    {log.details || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ padding: '7px 14px', border: '1px solid #E2E8F0', borderRadius: 8, background: page === 1 ? '#F8FAFC' : '#fff', color: page === 1 ? '#CBD5E1' : '#374151', fontSize: 13, fontWeight: 600, cursor: page === 1 ? 'not-allowed' : 'pointer' }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: '#64748B', padding: '0 12px' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ padding: '7px 14px', border: '1px solid #E2E8F0', borderRadius: 8, background: page === totalPages ? '#F8FAFC' : '#fff', color: page === totalPages ? '#CBD5E1' : '#374151', fontSize: 13, fontWeight: 600, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
