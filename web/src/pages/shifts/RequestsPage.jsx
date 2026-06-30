import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { facilityAPI } from '../../api.js'

// Coordinator triage: calendar on the left, kanban board on the right.
// Click a day → its request cards appear in the Unassigned staging column.
// Drag cards into Locked / Strong / Moderate / Loose tier columns.
// Within a tier, drag to reorder. Save sends everything to the builder.

const TIERS = [
  { n: 1, label: 'Locked',   blurb: 'Honor unless impossible',   color: '#6D28D9', bg: '#F5F3FF', border: '#DDD6FE', light: '#EDE9FE' },
  { n: 2, label: 'Strong',   blurb: 'Honor if at all possible',  color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE', light: '#DBEAFE' },
  { n: 3, label: 'Moderate', blurb: "If it doesn't disrupt much",color: '#0E7490', bg: '#ECFEFF', border: '#A5F3FC', light: '#CFFAFE' },
  { n: 4, label: 'Loose',    blurb: 'Only if it costs nothing',  color: '#475569', bg: '#F8FAFC', border: '#E2E8F0', light: '#F1F5F9' },
]
const TIER_BY_N = Object.fromEntries(TIERS.map((t) => [t.n, t]))

const TYPE_STYLE = {
  DAY_OFF: { bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5', label: 'Day off' },
  WORK:    { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Wants to work' },
  PTO:     { bg: '#EEF2FF', color: '#4338CA', border: '#C7D2FE', label: 'PTO' },
}
const STATUS_STYLE = {
  PENDING:  { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  ACCEPTED: { bg: '#ECFDF5', color: '#047857', label: 'Accepted' },
  DECLINED: { bg: '#F1F5F9', color: '#64748B', label: 'Declined' },
}

function iso(d) { return String(d).slice(0, 10) }
function fmtDate(d) {
  return new Date(iso(d) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function dateLabel(r) {
  return r.endDate && iso(r.endDate) > iso(r.date)
    ? `${fmtDate(r.date)} – ${fmtDate(r.endDate)}`
    : fmtDate(r.date)
}
function seedSort(a, b) {
  const as = a.rosterEntry?.seniorityRank, bs = b.rosterEntry?.seniorityRank
  if (as != null || bs != null) return (as ?? 1e9) - (bs ?? 1e9)
  return new Date(a.createdAt) - new Date(b.createdAt)
}
// Does request r overlap date string dISO?
function requestCoversDay(r, dISO) {
  const start = iso(r.date)
  const end = r.endDate ? iso(r.endDate) : start
  return dISO >= start && dISO <= end
}

export default function RequestsPage() {
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [roster, setRoster]       = useState([])
  const [locations, setLocations] = useState([])
  const [work, setWork]           = useState([])
  const [tab, setTab]             = useState('BOARD')   // BOARD | HISTORY

  // Calendar state
  const now = new Date()
  const [calYear,  setCalYear]  = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())   // 0-indexed
  const [selDay,   setSelDay]   = useState(null)             // "2026-09-15" or null

  // Drag state
  const dragId  = useRef(null)
  const [dropTarget, setDropTarget] = useState(null)  // tier number or 'unassigned'

  const load = useCallback(() => {
    setLoading(true)
    facilityAPI.getScheduleRequests()
      .then((r) => setRequests(r.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const tierable = requests.filter(
      (r) => (r.type === 'WORK' || r.type === 'DAY_OFF') && r.status !== 'DECLINED'
    )
    const triaged   = tierable.filter((r) => r.status === 'ACCEPTED' && r.tier)
    const untriaged = tierable.filter((r) => !(r.status === 'ACCEPTED' && r.tier))
    const ordered   = []
    for (const t of TIERS) {
      triaged
        .filter((r) => r.tier === t.n)
        .sort((a, b) => {
          if (a.manualOrder != null || b.manualOrder != null) return (a.manualOrder ?? 1e9) - (b.manualOrder ?? 1e9)
          return seedSort(a, b)
        })
        .forEach((r) => ordered.push(r))
    }
    untriaged.sort(seedSort).forEach((r) => ordered.push(r))
    setWork(ordered.map((r) => ({
      ...r,
      _status: r.status === 'ACCEPTED' && r.tier ? 'ACCEPTED' : 'PENDING',
      _tier:   r.status === 'ACCEPTED' && r.tier ? r.tier : null,
    })))
    setSaved(false)
  }, [requests])

  const ptoPending = requests.filter((r) => r.type === 'PTO' && r.status === 'PENDING')

  const assignTier = (id, tier) => {
    setSaved(false)
    setWork((prev) => {
      const item = prev.find((w) => w.id === id)
      if (!item) return prev
      const arr  = prev.filter((w) => w.id !== id)
      const moved = { ...item, _status: 'ACCEPTED', _tier: tier }
      let insertAt = arr.length
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i]._status === 'ACCEPTED' && arr[i]._tier === tier) { insertAt = i + 1; break }
      }
      arr.splice(insertAt, 0, moved)
      return arr
    })
  }
  const unassign = (id) => {
    setSaved(false)
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'PENDING', _tier: null } : w))
  }
  const decline = (id) => {
    setSaved(false)
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'DECLINED', _tier: null } : w))
  }
  const restore = (id) => {
    setSaved(false)
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'PENDING', _tier: null } : w))
  }
  const moveInTier = (id, dir) => {
    setSaved(false)
    setWork((prev) => {
      const arr  = [...prev]
      const idx  = arr.findIndex((w) => w.id === id)
      if (idx < 0) return prev
      const tier = arr[idx]._tier
      const peers = arr.map((w, i) => ({ w, i })).filter((x) => x.w._status === 'ACCEPTED' && x.w._tier === tier).map((x) => x.i)
      const pos  = peers.indexOf(idx)
      const swap = dir === 'up' ? peers[pos - 1] : peers[pos + 1]
      if (swap == null) return prev
      ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
      return arr
    })
  }

  async function saveTriage() {
    setSaving(true)
    try {
      const counters = {}
      const items = work.map((w) => {
        let manualOrder = null
        if (w._status === 'ACCEPTED' && w._tier) {
          manualOrder = counters[w._tier] || 0
          counters[w._tier] = manualOrder + 1
        }
        return { id: w.id, status: w._status, tier: w._tier, manualOrder }
      })
      await facilityAPI.triageScheduleRequests(items)
      setSaved(true)
      load()
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function decidePto(id, decision) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await facilityAPI.decideScheduleRequest(id, decision)
      load()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  function openAdd() {
    setShowAdd(true)
    if (roster.length    === 0) facilityAPI.getRoster().then((r) => setRoster(Array.isArray(r) ? r : r?.roster || [])).catch(() => {})
    if (locations.length === 0) facilityAPI.getRosterLocations().then((r) => setLocations(r?.locations || [])).catch(() => {})
  }

  // ── Drag handlers ────────────────────────────────────────────────────────
  function onDragStart(e, id) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e, target) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }
  function onDragLeave() { setDropTarget(null) }
  function onDrop(e, target) {
    e.preventDefault()
    setDropTarget(null)
    const id = dragId.current
    if (!id) return
    if (target === 'unassigned') unassign(id)
    else assignTier(id, target)
    dragId.current = null
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const unassigned   = work.filter((w) => w._status === 'PENDING')
  const declined     = work.filter((w) => w._status === 'DECLINED')
  const tierGroups   = useMemo(
    () => TIERS.map((t) => ({ t, items: work.filter((w) => w._status === 'ACCEPTED' && w._tier === t.n) })),
    [work]
  )
  const pendingBadge = unassigned.length + ptoPending.length

  // Filter by selected day
  const filteredUnassigned = selDay
    ? unassigned.filter((r) => requestCoversDay(r, selDay))
    : unassigned
  const filteredTierGroups = selDay
    ? tierGroups.map(({ t, items }) => ({ t, items: items.filter((r) => requestCoversDay(r, selDay)) }))
    : tierGroups

  // ── Calendar data ────────────────────────────────────────────────────────
  const calDays = useMemo(() => {
    const days = []
    const first    = new Date(calYear, calMonth, 1)
    const startDow = first.getDay() // 0 = Sun
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    for (let i = 0; i < startDow; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const dISO = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dayReqs = work.filter((r) => requestCoversDay(r, dISO))
      const hasWork   = dayReqs.some((r) => r.type === 'WORK')
      const hasDayOff = dayReqs.some((r) => r.type === 'DAY_OFF')
      const hasPto    = ptoPending.some((r) => requestCoversDay(r, dISO))
      days.push({ d, dISO, hasWork, hasDayOff, hasPto, count: dayReqs.length + (hasPto ? 1 : 0) })
    }
    return days
  }, [calYear, calMonth, work, ptoPending])

  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#F8FAFC' }}>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 28px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#fff', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Provider Requests</h1>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 3 }}>
            Drag cards into priority tiers · the schedule builder honors them in order
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Tab toggle */}
          {[{ k: 'BOARD', label: `Board${pendingBadge ? ` · ${pendingBadge}` : ''}` }, { k: 'HISTORY', label: 'History' }].map(({ k, label }) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: tab === k ? '#0F172A' : '#fff', color: tab === k ? '#fff' : '#64748B', border: `1.5px solid ${tab === k ? '#0F172A' : '#E2E8F0'}` }}>
              {label}
            </button>
          ))}
          <button onClick={openAdd} style={{ padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add
          </button>
          {work.length > 0 && (
            <button onClick={saveTriage} disabled={saving} style={{ padding: '7px 18px', background: saved ? '#10B981' : '#6D28D9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, transition: 'background 0.3s' }}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save tiers'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 14 }}>
          Loading requests…
        </div>
      )}

      {/* ── BOARD ────────────────────────────────────────────────────────── */}
      {!loading && tab === 'BOARD' && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

          {/* Left: calendar + PTO */}
          <div style={{ width: 232, flexShrink: 0, borderRight: '1px solid #E2E8F0', background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

            {/* Mini calendar */}
            <div style={{ padding: '18px 16px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1); setSelDay(null) }}
                  style={{ width: 28, height: 28, border: 'none', background: '#F1F5F9', borderRadius: 7, cursor: 'pointer', fontSize: 14, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ‹
                </button>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{monthLabel}</span>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1); setSelDay(null) }}
                  style={{ width: 28, height: 28, border: 'none', background: '#F1F5F9', borderRadius: 7, cursor: 'pointer', fontSize: 14, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ›
                </button>
              </div>
              {/* Day-of-week headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
                {['S','M','T','W','T','F','S'].map((d, i) => (
                  <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94A3B8', padding: '2px 0' }}>{d}</div>
                ))}
              </div>
              {/* Day cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {calDays.map((day, i) => {
                  if (!day) return <div key={`empty-${i}`} />
                  const isSelected = selDay === day.dISO
                  const hasReqs    = day.count > 0
                  return (
                    <button
                      key={day.dISO}
                      onClick={() => setSelDay(isSelected ? null : day.dISO)}
                      style={{
                        position: 'relative', padding: '5px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: isSelected ? '#2563EB' : hasReqs ? '#EFF6FF' : 'transparent',
                        color: isSelected ? '#fff' : hasReqs ? '#1D4ED8' : '#374151',
                        fontSize: 12, fontWeight: hasReqs ? 700 : 400,
                        transition: 'background 0.15s',
                      }}
                    >
                      {day.d}
                      {hasReqs && !isSelected && (
                        <div style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, justifyContent: 'center' }}>
                          {day.hasWork   && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#10B981' }} />}
                          {day.hasDayOff && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#EF4444' }} />}
                          {day.hasPto    && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#6D28D9' }} />}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              {selDay && (
                <button onClick={() => setSelDay(null)} style={{ marginTop: 10, width: '100%', padding: '6px 0', background: '#F1F5F9', border: 'none', borderRadius: 7, fontSize: 12, color: '#64748B', fontWeight: 600, cursor: 'pointer' }}>
                  Show all days
                </button>
              )}
            </div>

            {/* Legend */}
            <div style={{ padding: '0 16px 12px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[['#10B981','Wants work'],['#EF4444','Day off'],['#6D28D9','PTO']].map(([c, l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                  <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>{l}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid #F1F5F9' }} />

            {/* PTO section */}
            {ptoPending.length > 0 && (
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#4338CA', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  PTO Pending ({ptoPending.length})
                </div>
                {ptoPending.map((r) => (
                  <div key={r.id} style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</div>
                    <div style={{ fontSize: 11, color: '#4338CA', marginTop: 2 }}>{dateLabel(r)}</div>
                    {r.note && <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, fontStyle: 'italic' }}>"{r.note}"</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => decidePto(r.id, 'accept')} disabled={busy[r.id]} style={{ flex: 1, padding: '5px 0', background: '#10B981', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Approve</button>
                      <button onClick={() => decidePto(r.id, 'decline')} disabled={busy[r.id]} style={{ flex: 1, padding: '5px 0', background: '#fff', color: '#B91C1C', border: '1.5px solid #FCA5A5', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {work.length === 0 && ptoPending.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                No requests yet.
              </div>
            )}
          </div>

          {/* Right: Kanban board */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

            {/* Day header bar */}
            {selDay && (
              <div style={{ padding: '10px 20px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: 13, fontWeight: 700, color: '#1D4ED8', flexShrink: 0 }}>
                {new Date(selDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {' · '}{(filteredUnassigned.length + filteredTierGroups.reduce((s, g) => s + g.items.length, 0))} request{filteredUnassigned.length + filteredTierGroups.reduce((s, g) => s + g.items.length, 0) !== 1 ? 's' : ''}
              </div>
            )}

            {/* Five columns */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 0, overflow: 'hidden' }}>

              {/* Unassigned column */}
              <KanbanColumn
                title="Unassigned"
                subtitle="Drag to a tier →"
                count={filteredUnassigned.length}
                color="#92400E"
                bg="#FFFBEB"
                border="#FDE68A"
                isDrop={dropTarget === 'unassigned'}
                onDragOver={(e) => onDragOver(e, 'unassigned')}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, 'unassigned')}
              >
                {filteredUnassigned.length === 0 && (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#D97706', fontSize: 12 }}>
                    {selDay ? 'No unassigned requests this day.' : 'All requests tiered.'}
                  </div>
                )}
                {filteredUnassigned.map((r) => (
                  <RequestCard
                    key={r.id} r={r}
                    onDragStart={(e) => onDragStart(e, r.id)}
                    onTier={(tier) => assignTier(r.id, tier)}
                    onDecline={() => decline(r.id)}
                  />
                ))}
                {/* Declined bin at bottom of unassigned */}
                {declined.length > 0 && !selDay && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Declined ({declined.length})</div>
                    {declined.map((r) => (
                      <RequestCard key={r.id} r={r} declined onDragStart={() => {}} onRestore={() => restore(r.id)} />
                    ))}
                  </div>
                )}
              </KanbanColumn>

              {/* Tier columns */}
              {filteredTierGroups.map(({ t, items }, gi) => (
                <KanbanColumn
                  key={t.n}
                  title={`${t.n} · ${t.label}`}
                  subtitle={t.blurb}
                  count={items.length}
                  color={t.color}
                  bg={t.bg}
                  border={t.border}
                  light={t.light}
                  isDrop={dropTarget === t.n}
                  onDragOver={(e) => onDragOver(e, t.n)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, t.n)}
                  isLast={gi === TIERS.length - 1}
                >
                  {items.length === 0 && (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: t.color, fontSize: 12, opacity: 0.5 }}>
                      Drop cards here
                    </div>
                  )}
                  {items.map((r, i) => (
                    <RequestCard
                      key={r.id} r={r} rank={i + 1}
                      onDragStart={(e) => onDragStart(e, r.id)}
                      onTier={(tier) => assignTier(r.id, tier)}
                      onDecline={() => decline(r.id)}
                      onUp={i > 0 ? () => moveInTier(r.id, 'up') : null}
                      onDown={i < items.length - 1 ? () => moveInTier(r.id, 'down') : null}
                      tierColor={t.color}
                    />
                  ))}
                </KanbanColumn>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ──────────────────────────────────────────────────────── */}
      {!loading && tab === 'HISTORY' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <HistoryList requests={requests} />
        </div>
      )}

      {showAdd && (
        <AddRequestModal
          roster={roster}
          locations={locations}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); setTab('BOARD'); load() }}
        />
      )}
    </div>
  )
}

// ── Kanban column ─────────────────────────────────────────────────────────────
function KanbanColumn({ title, subtitle, count, color, bg, border, light, isDrop, onDragOver, onDragLeave, onDrop, children, isLast }) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        borderRight: isLast ? 'none' : '1px solid #E2E8F0',
        minWidth: 0,
        transition: 'background 0.15s',
        background: isDrop ? (light || '#F0FDF4') : 'transparent',
      }}
    >
      {/* Column header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: `2px solid ${isDrop ? color : border}`, background: isDrop ? (light || bg) : bg, transition: 'all 0.15s', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {title}{count > 0 ? <span style={{ marginLeft: 6, background: color, color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10 }}>{count}</span> : null}
        </div>
        {subtitle && <div style={{ fontSize: 10.5, color, opacity: 0.65, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 20px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Request card ──────────────────────────────────────────────────────────────
function RequestCard({ r, rank, onDragStart, onTier, onDecline, onRestore, onUp, onDown, tierColor, declined }) {
  const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
  return (
    <div
      draggable={!declined}
      onDragStart={onDragStart}
      style={{
        background: '#fff',
        border: `1px solid ${declined ? '#E2E8F0' : '#E2E8F0'}`,
        borderLeft: `3px solid ${declined ? '#CBD5E1' : tierColor || t.color}`,
        borderRadius: 10,
        padding: '11px 12px',
        marginBottom: 7,
        cursor: declined ? 'default' : 'grab',
        opacity: declined ? 0.55 : 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        userSelect: 'none',
        transition: 'box-shadow 0.15s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          {rank != null && <span style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', marginRight: 5 }}>#{rank}</span>}
          <span style={{ fontWeight: 800, fontSize: 13, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
          {r.rosterEntry?.providerType && (
            <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 5 }}>{r.rosterEntry.providerType}</span>
          )}
        </div>
        <span style={{ flexShrink: 0, background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>
          {t.label}
        </span>
      </div>

      {/* Date + site */}
      <div style={{ fontSize: 12, color: '#374151', marginBottom: r.note ? 5 : 0 }}>
        {dateLabel(r)}
        {r.siteName && <span style={{ color: '#94A3B8' }}> · {r.siteName}</span>}
      </div>

      {/* Note */}
      {r.note && (
        <div style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic', background: '#F8FAFC', borderRadius: 6, padding: '4px 7px', marginBottom: 5 }}>
          "{r.note}"
        </div>
      )}

      {/* Actions */}
      {!declined ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
          {onUp && (
            <button onClick={onUp} title="Move up" style={miniBtn}>↑</button>
          )}
          {onDown && (
            <button onClick={onDown} title="Move down" style={miniBtn}>↓</button>
          )}
          {TIERS.map((tier) => {
            const active = r._tier === tier.n
            return (
              <button
                key={tier.n}
                title={`Tier ${tier.n} · ${tier.label}`}
                onClick={() => onTier(tier.n)}
                style={{
                  width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 800,
                  background: active ? tier.color : '#fff',
                  color: active ? '#fff' : tier.color,
                  border: `1.5px solid ${active ? tier.color : tier.border}`,
                }}
              >
                {tier.n}
              </button>
            )
          })}
          <button onClick={onDecline} title="Decline" style={{ ...miniBtn, color: '#B91C1C', borderColor: '#FCA5A5', marginLeft: 'auto' }}>✕</button>
        </div>
      ) : (
        <button onClick={onRestore} style={{ marginTop: 8, padding: '4px 10px', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          Restore
        </button>
      )}
    </div>
  )
}

const miniBtn = {
  width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
  background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0',
}

// ── History list ──────────────────────────────────────────────────────────────
function HistoryList({ requests }) {
  const visible = requests.filter((r) => r.status !== 'PENDING')
  if (visible.length === 0) return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '48px 24px', textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
      No accepted or declined requests yet.
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {visible.map((r) => {
        const t    = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
        const s    = STATUS_STYLE[r.status] || STATUS_STYLE.PENDING
        const tier = r.status === 'ACCEPTED' && r.tier ? TIER_BY_N[r.tier] : null
        return (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
              <Chip bg={t.bg} color={t.color} border={t.border}>{t.label}</Chip>
              <Chip bg={s.bg} color={s.color} border={s.bg}>{s.label}</Chip>
              {tier && <Chip bg={tier.bg} color={tier.color} border={tier.border}>Tier {tier.n} · {tier.label}</Chip>}
            </div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              {dateLabel(r)}
              {r.siteName && <span style={{ color: '#94A3B8' }}> · {r.siteName}</span>}
              {r.rosterEntry?.providerType && <span style={{ color: '#94A3B8' }}> · {r.rosterEntry.providerType}</span>}
            </div>
            {r.note && <div style={{ fontSize: 12, color: '#64748B', marginTop: 5, fontStyle: 'italic' }}>"{r.note}"</div>}
          </div>
        )
      })}
    </div>
  )
}

function Chip({ bg, color, border, children }) {
  return <span style={{ background: bg, color, border: `1px solid ${border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{children}</span>
}

// ── Add request modal ─────────────────────────────────────────────────────────
function AddRequestModal({ roster, locations, onClose, onCreated }) {
  const [form, setForm] = useState({ rosterEntryId: '', type: 'WORK', date: '', endDate: '', siteName: '', note: '', tier: 2 })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.rosterEntryId) return setErr('Pick a provider.')
    if (!form.date) return setErr('Pick a date.')
    setSaving(true); setErr(null)
    try {
      await facilityAPI.createFacilityScheduleRequest({
        rosterEntryId: form.rosterEntryId,
        type:          form.type,
        date:          form.date,
        endDate:       form.endDate || null,
        siteName:      form.type === 'WORK' ? form.siteName || null : null,
        note:          form.note || null,
        tier:          form.tier,
      })
      onCreated()
    } catch (e) {
      setErr(e.message || 'Failed to add request')
    } finally {
      setSaving(false)
    }
  }

  const lbl = { fontSize: 12.5, fontWeight: 700, color: '#475569', marginBottom: 5, display: 'block' }
  const inp = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1.5px solid #E2E8F0', fontSize: 14, color: '#0F172A', boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Add a request</div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 18 }}>Logged on the provider's behalf and pre-accepted at the tier you choose.</div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Provider</label>
          <select style={inp} value={form.rosterEntryId} onChange={(e) => set('rosterEntryId', e.target.value)}>
            <option value="">Select a provider…</option>
            {[...roster].sort((a, b) => (a.providerName || '').localeCompare(b.providerName || '')).map((r) => (
              <option key={r.id} value={r.id}>{r.providerName}{r.providerType ? ` · ${r.providerType}` : ''}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ k: 'WORK', l: 'Wants to work' }, { k: 'DAY_OFF', l: 'Wants off' }].map(({ k, l }) => {
              const active = form.type === k
              return (
                <button key={k} onClick={() => set('type', k)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: active ? '#2563EB' : '#fff', color: active ? '#fff' : '#475569', border: `1.5px solid ${active ? '#2563EB' : '#E2E8F0'}` }}>{l}</button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Date</label>
            <input type="date" style={inp} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>End date <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
            <input type="date" style={inp} value={form.endDate} min={form.date || undefined} onChange={(e) => set('endDate', e.target.value)} />
          </div>
        </div>

        {form.type === 'WORK' && (
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Site <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
            <input list="req-sites" style={inp} value={form.siteName} placeholder="Any site" onChange={(e) => set('siteName', e.target.value)} />
            <datalist id="req-sites">{locations.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Priority tier</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {TIERS.map((t) => {
              const active = form.tier === t.n
              return (
                <button key={t.n} title={t.blurb} onClick={() => set('tier', t.n)} style={{ flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 800, background: active ? t.color : '#fff', color: active ? '#fff' : t.color, border: `1.5px solid ${active ? t.color : t.border}` }}>
                  {t.n} {t.label}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 5 }}>{TIER_BY_N[form.tier]?.blurb}</div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={lbl}>Note <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
          <input style={inp} value={form.note} placeholder="e.g. Confirmed by phone" onChange={(e) => set('note', e.target.value)} />
        </div>

        {err && <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: '8px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Adding…' : 'Add request'}</button>
        </div>
      </div>
    </div>
  )
}
