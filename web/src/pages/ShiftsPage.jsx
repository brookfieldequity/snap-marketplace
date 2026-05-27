import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../api.js'
import StatusBadge from '../components/StatusBadge.jsx'

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const MOCK_SHIFTS = [
  { id: 's1', date: '2026-05-20', specialty: 'CRNA', startTime: '07:00', duration: 8, payRate: 275, status: 'COMPLETED', surge: false, providerName: 'Dr. Lisa Park' },
  { id: 's2', date: '2026-05-22', specialty: 'Anesthesiologist', startTime: '06:30', duration: 10, payRate: 310, status: 'COMPLETED', surge: true, providerName: 'Dr. James Obi' },
  { id: 's3', date: '2026-05-24', specialty: 'CRNA', startTime: '08:00', duration: 6, payRate: 265, status: 'FILLED', surge: false, providerName: 'Dr. Sarah Kim' },
  { id: 's4', date: '2026-05-26', specialty: 'Anesthesiologist', startTime: '07:00', duration: 8, payRate: 295, status: 'LIVE', surge: false, providerName: null },
  { id: 's5', date: '2026-05-28', specialty: 'CRNA', startTime: '06:00', duration: 10, payRate: 285, status: 'LIVE', surge: true, providerName: null },
  { id: 's6', date: '2026-06-02', specialty: 'Anesthesiologist', startTime: '07:30', duration: 8, payRate: 295, status: 'DEPOSIT_PENDING', surge: false, providerName: null },
  { id: 's7', date: '2026-04-15', specialty: 'CRNA', startTime: '07:00', duration: 8, payRate: 260, status: 'DISPUTED', surge: false, providerName: 'Dr. Tom Walsh' },
]

// Applicants detail (mock)
const MOCK_APPLICANTS = {
  s4: [
    { id: 'app1', providerName: 'Dr. Priya Nair', specialty: 'Anesthesiologist', rating: 4.9, shiftsWorked: 12 },
    { id: 'app2', providerName: 'Dr. Marcus Chen', specialty: 'Anesthesiologist', rating: 4.7, shiftsWorked: 8 },
  ],
}

export default function ShiftsPage({ onNavigate }) {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState(null)
  const [actionLoading, setActionLoading] = useState({})

  useEffect(() => {
    facilityAPI.getShifts()
      .then(setShifts)
      .catch(() => setShifts(MOCK_SHIFTS))
      .finally(() => setLoading(false))
  }, [])

  async function handleApplication(shiftId, applicationId, action) {
    const key = `${shiftId}-${applicationId}`
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await facilityAPI.reviewApplication(shiftId, applicationId, action)
      const updated = await facilityAPI.getShifts()
      setShifts(updated)
    } catch {
      alert('Action failed.')
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  async function handleConfirmDeposit(shiftId) {
    setActionLoading((prev) => ({ ...prev, [shiftId]: true }))
    try {
      await facilityAPI.confirmDeposit(shiftId)
      const updated = await facilityAPI.getShifts()
      setShifts(updated)
    } catch {
      alert('Failed to confirm deposit.')
    } finally {
      setActionLoading((prev) => ({ ...prev, [shiftId]: false }))
    }
  }

  async function handleRebook(shift) {
    onNavigate('post-shift')
  }

  const colStyle = (w) => ({
    padding: '14px 16px',
    fontSize: 13,
    color: '#374151',
    width: w,
    verticalAlign: 'middle',
  })

  return (
    <div style={{ padding: '32px 40px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>My Shifts</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{shifts.length} total shifts</p>
        </div>
        <button
          onClick={() => onNavigate('post-shift')}
          style={{
            padding: '11px 22px',
            background: '#6366F1',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
          }}
        >
          + Post a Shift
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #E2E8F0',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '110px 160px 90px 80px 80px 130px 80px 1fr',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            padding: '0',
          }}
        >
          {['Date', 'Specialty', 'Time', 'Hours', 'Rate', 'Status', 'Surge', 'Provider / Action'].map((h) => (
            <div
              key={h}
              style={{
                padding: '12px 16px',
                fontSize: 11,
                fontWeight: 700,
                color: '#64748B',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              {h}
            </div>
          ))}
        </div>

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            Loading shifts...
          </div>
        )}

        {!loading && shifts.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94A3B8' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No shifts yet</div>
            <button onClick={() => onNavigate('post-shift')} style={{ color: '#6366F1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Post your first shift →
            </button>
          </div>
        )}

        {shifts.map((shift, i) => {
          const isExpanded = expandedRow === shift.id
          const applicants = shift.applicants || MOCK_APPLICANTS[shift.id] || []
          const total = (shift.payRate || 0) * (shift.duration || 0)

          return (
            <React.Fragment key={shift.id}>
              <div
                onClick={() => setExpandedRow(isExpanded ? null : shift.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 160px 90px 80px 80px 130px 80px 1fr',
                  borderBottom: '1px solid #F1F5F9',
                  cursor: 'pointer',
                  background: isExpanded ? '#FAFAFE' : (i % 2 === 0 ? '#fff' : '#FAFAFA'),
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#F8FAFF' }}
                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#FAFAFA' }}
              >
                <div style={colStyle('110px')}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{shift.date}</div>
                </div>
                <div style={colStyle('160px')}>
                  <span style={{ fontWeight: 500 }}>{shift.specialty}</span>
                </div>
                <div style={colStyle('90px')}>{shift.startTime}</div>
                <div style={colStyle('80px')}>{shift.duration}h</div>
                <div style={colStyle('80px')}>{fmt(shift.payRate)}</div>
                <div style={colStyle('130px')}>
                  <StatusBadge status={shift.status} />
                </div>
                <div style={colStyle('80px')}>
                  {shift.surge && (
                    <span style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FCD34D', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      ⚡ Surge
                    </span>
                  )}
                </div>
                <div style={{ ...colStyle('auto'), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B', fontStyle: shift.providerName ? 'normal' : 'italic' }}>
                    {shift.providerName || (shift.status === 'LIVE' ? 'Open' : '—')}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {shift.status === 'DEPOSIT_PENDING' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleConfirmDeposit(shift.id) }}
                        disabled={actionLoading[shift.id]}
                        style={{ padding: '5px 12px', background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Confirm Deposit
                      </button>
                    )}
                    {shift.status === 'COMPLETED' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRebook(shift) }}
                        style={{ padding: '5px 12px', background: '#EEF2FF', color: '#6366F1', border: '1px solid #A5B4FC', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Rebook
                      </button>
                    )}
                    <span style={{ color: '#CBD5E1', fontSize: 12, userSelect: 'none' }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div
                  style={{
                    borderBottom: '2px solid #6366F1',
                    background: '#FAFAFE',
                    padding: '20px 24px',
                  }}
                >
                  <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Shift Total</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{fmt(total)}</div>
                    </div>
                    {shift.status !== 'DEPOSIT_PENDING' && (
                      <div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Deposit Paid</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#10B981' }}>{fmt(Math.round(total * 0.25))}</div>
                      </div>
                    )}
                  </div>

                  {applicants.length > 0 && shift.status === 'LIVE' && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                        Applicants ({applicants.length})
                      </div>
                      {applicants.map((app) => (
                        <div
                          key={app.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: '#fff',
                            borderRadius: 10,
                            padding: '12px 16px',
                            marginBottom: 8,
                            border: '1px solid #E2E8F0',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{app.providerName}</span>
                            <span style={{ color: '#64748B', fontSize: 13, marginLeft: 10 }}>{app.specialty}</span>
                            <span style={{ color: '#F59E0B', fontSize: 13, marginLeft: 10 }}>★ {app.rating}</span>
                            <span style={{ color: '#94A3B8', fontSize: 12, marginLeft: 8 }}>{app.shiftsWorked} shifts</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleApplication(shift.id, app.id, 'approve')}
                              disabled={actionLoading[`${shift.id}-${app.id}`]}
                              style={{ padding: '6px 14px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                            >
                              ✓ Approve
                            </button>
                            <button
                              onClick={() => handleApplication(shift.id, app.id, 'reject')}
                              disabled={actionLoading[`${shift.id}-${app.id}`]}
                              style={{ padding: '6px 14px', background: '#fff', color: '#EF4444', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {shift.status === 'DISPUTED' && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#DC2626' }}>
                      ⚖️ This shift is under dispute review. Our team will contact you within 48 hours.
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
