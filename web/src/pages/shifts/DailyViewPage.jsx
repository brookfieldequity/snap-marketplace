import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

// "Where is everyone today" — a read-focused daily lens across ALL sites for a
// single date, reusing the month schedule data. Coordinator picks/navigates a
// day; each site shows its rooms + assigned providers + roles + supervising MDs.

const EMP_PREFIX = { FULL_TIME: '🔵', PER_DIEM: '🔵', LOCUMS: '🟠' }
const ROLE_TAG = {
  CRNA_ROOM: { text: 'CRNA', bg: '#EFF6FF', color: '#1D4ED8' },
  SOLO_MD_ROOM: { text: 'Solo MD', bg: '#F5F3FF', color: '#1E3A8A' },
}
function coverageLabel(ratio) {
  if (ratio === 0) return { text: 'MD only', bg: '#F5F3FF', color: '#1E3A8A' }
  if (ratio === 3) return { text: 'Team 1:3', bg: '#ECFDF5', color: '#059669' }
  if (ratio === 4) return { text: 'Team 1:4', bg: '#ECFDF5', color: '#059669' }
  return null
}

// Order a day's staffed assignments for release (index 0 = leaves first),
// mirroring the backend's orderForRelease: honor outRank, then fall back to
// role (CRNA → solo MD → supervisor) and room number.
function rolePriority(a) {
  if (a.role === 'SUPERVISING_MD' || a.roomNumber >= 900) return 3
  if (a.role === 'SOLO_MD_ROOM') return 2
  if (a.role === 'CRNA_ROOM') return 1
  return 1.5
}
function orderForRelease(assignments) {
  return [...assignments].sort((a, b) => {
    const ar = a.outRank, br = b.outRank
    if (ar != null && br != null && ar !== br) return ar - br
    if (ar != null && br == null) return -1
    if (ar == null && br != null) return 1
    const pa = rolePriority(a), pb = rolePriority(b)
    if (pa !== pb) return pa - pb
    return a.roomNumber - b.roomNumber
  })
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shiftISO(iso, delta) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const inputStyle = { padding: '9px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#fff', boxSizing: 'border-box' }

function Badge({ bg, color, text }) {
  return <span style={{ background: bg, color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${color}33` }}>{text}</span>
}

function Stat({ label, value, color = '#0F172A' }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '10px 16px', minWidth: 78, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

// Ryan (7/29): list anesthesiologists and CRNAs SEPARATELY — no "Room 1/2/3"
// labels — so how many rooms are running reads at a glance regardless of
// coverage model. Dot colors are STRICTLY MD vs CRNA, no other differentiation.
const MD_DOT = '#6D28D9'
const CRNA_DOT = '#2563EB'

function ProviderLine({ a, dot, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>
        {EMP_PREFIX[a.rosterEntry?.employmentCategory] || ''} {a.rosterEntry?.providerName || 'Provider'}
      </span>
      {note && <span style={{ fontSize: 10.5, color: '#94A3B8' }}>{note}</span>}
    </div>
  )
}

function LocationCard({ row }) {
  const assignments = (row.assignments || []).filter((a) => a.rosterId)
  const cov = coverageLabel(row.supervisionRatio)
  const roomCount = row.roomsRequired || 0
  const roomAssignments = assignments.filter((a) => a.role !== 'SUPERVISING_MD' && a.role !== 'NON_CLINICAL' && a.roomNumber < 900)
  const filled = roomAssignments.length
  const unfilled = Math.max(0, roomCount - filled)

  // Split strictly by provider type. Supervising MDs fold into the MD list
  // (with a note) — one list per discipline, not per role.
  const isMd = (a) => a.rosterEntry?.providerType === 'ANESTHESIOLOGIST' || a.role === 'SUPERVISING_MD' || a.role === 'SOLO_MD_ROOM'
  const mds = assignments.filter((a) => a.role !== 'NON_CLINICAL' && isMd(a))
  const crnas = assignments.filter((a) => a.role !== 'NON_CLINICAL' && !isMd(a))
  const nonClinical = assignments.filter((a) => a.role === 'NON_CLINICAL')

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', flex: 1 }}>{row.location}</div>
        {cov && <Badge {...cov} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: filled >= roomCount ? '#16A34A' : '#DC2626' }}>{filled}/{roomCount} rooms</span>
      </div>

      <div style={{ display: 'flex', gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: MD_DOT, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Anesthesiologists ({mds.length})
          </div>
          {mds.length === 0 ? <div style={{ fontSize: 12, color: '#CBD5E1' }}>—</div>
            : mds.map((a) => <ProviderLine key={a.id || a.roomNumber} a={a} dot={MD_DOT} note={a.role === 'SUPERVISING_MD' ? 'supervising' : null} />)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: CRNA_DOT, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            CRNAs ({crnas.length})
          </div>
          {crnas.length === 0 ? <div style={{ fontSize: 12, color: '#CBD5E1' }}>—</div>
            : crnas.map((a) => <ProviderLine key={a.id || a.roomNumber} a={a} dot={CRNA_DOT} />)}
        </div>
      </div>

      {unfilled > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444', fontWeight: 700 }}>⬜ {unfilled} room{unfilled === 1 ? '' : 's'} unfilled</div>
      )}

      {nonClinical.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E2E8F0' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Non-clinical ({nonClinical.length})
          </div>
          {nonClinical.map((a) => <ProviderLine key={a.id || a.roomNumber} a={a} dot="#94A3B8" />)}
        </div>
      )}

      {row.outListPublishedAt && (() => {
        const release = orderForRelease(assignments.filter((a) => a.rosterId))
        if (release.length === 0) return null
        return (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              🚪 Release order
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {release.map((a, i) => {
                const isLast = i === release.length - 1
                const isSup = a.role === 'SUPERVISING_MD' || a.roomNumber >= 900
                return (
                  <div key={a.id || a.roomNumber} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: isLast ? '#0F172A' : '#2563EB', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 12.5, color: '#0F172A', fontWeight: 600 }}>
                      {EMP_PREFIX[a.rosterEntry?.employmentCategory] || ''} {a.rosterEntry?.providerName || 'Provider'}
                    </span>
                    {isSup && <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Supervisor</span>}
                    {isLast && <span style={{ fontSize: 10, fontWeight: 700, color: '#0F172A' }}>closes 🔒</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

    </div>
  )
}

export default function DailyViewPage({ onNavigate }) {
  const [dateStr, setDateStr] = useState(todayISO())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const year = parseInt(dateStr.slice(0, 4), 10)
  const month = parseInt(dateStr.slice(5, 7), 10)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    facilityAPI.getScheduleMonth(year, month)
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, month])

  const days = data ? (Array.isArray(data) ? data : data.days || []) : []
  const dayRows = days
    .filter((d) => (d.date ? d.date.slice(0, 10) : '') === dateStr)
    .sort((a, b) => (a.location || '').localeCompare(b.location || ''))

  let totalRooms = 0, filled = 0
  dayRows.forEach((row) => {
    totalRooms += row.roomsRequired || 0
    ;(row.assignments || []).forEach((a) => {
      if (a.rosterId && a.role !== 'SUPERVISING_MD' && a.roomNumber < 900) filled += 1
    })
  })
  const gaps = Math.max(0, totalRooms - filled)
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const navBtn = { padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setDateStr(shiftISO(dateStr, -1))} style={navBtn}>‹</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', minWidth: 270, textAlign: 'center' }}>{label}</div>
          <button onClick={() => setDateStr(shiftISO(dateStr, 1))} style={navBtn}>›</button>
          <input type="date" value={dateStr} onChange={(e) => e.target.value && setDateStr(e.target.value)} style={inputStyle} />
          <button onClick={() => setDateStr(todayISO())} style={{ padding: '9px 16px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#1D4ED8' }}>Today</button>
        </div>
        <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <Stat label="Sites" value={dayRows.length} />
          <Stat label="Rooms" value={totalRooms} />
          <Stat label="Filled" value={filled} color="#10B981" />
          <Stat label="Gaps" value={gaps} color={gaps > 0 ? '#EF4444' : '#10B981'} />
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 15 }}>Loading…</div>}

      {!loading && dayRows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '70px 40px', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🗓️</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>Nothing scheduled for this day.</div>
          <button onClick={() => onNavigate && onNavigate('schedule')} style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Open Schedule Builder</button>
        </div>
      )}

      {!loading && dayRows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {dayRows.map((row) => <LocationCard key={row.id} row={row} />)}
        </div>
      )}
    </div>
  )
}
