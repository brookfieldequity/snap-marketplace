import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const STATUS_COLORS = {
  PENDING:    { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  PROCESSING: { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  CONFIRMED:  { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  FAILED:     { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
  COMPLETED:  { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateRange(start, end) {
  if (!start && !end) return '—'
  if (!end) return fmtDate(start)
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

export default function AdminUploadsPage() {
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.getAdminUploads()
      .then((data) => setUploads(Array.isArray(data) ? data : data.uploads || []))
      .catch(() => setUploads([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
          Data Uploads
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
          Schedule data uploads from all facilities
        </p>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading uploads…</div>
        ) : uploads.length === 0 ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>No uploads found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Facility', 'File Name', 'Records', 'Date Range', 'Upload Date', 'Status'].map((h) => (
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
              {uploads.map((u, idx) => {
                const statusStyle = STATUS_COLORS[u.status] || STATUS_COLORS.PENDING
                return (
                  <tr
                    key={u.id || idx}
                    style={{ borderBottom: '1px solid #F1F5F9' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {u.facility?.name || u.facilityName || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>
                      {u.fileName || u.filename || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                      {u.recordCount ?? u.records ?? '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDateRange(u.dateRangeStart, u.dateRangeEnd)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDate(u.createdAt || u.uploadedAt)}
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
                        {u.status || 'PENDING'}
                      </span>
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
