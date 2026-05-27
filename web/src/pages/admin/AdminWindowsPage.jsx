import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const STATUS_COLORS = {
  ACTIVE:   { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  DRAFT:    { bg: '#F8FAFC', color: '#475569', border: '#E2E8F0' },
  CLOSED:   { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' },
  ARCHIVED: { bg: '#F1F5F9', color: '#94A3B8', border: '#E2E8F0' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function completionColor(pct) {
  if (pct >= 80) return '#10B981'
  if (pct >= 50) return '#F59E0B'
  return '#EF4444'
}

export default function AdminWindowsPage() {
  const [windows, setWindows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.getAdminWindows()
      .then((data) => setWindows(Array.isArray(data) ? data : data.windows || []))
      .catch(() => setWindows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
          Availability Windows
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
          All availability collection windows across facilities
        </p>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading windows…</div>
        ) : windows.length === 0 ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>No windows found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Facility', 'Window Name', 'Status', 'Open Date', 'Close Date', 'Submitted / Roster', 'Completion'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {windows.map((w, idx) => {
                const submitted = w.submittedCount ?? w.submittedResponses ?? 0
                const total = w.totalRoster ?? w.rosterCount ?? 0
                const pct = total > 0 ? Math.round((submitted / total) * 100) : 0
                const statusStyle = STATUS_COLORS[w.status] || STATUS_COLORS.DRAFT
                return (
                  <tr
                    key={w.id || idx}
                    style={{ borderBottom: '1px solid #F1F5F9' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {w.facility?.name || w.facilityName || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>
                      {w.name || '—'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 700,
                        background: statusStyle.bg,
                        color: statusStyle.color,
                        border: `1px solid ${statusStyle.border}`,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        {w.status || 'DRAFT'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDate(w.openDate)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDate(w.closeDate)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151', fontWeight: 600 }}>
                      {submitted} / {total}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                          <div style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: completionColor(pct),
                            borderRadius: 3,
                          }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: completionColor(pct), minWidth: 36 }}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
