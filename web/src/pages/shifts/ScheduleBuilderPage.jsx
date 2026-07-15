import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'

// ── Provider Availability Panel ──────────────────────────────────────────────
// Shown above the Build button. Lets coordinators request and track
// provider self-submitted availability for the selected month.

const AVAIL_STATUS_META = {
  NOT_SENT: { label: 'Not sent', bg: '#F1F5F9', color: '#64748B' },
  PENDING:  { label: 'Pending',  bg: '#FEF3C7', color: '#92400E' },
  SUBMITTED:{ label: 'Submitted',bg: '#ECFDF5', color: '#065F46' },
  LOCKED:   { label: 'Locked',   bg: '#F1F5F9', color: '#475569' },
}

function ProviderAvailabilityPanel({ year, month, roster, facilityId }) {
  const [requests, setRequests]         = useState([])
  const [loadingReqs, setLoadingReqs]   = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendState, setSendState]       = useState({
    deadline: '',
    deadlineTime: '23:59',
    selectedIds: null, // null = not yet seeded
    via: 'SMS',
    sending: false,
    result: null,
  })
  const [copiedToken, setCopiedToken]   = useState(null)
  const [reminding, setReminding]       = useState(null) // id being reminded

  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })

  // Default deadline = 5 days before first of month at 23:59
  function defaultDeadline() {
    const d = new Date(year, month - 1, 1)
    d.setDate(d.getDate() - 5)
    return d.toISOString().slice(0, 10)
  }

  function loadRequests() {
    setLoadingReqs(true)
    facilityAPI.getAvailabilityRequests(month, year)
      .then((res) => setRequests(res.requests || []))
      .catch(() => {})
      .finally(() => setLoadingReqs(false))
  }

  useEffect(() => { loadRequests() }, [year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed modal state when opening
  function openSendModal() {
    // Per-diem & locums checked by default, full-time unchecked
    const defaultSelected = new Set(
      roster.filter((r) => r.employmentCategory === 'PER_DIEM' || r.employmentCategory === 'LOCUMS').map((r) => r.id)
    )
    setSendState({
      deadline: defaultDeadline(),
      deadlineTime: '23:59',
      selectedIds: defaultSelected,
      via: 'SMS',
      sending: false,
      result: null,
    })
    setShowSendModal(true)
  }

  async function handleSend() {
    const { deadline, deadlineTime, selectedIds, via } = sendState
    if (!deadline || selectedIds.size === 0) return
    const deadlineISO = `${deadline}T${deadlineTime}:00`
    setSendState((s) => ({ ...s, sending: true, result: null }))
    try {
      const res = await facilityAPI.sendAvailabilityRequests({
        month,
        year,
        deadline: deadlineISO,
        rosterEntryIds: [...selectedIds],
        via,
      })
      const sentCount = (res.results || []).filter((r) => r.sent).length
      const failCount = (res.results || []).filter((r) => !r.sent).length
      setSendState((s) => ({ ...s, sending: false, result: { sentCount, failCount } }))
      loadRequests()
    } catch (err) {
      setSendState((s) => ({ ...s, sending: false, result: { error: err.message } }))
    }
  }

  async function handleRemind(id) {
    setReminding(id)
    try {
      await facilityAPI.remindAvailabilityRequest(id)
      loadRequests()
    } catch (err) {
      alert('Could not send reminder: ' + (err.message || 'Unknown error'))
    } finally {
      setReminding(null)
    }
  }

  function copyLink(link) {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopiedToken(link)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  function toggleRosterId(id) {
    setSendState((s) => {
      const next = new Set(s.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...s, selectedIds: next }
    })
  }

  // SMS preview text
  const smsPreview = sendState.deadline
    ? `[FacilityName]: Submit your ${monthName} availability by ${new Date(sendState.deadline + 'T' + sendState.deadlineTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. https://ai.snapmedical.app/avail/[token]`
    : ''

  // Roster split
  const perDiemLocums = roster.filter((r) => r.employmentCategory === 'PER_DIEM' || r.employmentCategory === 'LOCUMS')
  const fullTime = roster.filter((r) => r.employmentCategory === 'FULL_TIME')
  const other = roster.filter((r) => !r.employmentCategory)

  // Map existing request ids by rosterEntryId
  const reqByRosterId = new Map(requests.map((r) => [r.rosterEntryId, r]))

  const inputSt = {
    padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
    fontSize: 13, color: '#0F172A', background: '#F8FAFC',
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
          📅 Provider Availability — {monthName} {year}
        </div>
        <button
          onClick={openSendModal}
          style={{ padding: '8px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Request Availability
        </button>
      </div>

      {loadingReqs ? (
        <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94A3B8', padding: '4px 0' }}>
          No requests sent yet. Click "Request Availability" to send tokenized links to your roster.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['Provider', 'Type', 'Status', 'Days Avail', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const meta = AVAIL_STATUS_META[req.status] || AVAIL_STATUS_META.NOT_SENT
                return (
                  <tr key={req.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '8px 8px', color: '#0F172A', fontWeight: 500 }}>{req.providerName}</td>
                    <td style={{ padding: '8px 8px', color: '#64748B' }}>
                      {req.employmentCategory === 'PER_DIEM' ? 'Per-Diem'
                        : req.employmentCategory === 'LOCUMS' ? 'Locums'
                        : req.employmentCategory === 'FULL_TIME' ? 'Full-Time'
                        : '—'}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      <span style={{ background: meta.bg, color: meta.color, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ padding: '8px 8px', color: '#475569' }}>
                      {req.submittedAt ? `${req.daysAvailable} / ${req.submissionCount}` : '—'}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {req.status === 'NOT_SENT' && (
                          <button
                            onClick={() => {
                              setSendState((s) => ({ ...s, selectedIds: new Set([req.rosterEntryId]), deadline: defaultDeadline(), deadlineTime: '23:59', via: 'SMS', result: null }))
                              setShowSendModal(true)
                            }}
                            style={{ padding: '4px 10px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Send
                          </button>
                        )}
                        {req.status === 'PENDING' && (
                          <button
                            onClick={() => handleRemind(req.id)}
                            disabled={reminding === req.id}
                            style={{ padding: '4px 10px', background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: reminding === req.id ? 0.6 : 1 }}
                          >
                            {reminding === req.id ? '…' : 'Remind'}
                          </button>
                        )}
                        {(req.status === 'PENDING' || req.status === 'SUBMITTED') && req.link && (
                          <button
                            onClick={() => copyLink(req.link)}
                            style={{ padding: '4px 10px', background: '#F8FAFC', color: '#2563EB', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          >
                            {copiedToken === req.link ? 'Copied!' : 'Copy Link'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Send modal ── */}
      {showSendModal && sendState.selectedIds && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>Request Availability</h2>
              <button onClick={() => setShowSendModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
            </div>

            {/* Month + year (read-only display) */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Month</div>
              <div style={{ fontSize: 14, color: '#0F172A', fontWeight: 500 }}>{monthName} {year}</div>
            </div>

            {/* Deadline */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Submission deadline</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="date"
                  value={sendState.deadline}
                  onChange={(e) => setSendState((s) => ({ ...s, deadline: e.target.value }))}
                  style={inputSt}
                />
                <select
                  value={sendState.deadlineTime}
                  onChange={(e) => setSendState((s) => ({ ...s, deadlineTime: e.target.value }))}
                  style={{ ...inputSt, minWidth: 110 }}
                >
                  {['08:00','09:00','10:00','11:00','12:00','15:00','17:00','20:00','23:59'].map((t) => (
                    <option key={t} value={t}>{t === '23:59' ? '11:59 PM' : new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Roster checkboxes */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Who to send to</div>

              {perDiemLocums.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      id="all-perdiem"
                      checked={perDiemLocums.every((r) => sendState.selectedIds.has(r.id))}
                      onChange={(e) => {
                        setSendState((s) => {
                          const next = new Set(s.selectedIds)
                          perDiemLocums.forEach((r) => e.target.checked ? next.add(r.id) : next.delete(r.id))
                          return { ...s, selectedIds: next }
                        })
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <label htmlFor="all-perdiem" style={{ fontSize: 12, fontWeight: 700, color: '#374151', cursor: 'pointer' }}>
                      Per-Diem &amp; Locums <span style={{ color: '#64748B', fontWeight: 400 }}>(select all)</span>
                    </label>
                  </div>
                  {perDiemLocums.map((r) => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 20px', cursor: 'pointer', fontSize: 13, color: '#0F172A' }}>
                      <input type="checkbox" checked={sendState.selectedIds.has(r.id)} onChange={() => toggleRosterId(r.id)} />
                      <span style={{ flex: 1 }}>{r.providerName}</span>
                      {r.phoneNumber
                        ? <span style={{ fontSize: 11, color: '#64748B' }}>{r.phoneNumber}</span>
                        : <span style={{ fontSize: 11, color: '#EF4444' }}>No contact info</span>
                      }
                    </label>
                  ))}
                </div>
              )}

              {fullTime.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      id="all-fulltime"
                      checked={fullTime.every((r) => sendState.selectedIds.has(r.id))}
                      onChange={(e) => {
                        setSendState((s) => {
                          const next = new Set(s.selectedIds)
                          fullTime.forEach((r) => e.target.checked ? next.add(r.id) : next.delete(r.id))
                          return { ...s, selectedIds: next }
                        })
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <label htmlFor="all-fulltime" style={{ fontSize: 12, fontWeight: 700, color: '#374151', cursor: 'pointer' }}>
                      Full-Time
                    </label>
                    <span style={{ fontSize: 11, color: '#64748B' }}>Uncheck unless there's a scheduling exception</span>
                  </div>
                  {fullTime.map((r) => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 20px', cursor: 'pointer', fontSize: 13, color: '#0F172A' }}>
                      <input type="checkbox" checked={sendState.selectedIds.has(r.id)} onChange={() => toggleRosterId(r.id)} />
                      <span style={{ flex: 1 }}>{r.providerName}</span>
                      {r.phoneNumber
                        ? <span style={{ fontSize: 11, color: '#64748B' }}>{r.phoneNumber}</span>
                        : <span style={{ fontSize: 11, color: '#EF4444' }}>No contact info</span>
                      }
                    </label>
                  ))}
                </div>
              )}

              {other.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Other</div>
                  {other.map((r) => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 20px', cursor: 'pointer', fontSize: 13, color: '#0F172A' }}>
                      <input type="checkbox" checked={sendState.selectedIds.has(r.id)} onChange={() => toggleRosterId(r.id)} />
                      <span style={{ flex: 1 }}>{r.providerName}</span>
                      {r.phoneNumber
                        ? <span style={{ fontSize: 11, color: '#64748B' }}>{r.phoneNumber}</span>
                        : <span style={{ fontSize: 11, color: '#EF4444' }}>No contact info</span>
                      }
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Send via */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Send via</div>
              <div style={{ display: 'flex', gap: 0, background: '#F1F5F9', borderRadius: 8, padding: 3, width: 'fit-content' }}>
                {['SMS', 'EMAIL', 'BOTH'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSendState((s) => ({ ...s, via: v }))}
                    style={{
                      padding: '6px 16px', borderRadius: 6, border: 'none', fontSize: 13,
                      fontWeight: 600, cursor: 'pointer',
                      background: sendState.via === v ? '#2563EB' : 'transparent',
                      color: sendState.via === v ? '#fff' : '#64748B',
                    }}
                  >
                    {v === 'BOTH' ? 'SMS + Email' : v}
                  </button>
                ))}
              </div>
            </div>

            {/* SMS preview */}
            {(sendState.via === 'SMS' || sendState.via === 'BOTH') && smsPreview && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>SMS preview</div>
                <div style={{ background: '#F1F5F9', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#374151', lineHeight: 1.6 }}>
                  {smsPreview}
                </div>
              </div>
            )}

            {/* Result */}
            {sendState.result && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13,
                background: sendState.result.error ? '#FEF2F2' : '#ECFDF5',
                color: sendState.result.error ? '#991B1B' : '#065F46',
                border: `1px solid ${sendState.result.error ? '#FECACA' : '#A7F3D0'}`,
              }}>
                {sendState.result.error
                  ? `Error: ${sendState.result.error}`
                  : `Sent ${sendState.result.sentCount} message${sendState.result.sentCount !== 1 ? 's' : ''}${sendState.result.failCount > 0 ? ` · ${sendState.result.failCount} failed (no phone number)` : ''}.`
                }
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={sendState.sending || sendState.selectedIds.size === 0}
              style={{
                width: '100%', padding: '12px', background: sendState.selectedIds.size > 0 ? '#2563EB' : '#CBD5E1',
                color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                cursor: sendState.selectedIds.size > 0 && !sendState.sending ? 'pointer' : 'default',
              }}
            >
              {sendState.sending
                ? 'Sending…'
                : `Send ${sendState.selectedIds.size} Request${sendState.selectedIds.size !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
import ScheduleBuildFlow from './ScheduleBuildFlow.jsx'
import StaffIQRecommendations from './StaffIQRecommendations.jsx'
import OutListModal from './OutListModal.jsx'
import OutListRulesModal from './OutListRulesModal.jsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const EMP_PREFIX = { FULL_TIME: '🔵', PER_DIEM: '🟢', LOCUMS: '🟠' }

// Care-team coverage model label from a ScheduleDay.supervisionRatio.
// null = legacy/role-agnostic (no badge); 0 = MD-only; 3/4 = team ratio.
function coverageLabel(ratio) {
  if (ratio === 0) return { text: 'MD only', bg: '#F5F3FF', color: '#1E3A8A' }
  if (ratio === 3) return { text: 'Team 1:3', bg: '#ECFDF5', color: '#059669' }
  if (ratio === 4) return { text: 'Team 1:4', bg: '#ECFDF5', color: '#059669' }
  return null
}

// Per-room role tag (from ScheduleAssignment.role).
const ROLE_TAG = {
  CRNA_ROOM: { text: 'CRNA', bg: '#EFF6FF', color: '#1D4ED8' },
  SOLO_MD_ROOM: { text: 'Solo MD', bg: '#F5F3FF', color: '#1E3A8A' },
}

// Supervising MDs are stored at roomNumber >= 900 (mirrors scheduleBuilder.js).
const SUPERVISOR_ROOM_BASE = 900

function fmt(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Room-Count Cards status for the selected month — shows which sites have
// returned a card (those counts drive the generated schedule) vs. which fall
// back to the coverage-template default. Management lives on the dedicated page.
const RC_META = {
  RETURNED: { label: 'Returned', bg: '#F0FDF4', fg: '#166534', bd: '#BBF7D0' },
  SENT: { label: 'Awaiting', bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' },
  LOCKED_NO_RESPONSE: { label: 'No response', bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  NOT_SENT: { label: 'Template default', bg: '#F1F5F9', fg: '#64748B', bd: '#E2E8F0' },
}
function RoomCountPanel({ year, month, onNavigate }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })

  useEffect(() => {
    let alive = true
    setLoading(true)
    facilityAPI.getRoomRequestStatus(year, month)
      .then((r) => { if (alive) setRows(r.locations || []) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [year, month])

  const returned = rows.filter((r) => r.status === 'RETURNED').length

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, background: '#fff', padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>🏥 Room-Count Cards — {monthName} {year}</div>
        <button onClick={() => onNavigate && onNavigate('room-counts')} style={{ padding: '7px 14px', background: '#fff', color: '#2563EB', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          Manage & send →
        </button>
      </div>
      {returned > 0 && (
        <div style={{ fontSize: 13, color: '#166534', marginTop: 8 }}>
          ✓ {returned} site{returned === 1 ? '' : 's'} returned — these counts build the schedule (they override the template default).
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 10 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 10 }}>No sites yet — add coverage templates and site contacts to send room-count cards.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {rows.map((r) => {
            const m = RC_META[r.status] || RC_META.NOT_SENT
            return (
              <span key={r.location} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#334155', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px' }}>
                <strong style={{ color: '#0F172A', fontWeight: 700 }}>{r.location}</strong>
                <span style={{ fontSize: 11, fontWeight: 700, color: m.fg, background: m.bg, border: `1px solid ${m.bd}`, padding: '2px 7px', borderRadius: 999 }}>{m.label}</span>
                {r.status === 'RETURNED' && r.submittedAt && (
                  <span style={{ color: '#94A3B8' }}>{r.daysSubmitted}d · {new Date(r.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                )}
                {r.notes && r.notes.length > 0 && (
                  <span title={r.notes.map((n) => `${n.date}: ${n.note}`).join('\n')} style={{ color: '#B45309', fontWeight: 700 }}>✎{r.notes.length}</span>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate() }
function getFirstDayOfWeek(year, month) { const d = new Date(year, month - 1, 1).getDay(); return (d + 6) % 7 }

const inputStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC', boxSizing: 'border-box',
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: wide ? 720 : 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatBox({ label, value, color = '#0F172A', poweredBy }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '14px 20px', minWidth: 110 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{value}</div>
      {poweredBy && <div style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic', marginTop: 2 }}>Powered by StaffIQ™</div>}
    </div>
  )
}

// Baseline-vs-SNAP cost comparison. Coordinator sets the industry-standard
// cost per room/day once (persists on the facility). The panel then renders
// in three progressive stages keyed off the LIVE summary endpoint — not a
// build snapshot — so every room add/remove and every assignment edit moves
// the numbers:
//   1. Rooms exist, no assignments → show the baseline only
//   2. Rooms + assignments         → show baseline + SNAP labor cost + delta
//   3. No rooms yet                → "Add rooms to see…" copy
// summary is { totalShifts, estimatedCost, defaultRateProviders } from
// GET /api/schedule/summary.
function CostComparisonPanel({ rate, summary, onSaveRate, saving, onEditSiteRates }) {
  const hasRate = rate != null && rate > 0
  const [editing, setEditing] = useState(!hasRate)
  const [val, setVal] = useState(hasRate ? String(rate) : '')

  const roomDays = summary?.totalShifts || 0
  const snapCost = summary?.estimatedCost || 0
  // The backend now sums baseline per-site (applying overrides from
  // FacilitySiteRate). Fall back to rate × roomDays when the summary is
  // missing the field (older response shape).
  const baseline = summary?.baselineCost != null
    ? summary.baselineCost
    : (hasRate ? rate * roomDays : 0)
  const savings = baseline - snapCost
  const pct = baseline > 0 ? Math.round((savings / baseline) * 100) : 0
  const good = savings >= 0
  const hasAssignments = snapCost > 0
  const defaultRateCount = summary?.defaultRateProviders || 0
  const siteBreakdown = summary?.siteBreakdown || []
  const overrideCount = siteBreakdown.filter((s) => s.hasOverride).length
  const multiSite = siteBreakdown.length > 1

  async function save() {
    const num = parseFloat(val)
    if (!num || num <= 0) return
    await onSaveRate(num)
    setEditing(false)
  }

  const cell = (label, value, sub, color, big) => (
    <div style={{ flex: 1, minWidth: 150, padding: '12px 16px', background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 22, fontWeight: 800, color, letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>💵 Cost vs. your manual process</div>
        {hasRate && !editing && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button onClick={() => { setVal(String(rate)); setEditing(true) }} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Default {fmt(rate)}/room/day · edit
            </button>
            {onEditSiteRates && (
              <button onClick={onEditSiteRates} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Per-site rates{overrideCount > 0 ? ` (${overrideCount})` : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Industry cost per room, per day</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: 10, color: '#94A3B8' }}>$</span>
              <input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="1500" style={{ ...inputStyle, width: 170, paddingLeft: 22 }} />
            </div>
            <button onClick={save} disabled={saving} style={{ padding: '10px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {hasRate && <button onClick={() => setEditing(false)} style={{ padding: '10px 16px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, maxWidth: 580 }}>
            Your fully-loaded cost to staff one anesthetizing location for one day under your current/agency process. SNAP compares it to what each built schedule actually costs.
          </div>
        </div>
      ) : roomDays === 0 ? (
        <div style={{ fontSize: 13, color: '#64748B' }}>
          Add rooms to this month (via a coverage template or the day editor) to see your manual-process cost{hasRate ? ` at ${fmt(rate)}/room/day` : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
            {cell(
              'Your manual process',
              fmt(baseline),
              multiSite
                ? `${roomDays} room-days across ${siteBreakdown.length} sites`
                : `${roomDays} room-days × ${fmt(rate)}`,
              '#475569'
            )}
            {hasAssignments
              ? cell('SNAP schedule', fmt(snapCost), 'this month · all-in', '#2563EB')
              : cell('SNAP schedule', '—', 'build the schedule to compute', '#94A3B8')
            }
            {hasAssignments
              ? cell(good ? 'You save / month' : 'Over baseline', fmt(Math.abs(savings)), `${Math.abs(pct)}% ${good ? 'below' : 'above'} your process`, good ? '#059669' : '#DC2626', true)
              : cell('Savings', '—', 'available after build', '#94A3B8', true)
            }
          </div>
          {multiSite && siteBreakdown.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#64748B', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {siteBreakdown.map((s) => (
                <span key={s.siteName}>
                  <strong style={{ color: '#0F172A' }}>{s.siteName}</strong> · {s.roomDays} rd × {fmt(s.rateUsed)}{!s.hasOverride && <span style={{ color: '#94A3B8' }}> (default)</span>}
                </span>
              ))}
            </div>
          )}
          {hasAssignments && defaultRateCount > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
              ⚠️ <strong>{defaultRateCount} provider{defaultRateCount !== 1 ? 's' : ''}</strong> in this schedule {defaultRateCount !== 1 ? 'are' : 'is'} using estimated rates — enter their real pay in the roster to refine this savings number.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Given an array of scheduleDay rows for one date, compute fill stats
function getDayStats(dayRows) {
  let totalRooms = 0
  let filledRooms = 0
  let assignedProviders = 0

  dayRows.forEach(row => {
    const required = row.roomsRequired || 1
    totalRooms += required
    const assignments = row.assignments || []
    assignments.forEach(a => {
      assignedProviders++
      if (a.rosterId) filledRooms++
    })
    // Count empty rooms (no assignment row at all)
    const assignedRooms = new Set(assignments.map(a => a.roomNumber))
    for (let r = 1; r <= required; r++) {
      if (!assignedRooms.has(r)) {
        // room exists but no assignment
      } else if (assignments.find(a => a.roomNumber === r && a.rosterId)) {
        // already counted above
      }
    }
    // Recalculate: filled = assignments with a rosterId
    filledRooms = 0
  })

  // Recalculate cleanly
  filledRooms = 0
  assignedProviders = 0
  dayRows.forEach(row => {
    const assignments = row.assignments || []
    assignments.forEach(a => {
      if (a.rosterId) { filledRooms++; assignedProviders++ }
    })
  })

  return { totalRooms, filledRooms, assignedProviders }
}

function getDayColor(dayRows) {
  if (!dayRows || dayRows.length === 0) return null
  const { totalRooms, filledRooms, assignedProviders } = getDayStats(dayRows)
  if (totalRooms === 0) return null
  const gap = totalRooms - filledRooms
  if (assignedProviders > totalRooms) return 'blue'   // overstaffed
  if (gap === 0) return 'green'
  if (gap === 1) return 'yellow'
  return 'red'
}

const STATUS_COLORS = {
  green:  { border: '#86EFAC', bg: '#F0FDF4', text: '#16A34A', label: 'Fully Covered' },
  yellow: { border: '#FCD34D', bg: '#FFFBEB', text: '#D97706', label: '1 Room Short' },
  red:    { border: '#FCA5A5', bg: '#FEF2F2', text: '#DC2626', label: 'Gaps Exist' },
  blue:   { border: '#93C5FD', bg: '#EFF6FF', text: '#2563EB', label: 'Review Coverage' },
}

// Modal for setting/clearing per-site baseline rates. Lists every site
// the current schedule touches (sourced from summary.siteBreakdown) plus
// any other sites that already have an override on file.
function SiteRatesModal({ siteBreakdown, defaultRate, onClose, onDirty }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const { rates } = await facilityAPI.getSiteRates()
        // Union: every site on the current schedule + every site with an
        // existing override (so older overrides for retired sites stay
        // editable instead of silently lingering).
        const overrideMap = new Map(rates.map((r) => [r.siteName, r.ratePerDay]))
        const sched = new Map((siteBreakdown || []).map((s) => [s.siteName, s]))
        const allNames = new Set([...overrideMap.keys(), ...sched.keys()])
        const seeded = [...allNames].sort().map((siteName) => ({
          siteName,
          val: overrideMap.has(siteName) ? String(overrideMap.get(siteName)) : '',
          hasOverride: overrideMap.has(siteName),
          roomDays: sched.get(siteName)?.roomDays || 0,
        }))
        setRows(seeded)
      } catch (e) {
        alert('Failed to load site rates: ' + (e.message || 'Unknown'))
      } finally {
        setLoading(false)
      }
    })()
  }, [siteBreakdown])

  function updateVal(siteName, v) {
    setRows((rs) => rs.map((r) => (r.siteName === siteName ? { ...r, val: v } : r)))
  }

  async function saveRow(row) {
    const num = parseFloat(row.val)
    if (!Number.isFinite(num) || num < 0) {
      alert('Enter a positive number, or click Clear to revert to the default.')
      return
    }
    setSavingKey(row.siteName)
    try {
      await facilityAPI.setSiteRate(row.siteName, num)
      setRows((rs) => rs.map((r) => (r.siteName === row.siteName ? { ...r, hasOverride: true } : r)))
      onDirty && onDirty()
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown'))
    } finally {
      setSavingKey(null)
    }
  }

  async function clearRow(row) {
    setSavingKey(row.siteName)
    try {
      await facilityAPI.deleteSiteRate(row.siteName)
      setRows((rs) => rs.map((r) => (r.siteName === row.siteName ? { ...r, val: '', hasOverride: false } : r)))
      onDirty && onDirty()
    } catch (e) {
      alert('Clear failed: ' + (e.message || 'Unknown'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Modal title="Per-site baseline rates" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#64748B', marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
        Override the default ${defaultRate || 0}/room/day for individual sites. The "manual process" baseline in the cost
        panel sums each site's room-days × its rate. Leave blank or click <strong>Clear</strong> to fall back to the default.
      </p>
      {loading ? (
        <div style={{ fontSize: 13, color: '#94A3B8' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748B' }}>No sites yet. Generate a schedule or add rooms to populate this list.</div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((row) => (
            <div key={row.siteName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{row.siteName}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>
                  {row.roomDays > 0 ? `${row.roomDays} room-days this month` : 'not on current schedule'}
                  {row.hasOverride ? ' · override active' : ' · using default'}
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: 8, color: '#94A3B8' }}>$</span>
                <input
                  type="number"
                  value={row.val}
                  onChange={(e) => updateVal(row.siteName, e.target.value)}
                  placeholder={String(defaultRate || '1500')}
                  style={{ ...inputStyle, width: 110, paddingLeft: 20 }}
                />
              </div>
              <button onClick={() => saveRow(row)} disabled={savingKey === row.siteName} style={{ padding: '8px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: savingKey === row.siteName ? 'default' : 'pointer', opacity: savingKey === row.siteName ? 0.6 : 1 }}>
                {savingKey === row.siteName ? '…' : 'Save'}
              </button>
              <button onClick={() => clearRow(row)} disabled={!row.hasOverride || savingKey === row.siteName} style={{ padding: '8px 12px', background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: (!row.hasOverride || savingKey === row.siteName) ? 'not-allowed' : 'pointer', opacity: !row.hasOverride ? 0.4 : 1 }}>
                Clear
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={{ padding: '9px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Done
        </button>
      </div>
    </Modal>
  )
}

export default function ScheduleBuilderPage({ onNavigate }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [scheduleData, setScheduleData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [addLocModal, setAddLocModal] = useState(null)
  const [locForm, setLocForm] = useState({ location: '', roomsRequired: 1 })
  const [savingLoc, setSavingLoc] = useState(false)

  const [dayDetailModal, setDayDetailModal] = useState(null) // dateStr
  const [outListModal, setOutListModal] = useState(null) // { dayId, title }
  const [showOutListRules, setShowOutListRules] = useState(false)
  const [assignLoading, setAssignLoading] = useState({})
  const [editingLocation, setEditingLocation] = useState(null)
  const [deletingLocation, setDeletingLocation] = useState(null)
  const [publishing, setPublishing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [intelligence, setIntelligence] = useState(null)
  const [availabilities, setAvailabilities] = useState([]) // from schedule month response
  const [timeOff, setTimeOff] = useState([]) // PTO ranges from schedule month response
  const [maybeNotes, setMaybeNotes] = useState([]) // "maybe" sticky notes from the tokenized availability link

  // Coverage Templates for the "Generate from template" banner shown when
  // the current month is empty. Loaded once on mount; generation pulls the
  // selected template + month and bulk-creates ScheduleDay rows server-side.
  const [coverageTemplates, setCoverageTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [generateMessage, setGenerateMessage] = useState(null) // success or error

  // Room-count card day-notes for this month, keyed `${dateStr}::${location}`,
  // rendered as post-its on the matching calendar day (like provider notes).
  const [roomNotes, setRoomNotes] = useState({})

  // Schedule Builder v2 — the build flow modal. selectedRunId persists
  // across navigations so we can offer the "Re-score after edits" button.
  const [showBuildFlow, setShowBuildFlow] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRunScore, setSelectedRunScore] = useState(null)
  const [selectedRunRecs, setSelectedRunRecs] = useState(null)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreMessage, setRescoreMessage] = useState(null)
  // Facility (for the industry-baseline rate) + the selected build's insights
  // (roomDays + totalCost) that drive the cost-comparison panel.
  const [facility, setFacility] = useState(null)
  const [selectedRunInsights, setSelectedRunInsights] = useState(null)
  const [savingRate, setSavingRate] = useState(false)
  const [showSiteRates, setShowSiteRates] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sched, summ, rosterData, intel, tmplRes, me] = await Promise.all([
        facilityAPI.getScheduleMonth(year, month),
        facilityAPI.getScheduleSummary(year, month).catch(() => null),
        facilityAPI.getRoster().catch(() => []),
        facilityAPI.getScheduleIntelligence().catch(() => null),
        facilityAPI.getCoverageTemplates().catch(() => ({ templates: [] })),
        facilityAPI.getMe().catch(() => null),
      ])
      setScheduleData(sched)
      setSummary(summ)
      if (me) setFacility(me)
      const r = Array.isArray(rosterData) ? rosterData : rosterData.roster || []
      setRoster(r)
      setIntelligence(intel)
      // Extract availabilities from schedule month response
      const av = sched?.availabilities || []
      setAvailabilities(av)
      setTimeOff(sched?.timeOff || [])
      setMaybeNotes(sched?.maybeNotes || [])
      const templates = tmplRes?.templates || []
      setCoverageTemplates(templates)
      // Default the dropdown selection to the practice's default template, or
      // the first one in the list. Coordinator can always pick a different one.
      if (!selectedTemplateId && templates.length > 0) {
        const def = templates.find((t) => t.isDefault) || templates[0]
        setSelectedTemplateId(def.id)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  // Load room-count card notes for the month and index by date+location.
  useEffect(() => {
    let alive = true
    facilityAPI.getRoomRequestStatus(year, month)
      .then((r) => {
        if (!alive) return
        const map = {}
        for (const loc of r.locations || []) {
          for (const n of loc.notes || []) map[`${n.date}::${loc.location}`] = n.note
        }
        setRoomNotes(map)
      })
      .catch(() => { if (alive) setRoomNotes({}) })
    return () => { alive = false }
  }, [year, month])

  async function handleRescore() {
    if (!selectedRunId) return
    setRescoring(true)
    setRescoreMessage(null)
    try {
      const res = await facilityAPI.rescoreBuildRun(selectedRunId)
      setSelectedRunScore(res.score)
      if (res.staffiqRecommendations !== undefined) setSelectedRunRecs(res.staffiqRecommendations)
      if (res.insights) setSelectedRunInsights(res.insights)
      const delta = res.delta || 0
      const sign = delta > 0 ? '+' : ''

      // Lead with cost — it means more to coordinators than the StaffIQ score.
      let costText = ''
      if (res.newCost != null) {
        const fmt = (n) => `$${Math.round(n).toLocaleString()}`
        if (res.costDelta != null && res.costDelta !== 0) {
          const up = res.costDelta > 0
          // A cost increase is bad (red-ish phrasing), a decrease is a saving.
          costText = `Estimated cost: ${fmt(res.newCost)} (${up ? '+' : '−'}${fmt(Math.abs(res.costDelta))} ${up ? 'more' : 'saved'} vs last build). `
        } else {
          costText = `Estimated cost: ${fmt(res.newCost)}. `
        }
      }

      setRescoreMessage({
        kind: 'success',
        text: `${costText}StaffIQ score: ${res.score} (${sign}${delta}).`,
      })
    } catch (err) {
      setRescoreMessage({ kind: 'error', text: err.message || 'Re-score failed.' })
    } finally {
      setRescoring(false)
    }
  }

  async function handleSaveRate(num) {
    setSavingRate(true)
    try {
      const updated = await facilityAPI.updateMe({ industryRoomRatePerDay: num })
      setFacility(updated)
    } catch (e) {
      alert('Could not save the industry rate: ' + (e.message || 'Unknown error'))
    } finally {
      setSavingRate(false)
    }
  }

  // Clear any build the coordinator had selected — it no longer matches the
  // schedule once the month is wiped or regenerated from a different template.
  function resetSelectedRun() {
    setSelectedRunId(null)
    setSelectedRunScore(null)
    setSelectedRunRecs(null)
    setSelectedRunInsights(null)
  }

  function monthDays() {
    return scheduleData ? (Array.isArray(scheduleData) ? scheduleData : scheduleData.days || []) : []
  }

  async function handleGenerateFromTemplate() {
    if (!selectedTemplateId) return
    const hasDays = monthDays().length > 0
    // Generating onto an existing month is a full replace (the month is cleared
    // first so a different template doesn't leave stale locations behind).
    if (hasDays && !window.confirm(`This will replace the current ${monthName} ${year} schedule with the selected template. Continue?`)) return
    setGenerating(true)
    setGenerateMessage(null)
    try {
      if (hasDays) {
        await facilityAPI.clearScheduleMonth(year, month)
        resetSelectedRun()
      }
      const res = await facilityAPI.generateScheduleFromTemplate(year, month, selectedTemplateId)
      const s = res.summary || {}
      setGenerateMessage({
        kind: 'success',
        text: `Generated ${s.rowsCreated || 0} new schedule rows across ${s.locations?.length || 0} locations${
          s.rowsUpdated ? `, updated ${s.rowsUpdated} existing` : ''
        }${s.holidaysSkipped ? `. Skipped ${s.holidaysSkipped} holiday day(s).` : '.'}`,
      })
      // Reload to pull the freshly-materialized days into the calendar view.
      await load()
    } catch (e) {
      setGenerateMessage({ kind: 'error', text: e.message || 'Generate failed.' })
    } finally {
      setGenerating(false)
    }
  }

  async function handleClearMonth() {
    if (!window.confirm(`Clear the entire ${monthName} ${year} schedule? This removes all days and assignments for the month.`)) return
    setClearing(true)
    setGenerateMessage(null)
    try {
      const res = await facilityAPI.clearScheduleMonth(year, month)
      resetSelectedRun()
      setGenerateMessage({
        kind: 'success',
        text: `Cleared ${res.daysDeleted || 0} day(s) and ${res.assignmentsDeleted || 0} assignment(s). ${monthName} is now empty.`,
      })
      await load()
    } catch (e) {
      setGenerateMessage({ kind: 'error', text: e.message || 'Clear failed.' })
    } finally {
      setClearing(false)
    }
  }

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  async function handleAddLocation() {
    if (!locForm.location.trim()) return alert('Location name is required.')
    setSavingLoc(true)
    try {
      await facilityAPI.upsertScheduleDay({ date: addLocModal.dateStr, location: locForm.location, roomsRequired: Number(locForm.roomsRequired) })
      setAddLocModal(null)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSavingLoc(false)
    }
  }

  async function handleEditRooms(row, delta) {
    const next = (row.roomsRequired || 1) + delta
    if (next < 1) return
    setEditingLocation(row.id)
    try {
      const dateStr = row.date?.slice(0, 10)
      await facilityAPI.upsertScheduleDay({ date: dateStr, location: row.location, roomsRequired: next })
      await load()
    } catch (e) {
      alert('Update failed: ' + e.message)
    } finally {
      setEditingLocation(null)
    }
  }

  async function handleDeleteLocation(row) {
    if (!window.confirm(`Remove "${row.location}" from this day? All room assignments will be cleared.`)) return
    setDeletingLocation(row.id)
    try {
      await facilityAPI.deleteScheduleDay(row.id)
      await load()
      // If this was the last location, close the modal
      const remaining = detailDayRows.filter(r => r.id !== row.id)
      if (remaining.length === 0) setDayDetailModal(null)
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeletingLocation(null)
    }
  }

  async function handleAssign(dayId, roomNumber, rosterId, role) {
    const key = `${dayId}-${roomNumber}`
    setAssignLoading(p => ({ ...p, [key]: true }))
    try {
      await facilityAPI.assignProvider(dayId, roomNumber, rosterId === '' ? null : rosterId, role)
      await load()
    } catch (e) {
      alert('Assignment failed: ' + e.message)
    } finally {
      setAssignLoading(p => ({ ...p, [key]: false }))
    }
  }

  async function handlePublish() {
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })
    if (!window.confirm(`Publish the ${monthName} ${year} schedule? Providers will be notified.`)) return
    setPublishing(true)
    try {
      await facilityAPI.publishSchedule(year, month)
      alert('Schedule published successfully!')
    } catch (e) {
      alert('Publish failed: ' + e.message)
    } finally {
      setPublishing(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await facilityAPI.exportSchedule(year, month)
      const rows = [['Date', 'Location', 'Room', 'Role', 'Provider', 'Type', 'Category']]
      const exportRows = Array.isArray(data) ? data : data.rows || []
      exportRows.forEach(r => rows.push([r.date, r.location, r.room, r.role || '', r.providerName || '', r.providerType || '', r.employmentCategory || '']))
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `schedule-${year}-${String(month).padStart(2, '0')}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  // Score a roster provider for a given date/location using preference data
  function scoreProvider(provider, dateStr, locationName) {
    const date = new Date(dateStr + 'T12:00:00')
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
    let score = 0
    const tags = []

    // 1. Availability on this date (only rows explicitly marked available)
    const isAvailable = availabilities.some(a => {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      return a.rosterId === provider.id && avDate === dateStr && a.available
    })
    if (isAvailable) { score += 40; tags.push('Available') }

    // 2. Preferred day
    const prefDays = Array.isArray(provider.preferredDays) ? provider.preferredDays : []
    if (prefDays.includes(dayName)) { score += 20; tags.push('Preferred Day') }

    // 3. Location ranking
    const rankings = Array.isArray(provider.locationRankings) ? provider.locationRankings : []
    const locIdx = rankings.findIndex(l => l.toLowerCase() === locationName.toLowerCase())
    if (locIdx === 0) { score += 15; tags.push('Top Location') }
    else if (locIdx === 1) { score += 10; tags.push('Preferred Location') }
    else if (locIdx > 1) { score += 5 }

    // 4. Employment category (FT > PD > Locums)
    const catScore = { FULL_TIME: 10, PER_DIEM: 6, LOCUMS: 3 }
    score += catScore[provider.employmentCategory] || 0

    // 5. Lower cost (invert: lower hourly = higher score)
    const rate = provider.hourlyRate || (provider.annualRate ? provider.annualRate / 2080 : 999)
    score += Math.max(0, 10 - Math.floor(rate / 20))

    return { score, tags }
  }

  function rankedRoster(dateStr, locationName) {
    return [...roster]
      .map(p => ({ ...p, _rank: scoreProvider(p, dateStr, locationName) }))
      .sort((a, b) => b._rank.score - a._rank.score)
  }

  // Editing guardrail: who's already working somewhere that day (rosterId →
  // location label), so the coordinator can't accidentally double-book across
  // locations. Supervising MDs count too (they're working). Built from every
  // location's assignments for the open day.
  function assignedThatDay(dateStr) {
    const map = {}
    for (const row of (daysByDate[dateStr] || [])) {
      for (const a of (row.assignments || [])) {
        if (a.rosterId) map[a.rosterId] = row.location
      }
    }
    return map
  }

  // Who can't work that day → rosterId → reason label. Covers explicit
  // unavailability (ProviderAvailability.available === false) and PTO /
  // time-off ranges covering the date. Providers with no signal are
  // "unknown" and stay selectable (no false positives).
  function unavailableThatDay(dateStr) {
    const map = new Map()
    for (const a of availabilities) {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      if (avDate === dateStr && a.available === false && a.rosterId) map.set(a.rosterId, 'unavailable')
    }
    for (const t of timeOff) {
      const s = (typeof t.startDate === 'string' ? t.startDate : new Date(t.startDate).toISOString()).substring(0, 10)
      const e = (typeof t.endDate === 'string' ? t.endDate : new Date(t.endDate).toISOString()).substring(0, 10)
      if (dateStr >= s && dateStr <= e && t.rosterEntryId) map.set(t.rosterEntryId, 'time off')
    }
    return map
  }

  // Task #20: provider availability notes for a date → [{ name, note }].
  // Surfaced at the top of the day editor so the coordinator sees context
  // like "can work after 10am" or "Natick only" before assigning.
  function notesThatDay(dateStr) {
    const out = []
    for (const a of availabilities) {
      if (!a.note) continue
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      if (avDate === dateStr) {
        out.push({ name: a.rosterEntry?.providerName || 'A provider', note: a.note })
      }
    }
    return out
  }

  const rosterNameById = () => Object.fromEntries(roster.map(p => [p.id, p.providerName]))
  const hourlyOf = (p) => p.hourlyRate || (p.annualRate ? Math.round(p.annualRate / 2080) : null)

  // Providers who marked themselves AVAILABLE this day but were NOT scheduled
  // anywhere — the pool a coordinator can pull from on final revision. Sorted
  // cheapest-first with each provider's hourly rate.
  function availableUnusedThatDay(dateStr) {
    const assigned = assignedThatDay(dateStr)
    const availableIds = new Set()
    for (const a of availabilities) {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      if (avDate === dateStr && a.available && a.rosterId) availableIds.add(a.rosterId)
    }
    return roster
      .filter(p => availableIds.has(p.id) && !assigned[p.id])
      .map(p => ({ id: p.id, name: p.providerName, type: p.providerType, category: p.employmentCategory, rate: hourlyOf(p) }))
      .sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity))
  }

  // Who is on PTO / time off this day → [{ name, type }].
  function ptoThatDay(dateStr) {
    const nameById = rosterNameById()
    const out = []
    for (const t of timeOff) {
      const s = (typeof t.startDate === 'string' ? t.startDate : new Date(t.startDate).toISOString()).substring(0, 10)
      const e = (typeof t.endDate === 'string' ? t.endDate : new Date(t.endDate).toISOString()).substring(0, 10)
      if (dateStr >= s && dateStr <= e && t.rosterEntryId) {
        out.push({ name: nameById[t.rosterEntryId] || t.rosterEntry?.providerName || 'A provider', type: t.type || 'Time off' })
      }
    }
    return out
  }

  // "Maybe" days a provider flagged via the tokenized availability link →
  // [{ name, note }]. Soft/conditional — never auto-scheduled; shown so the
  // coordinator can reach out and pull them in if they need the coverage.
  function maybeThatDay(dateStr) {
    return maybeNotes
      .filter((m) => (typeof m.date === 'string' ? m.date : new Date(m.date).toISOString()).substring(0, 10) === dateStr)
      .map((m) => ({ name: m.providerName || 'A provider', note: m.note || null }))
  }

  // Room-count card notes the site left for this day → [{ location, note }].
  function roomNotesThatDay(dateStr) {
    return Object.entries(roomNotes)
      .filter(([k]) => k.startsWith(dateStr + '::'))
      .map(([k, note]) => ({ location: k.slice(dateStr.length + 2), note }))
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })

  // Group schedule days by date — a date can have multiple location rows
  const daysByDate = {}
  if (scheduleData) {
    const days = Array.isArray(scheduleData) ? scheduleData : scheduleData.days || []
    days.forEach(d => {
      const key = d.date?.slice(0, 10)
      if (!daysByDate[key]) daysByDate[key] = []
      daysByDate[key].push(d)
    })
  }

  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function padDate(d) { return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` }

  const detailDayRows = dayDetailModal ? (daysByDate[dayDetailModal] || []) : []

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={prevMonth} style={{ padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }}>‹</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', minWidth: 160, textAlign: 'center' }}>{monthName} {year}</div>
          <button onClick={nextMonth} style={{ padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }}>›</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <StatBox label="Total Shifts" value={summary?.totalShifts ?? '—'} />
          <StatBox label="Filled" value={summary?.filled ?? '—'} color="#10B981" />
          <StatBox label="Remaining" value={summary?.remaining ?? '—'} color="#EF4444" />
          {/* "Est. Cost" = your industry baseline (rate × room-days). Lights
              up as soon as rooms exist on the calendar, regardless of whether
              a build has been run. The post-build SNAP labor cost lives in
              the Cost-vs-manual-process panel below. */}
          <StatBox
            label="Est. Cost"
            value={
              facility?.industryRoomRatePerDay > 0 && summary?.totalShifts > 0
                ? fmt(facility.industryRoomRatePerDay * summary.totalShifts)
                : '—'
            }
            color="#2563EB"
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowBuildFlow(true)}
            style={{
              padding: '10px 20px',
              background: '#10B981',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🚀 Build the Schedule
          </button>
          <button onClick={handlePublish} disabled={publishing} style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.7 : 1 }}>
            {publishing ? 'Publishing...' : '📢 Publish Schedule'}
          </button>
          <button onClick={() => setShowOutListRules(true)} title="Set out-list rules and one-click build the release order" style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            🚪 Out Lists
          </button>
          <button onClick={handleExport} disabled={exporting} style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer', color: '#374151' }}>
            {exporting ? 'Exporting...' : '⬇️ Export CSV'}
          </button>
        </div>
      </div>

      {/* Provider Availability — request + track self-submission from roster members */}
      <RoomCountPanel year={year} month={month} onNavigate={onNavigate} />

      <ProviderAvailabilityPanel
        year={year}
        month={month}
        roster={roster}
        facilityId={facility?.id}
      />

      {facility && (
        <CostComparisonPanel
          rate={facility.industryRoomRatePerDay}
          summary={summary}
          onSaveRate={handleSaveRate}
          saving={savingRate}
          onEditSiteRates={() => setShowSiteRates(true)}
        />
      )}
      {showSiteRates && (
        <SiteRatesModal
          siteBreakdown={summary?.siteBreakdown || []}
          defaultRate={facility?.industryRoomRatePerDay}
          onClose={() => setShowSiteRates(false)}
          onDirty={() => load()}
        />
      )}

      {/* Generate-from-template banner — shown only when this month has no
          schedule rows yet AND the practice has at least one Coverage
          Template configured. After generation, the existing click-a-day
          editor takes over. */}
      {(() => {
        if (loading || coverageTemplates.length === 0) return null
        const hasDays = monthDays().length > 0
        const busy = generating || clearing
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 18px', marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🧩</span>
            <div style={{ flex: 1, fontSize: 13, color: '#064E3B', minWidth: 240 }}>
              {hasDays ? (
                <>
                  <strong>Switch templates or rebuild {monthName} {year}.</strong>
                  <span style={{ color: '#047857' }}> Generating replaces this month with the selected template — you can edit any day afterward.</span>
                </>
              ) : (
                <>
                  <strong>{monthName} {year} is empty.</strong>
                  <span style={{ color: '#047857' }}> Pre-fill it from one of your Coverage Templates — you can edit any day afterward.</span>
                </>
              )}
            </div>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ padding: '8px 12px', border: '1.5px solid #A7F3D0', borderRadius: 8, fontSize: 13, background: '#fff', color: '#064E3B', minWidth: 200 }}
              disabled={busy}
            >
              {coverageTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerateFromTemplate}
              disabled={busy || !selectedTemplateId}
              style={{ padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
            >
              {generating ? 'Generating…' : hasDays ? `Replace ${monthName}` : `Generate ${monthName}`}
            </button>
            {hasDays && (
              <button
                onClick={handleClearMonth}
                disabled={busy}
                style={{ padding: '10px 16px', background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
              >
                {clearing ? 'Clearing…' : '🗑️ Clear month'}
              </button>
            )}
          </div>
        )
      })()}
      {generateMessage && (
        <div
          style={{
            background: generateMessage.kind === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${generateMessage.kind === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: generateMessage.kind === 'success' ? '#065F46' : '#991B1B',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>{generateMessage.text}</span>
          <button
            onClick={() => setGenerateMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Schedule Intelligence banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
        <span style={{ fontSize: 16 }}>🧠</span>
        <div style={{ flex: 1, fontSize: 13, color: '#172554' }}>
          <strong>StaffIQ Schedule Intelligence</strong> — Suggestions are ranked by provider availability, preferences, and cost optimization.
        </div>
        {intelligence && (
          <div style={{ display: 'flex', align: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2563EB' }}>{intelligence.score}%</div>
              <div style={{ fontSize: 10, color: '#1E3A8A', fontWeight: 600, textTransform: 'uppercase' }}>Intelligence</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2563EB' }}>{intelligence.dataPoints}</div>
              <div style={{ fontSize: 10, color: '#1E3A8A', fontWeight: 600, textTransform: 'uppercase' }}>Data Points</div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([key, c]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: c.bg, border: `2px solid ${c.border}` }} />
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>{c.label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#fff', border: '2px solid #E2E8F0' }} />
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>No schedule</span>
        </div>
      </div>

      {/* Build-run banner — shown after coordinator selects a build, lets
          them re-score after edits */}
      {selectedRunId && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#F0F9FF',
            border: '1px solid #BAE6FD',
            borderRadius: 10,
            padding: '12px 18px',
            marginBottom: 16,
            color: '#075985',
          }}
        >
          <span style={{ fontSize: 18 }}>🚀</span>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong>StaffIQ score: {selectedRunScore ?? '—'}</strong>
            <span style={{ marginLeft: 8, color: '#0369A1' }}>
              Edit any cell, then re-score to see how your changes moved the needle.
            </span>
          </div>
          <button
            onClick={handleRescore}
            disabled={rescoring}
            style={{
              padding: '8px 16px',
              background: '#0EA5E9',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: rescoring ? 'not-allowed' : 'pointer',
            }}
          >
            {rescoring ? 'Re-scoring…' : 'Re-score'}
          </button>
        </div>
      )}
      {selectedRunId && selectedRunRecs?.totalProjectedSavings > 0 && (
        <div style={{ marginBottom: 16 }}>
          <StaffIQRecommendations recommendations={selectedRunRecs} />
        </div>
      )}
      {rescoreMessage && (
        <div
          style={{
            background: rescoreMessage.kind === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${rescoreMessage.kind === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: rescoreMessage.kind === 'success' ? '#065F46' : '#991B1B',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{rescoreMessage.text}</span>
          <button
            onClick={() => setRescoreMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px', color: '#DC2626', marginBottom: 16 }}>
          Error loading schedule: {error}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading schedule...</div>}

      {!loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '6px 0' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} style={{ minHeight: 100, background: 'transparent' }} />

              const dateStr = padDate(day)
              const dayRows = daysByDate[dateStr] || []
              const hasSchedule = dayRows.length > 0
              const dayNoteEntries = Object.entries(roomNotes)
                .filter(([k]) => k.startsWith(dateStr + '::'))
                .map(([k, note]) => ({ location: k.slice(dateStr.length + 2), note }))
              const colorKey = getDayColor(dayRows)
              const sc = colorKey ? STATUS_COLORS[colorKey] : null
              const { totalRooms, filledRooms } = hasSchedule ? getDayStats(dayRows) : { totalRooms: 0, filledRooms: 0 }
              const isToday = day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()

              const borderColor = isToday ? '#2563EB' : (sc ? sc.border : '#E2E8F0')
              const bgColor = isToday ? '#F5F3FF' : (sc ? sc.bg : '#fff')

              return (
                <div
                  key={dateStr}
                  onClick={() => hasSchedule && setDayDetailModal(dateStr)}
                  style={{
                    background: bgColor,
                    border: `2px solid ${borderColor}`,
                    borderRadius: 10,
                    minHeight: 100,
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: hasSchedule ? 'pointer' : 'default',
                    transition: 'box-shadow 0.12s ease',
                  }}
                  onMouseEnter={e => { if (hasSchedule) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
                >
                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? '#2563EB' : '#0F172A' }}>{day}</span>
                    <button
                      onClick={e => { e.stopPropagation(); setAddLocModal({ dateStr }); setLocForm({ location: '', roomsRequired: 1 }) }}
                      title="Add location"
                      style={{ fontSize: 10, padding: '2px 6px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 4, cursor: 'pointer', color: '#1D4ED8', fontWeight: 700 }}
                    >+</button>
                  </div>

                  {/* Room-count sticky notes from the site (post-it style) */}
                  {dayNoteEntries.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 5 }}>
                      {dayNoteEntries.slice(0, 2).map((n, ni) => (
                        <div
                          key={ni}
                          title={`${n.location}: ${n.note}`}
                          onClick={e => e.stopPropagation()}
                          style={{
                            background: 'linear-gradient(160deg,#FEF9C3 0%,#FDE047 100%)',
                            border: '1px solid #FACC15',
                            borderRadius: 3,
                            padding: '3px 5px',
                            transform: ni % 2 ? 'rotate(0.7deg)' : 'rotate(-0.9deg)',
                            boxShadow: '0 1px 2px rgba(161,98,7,0.28)',
                            fontSize: 8.5,
                            lineHeight: 1.35,
                            color: '#713F12',
                            cursor: 'default',
                          }}
                        >
                          <span style={{ fontWeight: 800 }}>✎ {n.location}</span>{' '}
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.note}</span>
                        </div>
                      ))}
                      {dayNoteEntries.length > 2 && (
                        <div style={{ fontSize: 8, color: '#A16207', fontWeight: 700 }}>+{dayNoteEntries.length - 2} more</div>
                      )}
                    </div>
                  )}

                  {/* Shift summary */}
                  {hasSchedule ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: sc ? sc.text : '#0F172A', marginBottom: 4 }}>
                        {filledRooms}/{totalRooms} rooms filled
                      </div>
                      {dayRows.map((row, ri) => {
                        const filled = (row.assignments || []).filter(a => a.rosterId).length
                        const required = row.roomsRequired || 1
                        return (
                          <div key={ri} style={{ fontSize: 9, color: '#475569', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.location}: {filled}/{required}
                          </div>
                        )
                      })}
                      <div style={{ marginTop: 'auto', paddingTop: 4, fontSize: 9, color: '#94A3B8', fontStyle: 'italic' }}>
                        Tap to edit
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 9, color: '#CBD5E1', textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
                      No schedule
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Day Detail Modal */}
      {dayDetailModal && (
        <Modal title={(() => {
          const curDay = parseInt(dayDetailModal.slice(8, 10), 10)
          const prev = curDay > 1 ? padDate(curDay - 1) : null
          const next = curDay < daysInMonth ? padDate(curDay + 1) : null
          const label = new Date(dayDetailModal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          const arrow = (on) => ({ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: on ? '#F8FAFC' : '#F1F5F9', color: on ? '#374151' : '#CBD5E1', fontSize: 18, lineHeight: 1, cursor: on ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => prev && setDayDetailModal(prev)} disabled={!prev} title="Previous day" style={arrow(!!prev)}>‹</button>
              <span>{label}</span>
              <button onClick={() => next && setDayDetailModal(next)} disabled={!next} title="Next day" style={arrow(!!next)}>›</button>
            </span>
          )
        })()} onClose={() => setDayDetailModal(null)} wide>
          {/* Final-revision cockpit: notes & requests, who's available and idle
              (with rate), and who's on PTO for this day. */}
          {(() => {
            const notes = notesThatDay(dayDetailModal)
            const roomNotes_ = roomNotesThatDay(dayDetailModal)
            const idle = availableUnusedThatDay(dayDetailModal)
            const pto = ptoThatDay(dayDetailModal)
            const maybe = maybeThatDay(dayDetailModal)

            return (
              <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* "Maybe" — soft/conditional availability from the provider link */}
                {maybe.length > 0 && (
                  <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#C2410C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      🟠 Maybe — could work if you ask ({maybe.length})
                    </div>
                    {maybe.map((m, i) => (
                      <div key={`m${i}`} style={{ fontSize: 13, color: '#7C2D12', marginTop: 4 }}>
                        <strong>{m.name}</strong>{m.note ? <>: {m.note}</> : ' — flagged this day as a maybe'}
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes & requests */}
                {(notes.length > 0 || roomNotes_.length > 0) && (
                  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      📝 Notes &amp; requests for this day
                    </div>
                    {roomNotes_.map((n, i) => (
                      <div key={`r${i}`} style={{ fontSize: 13, color: '#78350F', marginTop: 4 }}>
                        <strong>{n.location} (site):</strong> {n.note}
                      </div>
                    ))}
                    {notes.map((n, i) => (
                      <div key={`p${i}`} style={{ fontSize: 13, color: '#78350F', marginTop: 4 }}>
                        <strong>{n.name}:</strong> {n.note}
                      </div>
                    ))}
                  </div>
                )}

                {/* Available-but-idle + PTO, side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Available & unused */}
                  <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                      ✅ Available &amp; unused ({idle.length}) · cheapest first
                    </div>
                    {idle.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: '#64748B' }}>No one marked available and unscheduled this day.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {idle.map((p) => (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <span style={{ color: '#0F172A', fontWeight: 600 }}>
                              {p.name}
                              <span style={{ color: '#64748B', fontWeight: 500 }}> · {p.type === 'ANESTHESIOLOGIST' ? 'MD' : p.type === 'CRNA' ? 'CRNA' : (p.type || '')}{p.category ? ` · ${p.category === 'FULL_TIME' ? 'FT' : p.category === 'PER_DIEM' ? 'PD' : p.category === 'LOCUMS' ? 'Locums' : p.category}` : ''}</span>
                            </span>
                            <span style={{ color: p.rate != null ? '#166534' : '#94A3B8', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {p.rate != null ? `$${p.rate}/hr` : 'no rate'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* On PTO */}
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                      🌴 On PTO / time off ({pto.length})
                    </div>
                    {pto.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: '#64748B' }}>No one on PTO this day.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {pto.map((p, i) => (
                          <div key={i} style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>
                            {p.name}<span style={{ color: '#94A3B8', fontWeight: 500 }}> · {p.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
          {detailDayRows.length === 0 ? (
            <p style={{ color: '#94A3B8' }}>No locations scheduled for this day.</p>
          ) : (
            (() => { const _assignedToday = assignedThatDay(dayDetailModal); const _unavailToday = unavailableThatDay(dayDetailModal); return detailDayRows.map((row) => {
              const required = row.roomsRequired || 1
              const assignments = row.assignments || []
              const assignedByRoom = Object.fromEntries(assignments.map(a => [a.roomNumber, a]))
              // Supervising MDs are stored at roomNumber >= 900 (role
              // SUPERVISING_MD); they're not OR rooms, so exclude them from
              // the fill count and surface them in their own section.
              const supervisors = assignments.filter(a => a.role === 'SUPERVISING_MD' && a.rosterId)
              const filled = assignments.filter(a => a.rosterId && a.role !== 'SUPERVISING_MD').length
              const gap = required - filled
              const colorKey = gap === 0 ? 'green' : gap === 1 ? 'yellow' : 'red'
              const sc = STATUS_COLORS[colorKey]
              const cov = coverageLabel(row.supervisionRatio)

              return (
                <div key={row.id} style={{ marginBottom: 20, border: `1px solid ${sc.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  {/* Location header */}
                  <div style={{ background: sc.bg, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.location}
                      {cov && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: cov.bg, color: cov.color }}>
                          {cov.text}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {/* Room count adjuster */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={() => handleEditRooms(row, -1)}
                          disabled={required <= 1 || editingLocation === row.id}
                          title="Remove a room"
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: required <= 1 ? 'not-allowed' : 'pointer', fontSize: 16, lineHeight: 1, color: '#374151', opacity: required <= 1 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >−</button>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', minWidth: 22, textAlign: 'center' }}>{required}</span>
                        <button
                          onClick={() => handleEditRooms(row, +1)}
                          disabled={editingLocation === row.id}
                          title="Add a room"
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >+</button>
                        <span style={{ fontSize: 11, color: '#64748B', marginLeft: 2 }}>rooms</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: sc.text }}>{filled}/{required} filled</div>
                      {/* Out-List Builder: post-publish release order for this
                          site/day. Available once anyone is staffed. */}
                      {(filled > 0 || supervisors.length > 0) && (
                        <button
                          onClick={() => setOutListModal({
                            dayId: row.id,
                            title: `${row.location} · ${new Date(dayDetailModal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
                          })}
                          title="Set the release order (who leaves first, who closes)"
                          style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${row.outListPublishedAt ? '#A7F3D0' : '#CBD5E1'}`, background: row.outListPublishedAt ? '#ECFDF5' : '#fff', color: row.outListPublishedAt ? '#047857' : '#475569', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                        >
                          🚪 Out List{row.outListPublishedAt ? ' ✓' : ''}
                        </button>
                      )}
                      {/* Delete location */}
                      <button
                        onClick={() => handleDeleteLocation(row)}
                        disabled={deletingLocation === row.id}
                        title="Remove this location"
                        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', cursor: 'pointer', color: '#EF4444', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: deletingLocation === row.id ? 0.5 : 1 }}
                      >🗑</button>
                    </div>
                  </div>

                  {/* Room rows */}
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Array.from({ length: required }, (_, ri) => {
                      const roomNum = ri + 1
                      const assignment = assignedByRoom[roomNum]
                      const assignedRosterId = assignment?.rosterId || ''
                      const aKey = `${row.id}-${roomNum}`
                      const isLoading = assignLoading[aKey]

                      return (
                        <div key={roomNum} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, fontSize: 12, fontWeight: 600, color: '#475569', flexShrink: 0 }}>Room {roomNum}</div>
                          {!assignedRosterId && (
                            <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700, flexShrink: 0 }}>⬜ Unfilled</div>
                          )}
                          {assignment?.role && ROLE_TAG[assignment.role] && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: ROLE_TAG[assignment.role].bg, color: ROLE_TAG[assignment.role].color, flexShrink: 0 }}>
                              {ROLE_TAG[assignment.role].text}
                            </span>
                          )}
                          {assignedRosterId && assignment?.rosterEntry && (
                            <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700, flexShrink: 0 }}>
                              {EMP_PREFIX[assignment.rosterEntry.employmentCategory]} {assignment.rosterEntry.providerName}
                            </div>
                          )}
                          <select
                            value={assignedRosterId}
                            disabled={isLoading}
                            onChange={e => {
                              const newId = e.target.value
                              // Record feedback: what rank was selected
                              if (newId) {
                                const ranked = rankedRoster(dayDetailModal, row.location)
                                const selectedIdx = ranked.findIndex(p => p.id === newId)
                                facilityAPI.recordScheduleFeedback({
                                  rosterId: newId,
                                  shiftDate: dayDetailModal,
                                  facilityLocation: row.location,
                                  wasSuggested: selectedIdx >= 0,
                                  suggestionRank: selectedIdx >= 0 ? selectedIdx + 1 : null,
                                  wasSelected: true,
                                }).catch(() => {})
                              }
                              handleAssign(row.id, roomNum, newId)
                            }}
                            style={{ ...inputStyle, fontSize: 13, padding: '7px 10px', flex: 1 }}
                          >
                            <option value="">— Unassigned —</option>
                            {rankedRoster(dayDetailModal, row.location).map((p, pi) => {
                              const tags = p._rank.tags
                              // Disable anyone who can't actually be put here:
                              // already working elsewhere that day, or marked
                              // unavailable. The person currently in THIS room
                              // stays selectable (it's their own slot).
                              const elsewhere = _assignedToday[p.id] && p.id !== assignedRosterId
                              const offReason = _unavailToday.get(p.id)
                              const blocked = elsewhere || !!offReason
                              const reason = elsewhere
                                ? ` — at ${_assignedToday[p.id]}`
                                : offReason
                                  ? ` — ${offReason}`
                                  : ''
                              const tagStr = !blocked && tags.length > 0 ? ` · ${tags.join(', ')}` : ''
                              return (
                                <option key={p.id} value={p.id} disabled={blocked}>
                                  {blocked ? '🚫 ' : pi === 0 ? '⭐ ' : ''}{EMP_PREFIX[p.employmentCategory] || ''} {p.providerName}{reason}{tagStr}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      )
                    })}

                    {/* Supervising anesthesiologists (team model). Auto-computed
                        from the care-team build — 1 MD per supervisionRatio CRNAs. */}
                    {(supervisors.length > 0 || (row.supervisionRatio === 3 || row.supervisionRatio === 4)) && (
                      <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #CBD5E1' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Supervising anesthesiologists ({supervisors.length})
                          {row.supervisionRatio ? ` · 1:${row.supervisionRatio}` : ''}
                        </div>
                        {(() => {
                          // Editable supervisor slots: one selector per assigned
                          // supervising MD (change/remove), plus one empty slot to
                          // add another. Supervisors live at roomNumber >= 900 and
                          // carry role SUPERVISING_MD. Only anesthesiologists can
                          // supervise. Reuse an emptied slot's room before minting a
                          // new one so rooms don't accumulate.
                          const filledSups = assignments.filter(a => a.role === 'SUPERVISING_MD' && a.rosterId)
                          const allSupRooms = assignments.filter(a => a.role === 'SUPERVISING_MD').map(a => a.roomNumber)
                          const emptySup = assignments.find(a => a.role === 'SUPERVISING_MD' && !a.rosterId)
                          const addRoom = emptySup
                            ? emptySup.roomNumber
                            : (allSupRooms.length ? Math.max(...allSupRooms) + 1 : SUPERVISOR_ROOM_BASE)
                          const mds = rankedRoster(dayDetailModal, row.location).filter(p => p.providerType === 'ANESTHESIOLOGIST')
                          const slots = [
                            ...filledSups.map(s => ({ roomNumber: s.roomNumber, currentId: s.rosterId, existing: true })),
                            { roomNumber: addRoom, currentId: '', existing: false },
                          ]
                          if (mds.length === 0) {
                            return <div style={{ fontSize: 11, color: '#94A3B8' }}>No anesthesiologists on your roster to assign as supervisors.</div>
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {slots.map((slot) => {
                                const key = `${row.id}-${slot.roomNumber}`
                                const isLoading = assignLoading[key]
                                return (
                                  <select
                                    key={slot.roomNumber}
                                    value={slot.currentId}
                                    disabled={isLoading}
                                    onChange={(e) => handleAssign(row.id, slot.roomNumber, e.target.value, 'SUPERVISING_MD')}
                                    style={{ ...inputStyle, fontSize: 13, padding: '7px 10px', borderColor: slot.currentId ? '#DDD6FE' : '#FCA5A5' }}
                                  >
                                    <option value="">{slot.existing ? '— Remove supervisor —' : '+ Add supervising anesthesiologist'}</option>
                                    {mds.map((p) => {
                                      const elsewhere = _assignedToday[p.id] && p.id !== slot.currentId
                                      const offReason = _unavailToday.get(p.id)
                                      const blocked = elsewhere || !!offReason
                                      const reason = elsewhere ? ` — at ${_assignedToday[p.id]}` : offReason ? ` — ${offReason}` : ''
                                      return (
                                        <option key={p.id} value={p.id} disabled={blocked}>
                                          {blocked ? '🚫 ' : ''}{EMP_PREFIX[p.employmentCategory] || ''} {p.providerName}{reason}
                                        </option>
                                      )
                                    })}
                                  </select>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )
            }) })()
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={() => { setDayDetailModal(null); setAddLocModal({ dateStr: dayDetailModal }); setLocForm({ location: '', roomsRequired: 1 }) }}
              style={{ padding: '9px 18px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1D4ED8' }}
            >
              + Add Another Location
            </button>
          </div>
        </Modal>
      )}

      {/* Out-List Builder (release order for one site/day) */}
      {outListModal && (
        <OutListModal
          dayId={outListModal.dayId}
          title={outListModal.title}
          onClose={() => setOutListModal(null)}
          onSaved={load}
        />
      )}

      {/* Out-List Rules + one-click auto-build for the week/month */}
      {showOutListRules && (
        <OutListRulesModal
          year={year}
          month={month}
          monthName={monthName}
          onClose={() => setShowOutListRules(false)}
          onDone={load}
        />
      )}

      {/* Add Location Modal */}
      {addLocModal && (
        <Modal title={`Add Location — ${addLocModal.dateStr}`} onClose={() => setAddLocModal(null)}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Location Name</label>
            <input style={inputStyle} value={locForm.location} onChange={e => setLocForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. OR Suite 1, Cardiac OR" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rooms Required</label>
            <input style={inputStyle} type="number" min="1" max="20" value={locForm.roomsRequired} onChange={e => setLocForm(p => ({ ...p, roomsRequired: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setAddLocModal(null)} style={{ padding: '9px 18px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
            <button onClick={handleAddLocation} disabled={savingLoc} style={{ padding: '9px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: savingLoc ? 'not-allowed' : 'pointer', opacity: savingLoc ? 0.7 : 1 }}>
              {savingLoc ? 'Saving...' : 'Save Location'}
            </button>
          </div>
        </Modal>
      )}

      {/* Schedule Builder v2 — Build the Schedule flow */}
      {showBuildFlow && (
        <ScheduleBuildFlow
          year={year}
          month={month}
          industryRoomRate={facility?.industryRoomRatePerDay}
          onClose={() => setShowBuildFlow(false)}
          onSelected={({ run, message }) => {
            setShowBuildFlow(false)
            setSelectedRunId(run.id)
            setSelectedRunScore(run.staffiqScore)
            setSelectedRunRecs(run.staffiqRecommendations || null)
            setSelectedRunInsights(run.insights || null)
            setRescoreMessage({ kind: 'success', text: message || 'Schedule applied.' })
            // Reload the calendar to show the new assignments
            load()
          }}
        />
      )}
    </div>
  )
}
