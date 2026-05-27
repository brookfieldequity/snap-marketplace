import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const STATUS_COLORS = {
  OPEN:       { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  FILLED:     { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  ESCALATED:  { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  EXPIRED:    { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' },
  CANCELLED:  { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt$(n) {
  if (n == null) return '—'
  return '$' + Number(n).toFixed(2) + '/hr'
}

export default function AdminIncentivesPage() {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.getAdminIncentiveShifts()
      .then((data) => setShifts(Array.isArray(data) ? data : data.shifts || []))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false))
  }, [])

  const totalShifts = shifts.length
  const filled = shifts.filter((s) => s.status === 'FILLED').length
  const escalated = shifts.filter((s) => s.escalated || s.status === 'ESCALATED').length
  const fillRate = totalShifts > 0 ? ((filled / totalShifts) * 100).toFixed(1) : '0.0'
  const escalationRate = totalShifts > 0 ? ((escalated / totalShifts) * 100).toFixed(1) : '0.0'

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
          Incentive Shifts
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
          Platform-wide incentive shift overview
        </p>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total Incentive Shifts', value: totalShifts, icon: '⚡', color: '#6366F1' },
          { label: 'Fill Rate',              value: `${fillRate}%`, icon: '🎯', color: '#10B981' },
          { label: 'Escalation Rate',        value: `${escalationRate}%`, icon: '🔺', color: '#F59E0B' },
        ].map(({ label, value, icon, color }) => (
          <div
            key={label}
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '20px 24px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {label}
              </div>
              <span style={{ fontSize: 20 }}>{icon}</span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color, letterSpacing: '-0.02em' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading incentive shifts…</div>
        ) : shifts.length === 0 ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>No incentive shifts found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Facility', 'Date', 'Location', 'Provider Type', 'Rate', 'Status', 'Escalated', 'Responses'].map((h) => (
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
              {shifts.map((s, idx) => {
                const statusStyle = STATUS_COLORS[s.status] || STATUS_COLORS.OPEN
                return (
                  <tr
                    key={s.id || idx}
                    style={{ borderBottom: '1px solid #F1F5F9' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {s.facility?.name || s.facilityName || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDate(s.date || s.shiftDate)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>
                      {s.location || s.facility?.address || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>
                      {s.providerType || s.specialty || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: '#6366F1' }}>
                      {fmt$(s.incentiveRate ?? s.rate)}
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
                        {s.status || 'OPEN'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13 }}>
                      <span style={{ color: s.escalated ? '#C2410C' : '#94A3B8', fontWeight: 600 }}>
                        {s.escalated ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                      {s.responseCount ?? s.responses ?? 0}
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
