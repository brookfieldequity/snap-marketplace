import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

const STATUS_STYLE = {
  OPEN:      { bg: '#EFF6FF', color: '#1D4ED8', border: '#93C5FD', label: 'OPEN' },
  FILLED:    { bg: '#F0FDF4', color: '#15803D', border: '#86EFAC', label: 'FILLED' },
  EXPIRED:   { bg: '#F8FAFC', color: '#64748B', border: '#CBD5E1', label: 'EXPIRED' },
  ESCALATED: { bg: '#F5F3FF', color: '#7C3AED', border: '#C4B5FD', label: 'ESCALATED' },
}

const BLANK_SHIFT = {
  shiftDate: '',
  startTime: '',
  duration: 4,
  location: '',
  incentiveRate: '',
  providerTypeRequired: 'CRNA',
  responseDeadline: '',
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC', boxSizing: 'border-box',
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.OPEN
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
      {s.label}
    </span>
  )
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function detectGaps(schedDays) {
  const gaps = []
  const days = Array.isArray(schedDays) ? schedDays : schedDays?.days || []
  days.forEach(day => {
    const locations = day.locations || []
    locations.forEach(loc => {
      const roomCount = loc.roomsRequired || 1
      let unfilled = 0
      const assignments = loc.assignments || {}
      for (let r = 1; r <= roomCount; r++) {
        if (!assignments[r] && !assignments[r - 1]) unfilled++
      }
      if (unfilled > 0) {
        gaps.push({
          date: day.date,
          location: loc.location || loc.name || 'Unknown',
          roomsUnfilled: unfilled,
          daysUntil: daysUntil(day.date),
        })
      }
    })
  })
  return gaps
}

export default function GapsPage({ onNavigate }) {
  const [gaps, setGaps] = useState([])
  const [incentiveShifts, setIncentiveShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [shiftModal, setShiftModal] = useState(null) // gap object or null
  const [shiftForm, setShiftForm] = useState(BLANK_SHIFT)
  const [saving, setSaving] = useState(false)

  const [escalatingIds, setEscalatingIds] = useState({})
  const [escalatedIds, setEscalatedIds] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const today = new Date()
      const y = today.getFullYear()
      const m = today.getMonth() + 1
      const nextM = m === 12 ? 1 : m + 1
      const nextY = m === 12 ? y + 1 : y

      const [thisMonth, nextMonth, incentives] = await Promise.all([
        facilityAPI.getScheduleMonth(y, m).catch(() => []),
        facilityAPI.getScheduleMonth(nextY, nextM).catch(() => []),
        facilityAPI.getIncentiveShifts().catch(() => []),
      ])

      const allGaps = [...detectGaps(thisMonth), ...detectGaps(nextMonth)]
      setGaps(allGaps)
      setIncentiveShifts(Array.isArray(incentives) ? incentives : incentives.shifts || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openCreateShift(gap) {
    setShiftModal(gap)
    setShiftForm({ ...BLANK_SHIFT, shiftDate: gap.date, location: gap.location })
  }

  async function handleCreateShift() {
    if (!shiftForm.shiftDate || !shiftForm.startTime || !shiftForm.incentiveRate) {
      return alert('Shift date, start time, and incentive rate are required.')
    }
    setSaving(true)
    try {
      await facilityAPI.createIncentiveShift(shiftForm)
      setShiftModal(null)
      await load()
    } catch (e) {
      alert('Create failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleEscalate(shift) {
    if (!window.confirm('Escalate this shift to the SNAP Marketplace? External providers will be able to apply.')) return
    setEscalatingIds(p => ({ ...p, [shift.id]: true }))
    try {
      await facilityAPI.escalateIncentiveShift(shift.id)
      setEscalatedIds(p => ({ ...p, [shift.id]: true }))
      await load()
      onNavigate('post-shift')
    } catch (e) {
      alert('Escalation failed: ' + e.message)
    } finally {
      setEscalatingIds(p => ({ ...p, [shift.id]: false }))
    }
  }

  function setF(k, v) { setShiftForm(p => ({ ...p, [k]: v })) }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Gaps & Internal Incentive Shifts</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Detect unfilled schedule gaps and offer internal incentive shifts to your roster</p>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading...</div>}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 20 }}>
          Error: {error}
        </div>
      )}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
          {/* LEFT: Unfilled Gaps */}
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>⚠️</span> Unfilled Gaps
              {gaps.length > 0 && (
                <span style={{ background: '#FEF2F2', color: '#DC2626', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: '1px solid #FCA5A5' }}>{gaps.length}</span>
              )}
            </h2>

            {gaps.length === 0 ? (
              <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 14, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#15803D' }}>No gaps detected!</div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Your schedule is fully covered for the next two months.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gaps.map((gap, i) => {
                  const urgent = gap.daysUntil <= 14
                  return (
                    <div
                      key={i}
                      style={{
                        background: urgent ? '#FFF5F5' : '#FFFBEB',
                        border: `1px solid ${urgent ? '#FCA5A5' : '#FDE68A'}`,
                        borderLeft: `4px solid ${urgent ? '#EF4444' : '#F59E0B'}`,
                        borderRadius: 10,
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{gap.date}</div>
                        <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{gap.location}</div>
                        <div style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 10 }}>
                          <span style={{ color: urgent ? '#DC2626' : '#D97706', fontWeight: 600 }}>
                            {gap.roomsUnfilled} room{gap.roomsUnfilled !== 1 ? 's' : ''} unfilled
                          </span>
                          <span style={{ color: '#94A3B8' }}>
                            {gap.daysUntil <= 0 ? 'Today' : `${gap.daysUntil}d away`}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => openCreateShift(gap)}
                        style={{ padding: '7px 14px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        + Incentive Shift
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Internal Incentive Shifts */}
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>💰</span> Internal Incentive Shifts
            </h2>

            {incentiveShifts.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                <div style={{ fontSize: 14, color: '#64748B' }}>No incentive shifts yet. Create one from a gap.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {incentiveShifts.map(shift => {
                  const s = STATUS_STYLE[shift.status] || STATUS_STYLE.OPEN
                  return (
                    <div key={shift.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{shift.shiftDate || shift.date}</div>
                          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{shift.location}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {shift.incentiveRate && (
                            <span style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                              ${shift.incentiveRate}/hr
                            </span>
                          )}
                          <StatusBadge status={shift.status} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748B', marginBottom: 10, flexWrap: 'wrap' }}>
                        {shift.duration && <span>⏱ {shift.duration}h</span>}
                        {shift.responseDeadline && <span>⏰ Deadline: {String(shift.responseDeadline).substring(0, 10)}</span>}
                        {shift.acceptCount != null && <span>✓ {shift.acceptCount} accepted</span>}
                        {shift.declineCount != null && <span>✗ {shift.declineCount} declined</span>}
                      </div>

                      {shift.status === 'OPEN' && (
                        <button
                          onClick={() => handleEscalate(shift)}
                          disabled={escalatingIds[shift.id] || escalatedIds[shift.id]}
                          style={{ padding: '7px 14px', background: '#F5F3FF', border: '1px solid #C4B5FD', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#7C3AED', opacity: escalatingIds[shift.id] ? 0.6 : 1 }}
                        >
                          {escalatingIds[shift.id] ? 'Escalating...' : escalatedIds[shift.id] ? '✓ Escalated' : '🚀 Escalate to Marketplace'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Incentive Shift Modal */}
      {shiftModal && (
        <Modal title="Create Incentive Shift" onClose={() => setShiftModal(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Field label="Shift Date">
              <input style={inputStyle} type="date" value={shiftForm.shiftDate} onChange={(e) => setF('shiftDate', e.target.value)} />
            </Field>
            <Field label="Start Time">
              <input style={inputStyle} type="time" value={shiftForm.startTime} onChange={(e) => setF('startTime', e.target.value)} />
            </Field>
            <Field label="Duration (hours)">
              <input style={inputStyle} type="number" min="1" max="24" value={shiftForm.duration} onChange={(e) => setF('duration', e.target.value)} />
            </Field>
            <Field label="Incentive Rate ($/hr)">
              <input style={inputStyle} type="number" min="0" value={shiftForm.incentiveRate} onChange={(e) => setF('incentiveRate', e.target.value)} placeholder="e.g. 325" />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Location">
                <input style={inputStyle} value={shiftForm.location} onChange={(e) => setF('location', e.target.value)} placeholder="e.g. OR Suite 2" />
              </Field>
            </div>
            <Field label="Provider Type Required">
              <select style={inputStyle} value={shiftForm.providerTypeRequired} onChange={(e) => setF('providerTypeRequired', e.target.value)}>
                <option value="CRNA">CRNA</option>
                <option value="ANESTHESIOLOGIST">Anesthesiologist</option>
                <option value="ANESTHESIA_ASSISTANT">Anesthesia Assistant</option>
                <option value="ANY">Any</option>
              </select>
            </Field>
            <Field label="Response Deadline">
              <input style={inputStyle} type="datetime-local" value={shiftForm.responseDeadline} onChange={(e) => setF('responseDeadline', e.target.value)} />
            </Field>
          </div>
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#64748B', marginBottom: 20, fontStyle: 'italic' }}>
            🔒 This rate is only visible to your internal roster providers. Never shown to external providers.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setShiftModal(null)} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
            <button onClick={handleCreateShift} disabled={saving} style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creating...' : 'Create Incentive Shift'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
