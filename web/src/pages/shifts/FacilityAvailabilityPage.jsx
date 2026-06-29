import React, { useState, useEffect, useMemo } from 'react'
import { facilityAPI } from '../../api.js'

// ─── Badges (match InternalRosterPage palette) ────────────────────────────────
const TYPE_BADGE = {
  CRNA: { bg: '#EFF6FF', color: '#1D4ED8', label: 'CRNA' },
  ANESTHESIOLOGIST: { bg: '#F5F3FF', color: '#1E3A8A', label: 'MD' },
  ANESTHESIA_ASSISTANT: { bg: '#F0FDFA', color: '#0F766E', label: 'AA' },
  STAFF: { bg: '#F1F5F9', color: '#475569', label: 'Staff' },
}
const EMPLOY_BADGE = {
  FULL_TIME: { bg: '#F0FDF4', color: '#15803D', label: 'Full-time' },
  PER_DIEM: { bg: '#FEFCE8', color: '#A16207', label: 'Per-diem' },
  LOCUMS: { bg: '#FFF7ED', color: '#C2410C', label: 'Locums' },
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ─── Date helpers (all in local-time, no UTC drift) ───────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function ymd(year, month0, day) { return `${year}-${pad(month0 + 1)}-${pad(day)}` }
function monthKey(year, month0) { return `${year}-${pad(month0 + 1)}` }
function parseMonthKey(key) {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month0: m - 1 }
}
function todayYmd() {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}
function shiftMonth(key, delta) {
  const { year, month0 } = parseMonthKey(key)
  const d = new Date(year, month0 + delta, 1)
  return monthKey(d.getFullYear(), d.getMonth())
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC',
  boxSizing: 'border-box', outline: 'none',
}
const primaryBtnStyle = { padding: '10px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtnStyle = { padding: '9px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }

function Badge({ bg, color, label }) {
  return (
    <span style={{ background: bg, color, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, border: `1px solid ${color}33`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export default function FacilityAvailabilityPage({ onNavigate }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return monthKey(d.getFullYear(), d.getMonth())
  })
  const [data, setData] = useState(null) // { month, members, overrides }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Day editor (inline panel)
  const [editorDate, setEditorDate] = useState(null) // 'YYYY-MM-DD'
  const [editorMode, setEditorMode] = useState('available') // 'available' | 'unavailable' | 'pto'
  const [editorNote, setEditorNote] = useState('')
  const [savingDay, setSavingDay] = useState(false)

  // Range editor
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [rangeMode, setRangeMode] = useState('available') // 'available' | 'unavailable' | 'pto'
  const [rangeNote, setRangeNote] = useState('')
  const [savingRange, setSavingRange] = useState(false)
  const [copying, setCopying] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)

  const today = todayYmd()

  useEffect(() => { load() }, [month])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await facilityAPI.getRosterAvailability(month)
      setData(res)
      // Preserve selection if member still present; otherwise clear.
      if (selectedId && !(res.members || []).some((m) => m.rosterEntryId === selectedId)) {
        setSelectedId(null)
      }
    } catch (e) {
      setError(e.message || 'Failed to load availability.')
    } finally {
      setLoading(false)
    }
  }

  const members = data?.members || []
  const overrides = data?.overrides || {}

  const selectedMember = useMemo(
    () => members.find((m) => m.rosterEntryId === selectedId) || null,
    [members, selectedId]
  )

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => (m.name || '').toLowerCase().includes(q))
  }, [members, search])

  const { year, month0 } = parseMonthKey(month)

  // Effective availability for a member on a date: explicit override wins,
  // otherwise the member's default.
  function effectiveFor(member, dateStr) {
    const ov = overrides[member.rosterEntryId]?.[dateStr]
    if (ov) return { available: ov.available, source: ov.source, note: ov.note, override: true }
    return { available: member.defaultAvailable, source: 'DEFAULT', note: null, override: false }
  }

  function selectMember(id) {
    setSelectedId(id)
    setEditorDate(null)
    setActionMsg(null)
  }

  function changeMonth(delta) {
    setMonth((m) => shiftMonth(m, delta))
    setEditorDate(null)
    setActionMsg(null)
  }

  // ─── Day editor ─────────────────────────────────────────────────────────────
  function openDay(dateStr) {
    if (!selectedMember) return
    if (dateStr < today) return // don't edit the past
    const eff = effectiveFor(selectedMember, dateStr)
    setEditorDate(dateStr)
    setEditorMode(eff.source === 'PTO' ? 'pto' : (eff.available ? 'available' : 'unavailable'))
    setEditorNote(eff.note || '')
  }

  async function saveDay() {
    if (!selectedMember || !editorDate) return
    setSavingDay(true)
    setActionMsg(null)
    try {
      await facilityAPI.setRosterAvailability({
        rosterEntryId: selectedMember.rosterEntryId,
        date: editorDate,
        ...(editorMode === 'pto' ? { pto: true } : { available: editorMode === 'available' }),
        note: editorNote.trim() || null,
      })
      setEditorDate(null)
      await load()
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message || 'Save failed.' })
    } finally {
      setSavingDay(false)
    }
  }

  async function clearDay() {
    if (!selectedMember || !editorDate) return
    setSavingDay(true)
    setActionMsg(null)
    try {
      await facilityAPI.clearRosterAvailability({
        rosterEntryId: selectedMember.rosterEntryId,
        date: editorDate,
      })
      setEditorDate(null)
      await load()
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message || 'Clear failed.' })
    } finally {
      setSavingDay(false)
    }
  }

  // ─── Range editor ─────────────────────────────────────────────────────────
  async function saveRange() {
    if (!selectedMember) return
    if (!rangeStart || !rangeEnd) {
      setActionMsg({ type: 'error', text: 'Pick both a start and end date.' })
      return
    }
    if (rangeEnd < rangeStart) {
      setActionMsg({ type: 'error', text: 'End date must be on or after the start date.' })
      return
    }
    setSavingRange(true)
    setActionMsg(null)
    try {
      await facilityAPI.setRosterAvailabilityRange({
        rosterEntryId: selectedMember.rosterEntryId,
        startDate: rangeStart,
        endDate: rangeEnd,
        ...(rangeMode === 'pto' ? { pto: true } : { available: rangeMode === 'available' }),
        note: rangeNote.trim() || null,
      })
      setRangeStart('')
      setRangeEnd('')
      setRangeNote('')
      await load()
      setActionMsg({ type: 'ok', text: 'Date range updated.' })
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message || 'Range update failed.' })
    } finally {
      setSavingRange(false)
    }
  }

  async function copyLastMonth() {
    if (!selectedMember) return
    setCopying(true)
    setActionMsg(null)
    try {
      const res = await facilityAPI.copyRosterAvailabilityMonth({
        rosterEntryId: selectedMember.rosterEntryId,
        fromMonth: shiftMonth(month, -1),
        toMonth: month,
      })
      await load()
      const n = res?.copied
      setActionMsg({ type: 'ok', text: n != null ? `Copied ${n} day${n !== 1 ? 's' : ''} from last month.` : 'Copied last month.' })
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message || 'Copy failed.' })
    } finally {
      setCopying(false)
    }
  }

  // ─── Calendar grid for the selected member ──────────────────────────────────
  const calendarCells = useMemo(() => {
    const firstDow = new Date(year, month0, 1).getDay() // 0=Sun
    const daysInMonth = new Date(year, month0 + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }, [year, month0])

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1240, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Availability</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, maxWidth: 760 }}>
          Set who can work each day this month — it feeds the schedule builder. Full-time providers are available unless marked off; per-diem/locums must be marked available.
        </p>
      </div>

      {/* Month selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => changeMonth(-1)} style={{ ...ghostBtnStyle, padding: '8px 14px', fontSize: 16, lineHeight: 1 }} title="Previous month">‹</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', minWidth: 170, textAlign: 'center' }}>
          {MONTH_NAMES[month0]} {year}
        </div>
        <button onClick={() => changeMonth(1)} style={{ ...ghostBtnStyle, padding: '8px 14px', fontSize: 16, lineHeight: 1 }} title="Next month">›</button>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px', color: '#DC2626', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 15 }}>Loading availability…</div>}

      {!loading && !error && members.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>No providers to schedule yet.</div>
          <div style={{ fontSize: 14, color: '#64748B' }}>Add providers to your roster first, then come back to set their availability.</div>
        </div>
      )}

      {!loading && !error && members.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'start' }}>
          {/* LEFT — member list */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <div style={{ padding: 14, borderBottom: '1px solid #F1F5F9' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search providers…"
                style={inputStyle}
              />
            </div>
            <div style={{ maxHeight: 620, overflowY: 'auto' }}>
              {filteredMembers.length === 0 && (
                <div style={{ padding: '24px 16px', fontSize: 13, color: '#94A3B8', textAlign: 'center' }}>No providers match “{search}”.</div>
              )}
              {filteredMembers.map((m) => {
                const tb = TYPE_BADGE[m.providerType] || TYPE_BADGE.STAFF
                const eb = EMPLOY_BADGE[m.employmentCategory] || EMPLOY_BADGE.FULL_TIME
                const isSel = m.rosterEntryId === selectedId
                return (
                  <button
                    key={m.rosterEntryId}
                    onClick={() => selectMember(m.rosterEntryId)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                      padding: '12px 16px', border: 'none', borderBottom: '1px solid #F1F5F9',
                      borderLeft: isSel ? '3px solid #2563EB' : '3px solid transparent',
                      background: isSel ? '#EFF6FF' : '#fff',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>{m.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge bg={tb.bg} color={tb.color} label={tb.label} />
                      <Badge bg={eb.bg} color={eb.color} label={eb.label} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* RIGHT — calendar + actions for the selected member */}
          <div>
            {!selectedMember ? (
              <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '80px 40px', textAlign: 'center', color: '#64748B' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👈</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>Select a provider to set their availability.</div>
              </div>
            ) : (
              <>
                {/* Selected-member header + quick actions */}
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '18px 22px', marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{selectedMember.name}</div>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                        Default this month: {selectedMember.defaultAvailable
                          ? <strong style={{ color: '#15803D' }}>Available</strong>
                          : <strong style={{ color: '#B91C1C' }}>Unavailable</strong>}
                        {' · '}{(EMPLOY_BADGE[selectedMember.employmentCategory] || EMPLOY_BADGE.FULL_TIME).label}
                      </div>
                    </div>
                    <button onClick={copyLastMonth} disabled={copying} style={{ ...ghostBtnStyle, opacity: copying ? 0.6 : 1, cursor: copying ? 'default' : 'pointer' }}>
                      {copying ? 'Copying…' : '↩ Copy last month'}
                    </button>
                  </div>

                  {/* Range editor */}
                  <div style={{ borderTop: '1px solid #F1F5F9', marginTop: 16, paddingTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Mark date range</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>From</label>
                        <input type="date" min={today} value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>To</label>
                        <input type="date" min={rangeStart || today} value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>State</label>
                        <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                          <option value="available">Available</option>
                          <option value="unavailable">Unavailable</option>
                          <option value="pto">PTO (time off)</option>
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Note (optional)</label>
                        <input value={rangeNote} onChange={(e) => setRangeNote(e.target.value)} placeholder="e.g. Vacation" style={inputStyle} />
                      </div>
                      <button onClick={saveRange} disabled={savingRange} style={{ ...primaryBtnStyle, opacity: savingRange ? 0.6 : 1, cursor: savingRange ? 'default' : 'pointer' }}>
                        {savingRange ? 'Applying…' : 'Apply'}
                      </button>
                    </div>
                  </div>

                  {actionMsg && (
                    <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: actionMsg.type === 'error' ? '#DC2626' : '#15803D' }}>
                      {actionMsg.text}
                    </div>
                  )}
                </div>

                {/* Calendar */}
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '20px 22px' }}>
                  {/* Month nav — also on the calendar so you don't scroll up */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
                    <button
                      onClick={() => changeMonth(-1)}
                      style={{ width: 36, height: 36, border: '1.5px solid #E2E8F0', borderRadius: 9, background: '#F8FAFC', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontWeight: 700 }}
                      title="Previous month"
                    >‹</button>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', minWidth: 160, textAlign: 'center' }}>
                      {MONTH_NAMES[month0]} {year}
                    </div>
                    <button
                      onClick={() => changeMonth(1)}
                      style={{ width: 36, height: 36, border: '1.5px solid #E2E8F0', borderRadius: 9, background: '#F8FAFC', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontWeight: 700 }}
                      title="Next month"
                    >›</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
                    {WEEKDAY_LABELS.map((d, i) => (
                      <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>{d}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                    {calendarCells.map((day, idx) => {
                      if (day == null) return <div key={`blank-${idx}`} />
                      const dateStr = ymd(year, month0, day)
                      const eff = effectiveFor(selectedMember, dateStr)
                      const isPast = dateStr < today
                      const isOpen = editorDate === dateStr
                      // Colors: green = available, red = unavailable (including the
                      // per-diem/locums DEFAULT-unavailable, so it reads clearly at a
                      // glance). The override dot below still distinguishes explicit
                      // marks from the default.
                      const bg = eff.available ? '#F0FDF4' : '#FEF2F2'
                      const border = isOpen ? '#2563EB' : (eff.available ? '#BBF7D0' : '#FECACA')
                      const txt = eff.available ? '#15803D' : '#B91C1C'
                      // Source dot: PROVIDER (blue) vs ADMIN (amber) — colors kept
                      // far apart for at-a-glance distinction. PTO gets a corner
                      // "PTO" label instead of a dot (below).
                      const dotColor = eff.source === 'PROVIDER' ? '#2563EB'
                        : eff.source === 'ADMIN' ? '#D97706'
                        : null
                      return (
                        <button
                          key={dateStr}
                          onClick={() => openDay(dateStr)}
                          disabled={isPast}
                          title={isPast ? 'In the past' : `${eff.available ? 'Available' : 'Unavailable'}${eff.override ? ` · ${eff.source}` : ' · default'}${eff.note ? ` · ${eff.note}` : ''}`}
                          style={{
                            position: 'relative', aspectRatio: '1 / 1', borderRadius: 9,
                            background: isPast ? '#FAFAFA' : bg,
                            border: `1.5px solid ${border}`,
                            cursor: isPast ? 'default' : 'pointer',
                            opacity: isPast ? 0.5 : 1,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                            padding: 4,
                          }}
                        >
                          {/* PTO gets a clear corner label, not just a dot */}
                          {eff.source === 'PTO' && (
                            <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 8, fontWeight: 800, letterSpacing: '0.02em', color: isPast ? '#CBD5E1' : '#B91C1C' }}>PTO</span>
                          )}
                          <span style={{ fontSize: 14, fontWeight: 700, color: isPast ? '#CBD5E1' : txt }}>{day}</span>
                          {/* Source dot: provider (blue) / admin (amber) */}
                          {eff.override && dotColor && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Inline day editor */}
                  {editorDate && (() => {
                    const eff = effectiveFor(selectedMember, editorDate)
                    return (
                      <div style={{ marginTop: 18, borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                            {(() => {
                              const { year: ey, month0: em } = parseMonthKey(editorDate.slice(0, 7))
                              return `${MONTH_NAMES[em]} ${Number(editorDate.slice(8))}, ${ey}`
                            })()}
                          </div>
                          <button onClick={() => setEditorDate(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94A3B8', lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                          <button
                            onClick={() => setEditorMode('available')}
                            style={{ flex: 1, padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${editorMode === 'available' ? '#15803D' : '#E2E8F0'}`, background: editorMode === 'available' ? '#F0FDF4' : '#fff', color: editorMode === 'available' ? '#15803D' : '#64748B' }}
                          >
                            ✓ Available
                          </button>
                          <button
                            onClick={() => setEditorMode('unavailable')}
                            style={{ flex: 1, padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${editorMode === 'unavailable' ? '#B91C1C' : '#E2E8F0'}`, background: editorMode === 'unavailable' ? '#FEF2F2' : '#fff', color: editorMode === 'unavailable' ? '#B91C1C' : '#64748B' }}
                          >
                            ✕ Unavailable
                          </button>
                          <button
                            onClick={() => setEditorMode('pto')}
                            style={{ flex: 1, padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${editorMode === 'pto' ? '#B45309' : '#E2E8F0'}`, background: editorMode === 'pto' ? '#FFFBEB' : '#fff', color: editorMode === 'pto' ? '#B45309' : '#64748B' }}
                          >
                            🌴 PTO
                          </button>
                        </div>
                        <input
                          value={editorNote}
                          onChange={(e) => setEditorNote(e.target.value)}
                          placeholder="Note (optional)"
                          style={{ ...inputStyle, marginBottom: 12 }}
                        />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button onClick={saveDay} disabled={savingDay} style={{ ...primaryBtnStyle, opacity: savingDay ? 0.6 : 1, cursor: savingDay ? 'default' : 'pointer' }}>
                            {savingDay ? 'Saving…' : 'Save'}
                          </button>
                          {/* Clear is meaningful for anything the admin set (incl. PTO). */}
                          {eff.override && (eff.source === 'ADMIN' || eff.source === 'PTO') && (
                            <button onClick={clearDay} disabled={savingDay} style={ghostBtnStyle}>
                              Clear (use default)
                            </button>
                          )}
                          {eff.override && eff.source === 'PROVIDER' && (
                            <span style={{ fontSize: 12, color: '#64748B' }}>
                              Provider-submitted — saving overrides it.
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </>
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginTop: 16, padding: '12px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: 12, color: '#475569' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: '#F0FDF4', border: '1.5px solid #BBF7D0' }} /> Available</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 4, background: '#FEF2F2', border: '1.5px solid #FECACA' }} /> Unavailable</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563EB' }} /> Provider-set</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706' }} /> Admin-set</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 9, fontWeight: 800, color: '#B91C1C' }}>PTO</span> Time off</span>
              <span style={{ color: '#94A3B8' }}>Full-time = available by default; per-diem/locums = unavailable by default.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
