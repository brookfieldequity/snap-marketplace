import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { facilityAPI } from '../../api.js'
import useIsNarrow from '../../lib/useIsNarrow.js'

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

// Deterministic tiny tilt from an id so the sticky board feels physical but
// never jumps between renders.
function tiltFor(seed) {
  const s = String(seed)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((h % 5) - 2) // -2..+2 degrees
}

// Post-it paper color for a request card. Tiered cards take their tier hue;
// untriaged cards are warm yellow; declined cards fade to gray.
const TIER_PAPER = { 1: '#E9D5FF', 2: '#BFDBFE', 3: '#A5F3FC', 4: '#E2E8F0' }
function paperFor(r, declined) {
  if (declined) return '#E5E7EB'
  if (r._tier) return TIER_PAPER[r._tier] || '#FEF08A'
  return '#FEF08A' // unassigned → classic yellow sticky
}

export default function RequestsPage() {
  // Two responsive modes on top of desktop:
  //  narrow  (<860px): tier columns become a horizontal swipe strip
  //  stacked (<620px): additionally, the calendar panel stacks above the board
  // Between 620–859 (iPad portrait), the calendar panel stays fixed on the
  // left — always on screen — while only the strip swipes.
  const narrow = useIsNarrow()
  const stacked = useIsNarrow(620)
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [dirty, setDirty]         = useState(false) // unsaved tier edits — blocks auto-update reload
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

  // Drag state (desktop HTML5 DnD)
  const dragId  = useRef(null)
  const [dropTarget, setDropTarget] = useState(null)  // tier number or 'unassigned'

  // Touch drag state (tablets/phones — HTML5 drag events never fire on touch).
  // Long-press lifts the sticky note so it doesn't fight with scroll gestures.
  const touchTimer = useRef(null)
  const touchData  = useRef(null) // { id, x, y } at touchstart
  const [touchDragId, setTouchDragId] = useState(null)
  const ghostRef = useRef(null)   // floating sticky that follows the finger
  const stripRef = useRef(null)   // the columns container (for edge auto-scroll)

  const load = useCallback(() => {
    setLoading(true)
    facilityAPI.getScheduleRequests()
      .then((r) => setRequests(r.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  // Provider availability notes for the shown month (admin overrides, PTO
  // reasons, app + tokenized-link self-submissions). Formerly its own
  // "Requests & Notes" page — now folded into this board.
  const [notes, setNotes] = useState([])
  useEffect(() => {
    const mk = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`
    facilityAPI.getRosterAvailability(mk)
      .then((res) => {
        const nameById = {}
        for (const m of res.members || []) nameById[m.rosterEntryId] = m.name
        const out = []
        for (const [rid, byDate] of Object.entries(res.overrides || {})) {
          for (const [date, ov] of Object.entries(byDate)) {
            if (ov && ov.note) out.push({ rid, name: nameById[rid] || 'Provider', date, available: ov.available, source: ov.source, note: ov.note })
          }
        }
        out.sort((a, b) => a.date.localeCompare(b.date))
        setNotes(out)
      })
      .catch(() => setNotes([]))
  }, [calYear, calMonth])

  // Tell the auto-updater not to reload over un-saved tier arrangements.
  useEffect(() => {
    window.__snapDirty = dirty
    return () => { window.__snapDirty = false }
  }, [dirty])

  // Handwriting font + sticky-note "deal out" animation (loaded once).
  useEffect(() => {
    if (!document.getElementById('snap-kalam-font')) {
      const link = document.createElement('link')
      link.id = 'snap-kalam-font'
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap'
      document.head.appendChild(link)
    }
    if (!document.getElementById('snap-postit-kf')) {
      const style = document.createElement('style')
      style.id = 'snap-postit-kf'
      style.textContent = `@keyframes postitDeal{0%{transform:translateY(10px) rotate(0deg);opacity:0}100%{opacity:1}}`
      document.head.appendChild(style)
    }
  }, [])

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
    setDirty(false) // freshly (re)loaded from server — nothing unsaved
  }, [requests])

  const ptoPending = requests.filter((r) => r.type === 'PTO' && r.status === 'PENDING')

  // Every board edit clears the saved state and flags unsaved work.
  const markEdited = () => { setSaved(false); setDirty(true) }

  const assignTier = (id, tier) => {
    markEdited()
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
    markEdited()
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'PENDING', _tier: null } : w))
  }
  const decline = (id) => {
    markEdited()
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'DECLINED', _tier: null } : w))
  }
  const restore = (id) => {
    markEdited()
    setWork((prev) => prev.map((w) => w.id === id ? { ...w, _status: 'PENDING', _tier: null } : w))
  }
  const moveInTier = (id, dir) => {
    markEdited()
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
      setDirty(false)
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

  // ── Touch drag handlers ──────────────────────────────────────────────────
  // Press-and-hold (~300ms) lifts a card; a quick swipe still scrolls.
  function onCardTouchStart(e, id) {
    if (e.target.closest('button')) return // taps on tier/decline buttons stay taps
    const t = e.touches[0]
    touchData.current = { id, x: t.clientX, y: t.clientY }
    clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => {
      setTouchDragId(id)
      if (navigator.vibrate) navigator.vibrate(15) // small haptic "lift" cue
    }, 300)
  }
  function onCardTouchMove(e) {
    if (touchDragId || !touchData.current) return
    const t = e.touches[0]
    // Finger moved before the hold completed → it's a scroll, not a lift.
    if (Math.abs(t.clientX - touchData.current.x) > 10 || Math.abs(t.clientY - touchData.current.y) > 10) {
      clearTimeout(touchTimer.current)
    }
  }
  function onCardTouchEnd() {
    clearTimeout(touchTimer.current)
  }
  useEffect(() => () => clearTimeout(touchTimer.current), [])

  // While a card is lifted: follow the finger, highlight the column under it,
  // auto-scroll the strip near the edges, and drop on release.
  useEffect(() => {
    if (!touchDragId) return
    const targetUnder = (x, y) => {
      const el = document.elementFromPoint(x, y)
      const col = el && el.closest('[data-drop]')
      if (!col) return null
      return col.dataset.drop === 'unassigned' ? 'unassigned' : Number(col.dataset.drop)
    }
    // Scroll the strip when the finger is near its edges. Zones are measured
    // against the strip's own rect (not the window) and are generous (90px)
    // so iPad-sized screens catch them reliably.
    const edgeScroll = (x) => {
      const strip = stripRef.current
      if (!strip || strip.scrollWidth <= strip.clientWidth) return false
      const r = strip.getBoundingClientRect()
      if (x > r.right - 90) { strip.scrollLeft += 14; return true }
      if (x < r.left + 90) { strip.scrollLeft -= 14; return true }
      return false
    }
    let last = null // latest finger position — drives the rAF auto-scroll loop
    const move = (e) => {
      e.preventDefault() // keep the page/strip from scrolling under the drag
      const t = e.touches[0]
      last = { x: t.clientX, y: t.clientY }
      if (ghostRef.current) {
        ghostRef.current.style.left = t.clientX + 'px'
        ghostRef.current.style.top = t.clientY + 'px'
      }
      edgeScroll(t.clientX) // nudge immediately on movement too
      setDropTarget(targetUnder(t.clientX, t.clientY))
    }
    // Holding the note near an edge keeps scrolling even if the finger doesn't
    // move (touchmove alone only fires on movement).
    let raf
    const autoScroll = () => {
      if (last && edgeScroll(last.x)) {
        setDropTarget(targetUnder(last.x, last.y)) // content shifted under the finger
      }
      raf = requestAnimationFrame(autoScroll)
    }
    raf = requestAnimationFrame(autoScroll)
    const finish = (e) => {
      const t = e.changedTouches[0]
      const target = t ? targetUnder(t.clientX, t.clientY) : null
      const item = work.find((w) => w.id === touchDragId)
      if (target != null && item) {
        if (target === 'unassigned') {
          if (item._status !== 'PENDING') unassign(touchDragId)
        } else if (item._tier !== target) {
          assignTier(touchDragId, target)
        }
      }
      setTouchDragId(null)
      setDropTarget(null)
      touchData.current = null
    }
    const cancel = () => {
      setTouchDragId(null)
      setDropTarget(null)
      touchData.current = null
    }
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', finish)
    document.addEventListener('touchcancel', cancel)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', finish)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [touchDragId, work]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ─────────────────────────────────────────────────────────
  // The board shows ONLY requests that touch the month on the calendar —
  // navigate the calendar to see other months. (Saving still sends every
  // request, so off-month tiers are never lost.)
  const mm = String(calMonth + 1).padStart(2, '0')
  const monthStartISO = `${calYear}-${mm}-01`
  const monthEndISO = calMonth === 11
    ? `${calYear + 1}-01-01`
    : `${calYear}-${String(calMonth + 2).padStart(2, '0')}-01`
  const inShownMonth = (r) => {
    const start = iso(r.date)
    const end = r.endDate ? iso(r.endDate) : start
    return start < monthEndISO && end >= monthStartISO
  }

  const unassigned   = work.filter((w) => w._status === 'PENDING' && inShownMonth(w))
  const declined     = work.filter((w) => w._status === 'DECLINED' && inShownMonth(w))
  const tierGroups   = useMemo(
    () => TIERS.map((t) => ({ t, items: work.filter((w) => w._status === 'ACCEPTED' && w._tier === t.n && inShownMonth(w)) })),
    [work, monthStartISO, monthEndISO] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const pendingBadge = unassigned.length + ptoPending.length
  const touchDragItem = touchDragId ? work.find((w) => w.id === touchDragId) : null

  // Filter by selected day
  const filteredUnassigned = selDay
    ? unassigned.filter((r) => requestCoversDay(r, selDay))
    : unassigned
  const filteredTierGroups = selDay
    ? tierGroups.map(({ t, items }) => ({ t, items: items.filter((r) => requestCoversDay(r, selDay)) }))
    : tierGroups
  const visibleNotes = selDay ? notes.filter((n) => n.date === selDay) : notes

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
    <div style={{ display: 'flex', flexDirection: 'column', height: stacked ? 'auto' : '100%', minHeight: stacked ? '100%' : 0, background: '#F8FAFC' }}>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{ padding: narrow ? '14px 16px 12px' : '20px 28px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: narrow ? 19 : 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Provider Requests</h1>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 3 }}>
            {narrow
              ? 'Press and hold a sticky note to drag it into a tier'
              : 'Drag cards into priority tiers · the schedule builder honors them in order'}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: stacked ? 'column' : 'row', minHeight: 0, overflow: stacked ? 'visible' : 'hidden' }}>

          {/* Left: calendar + PTO + notes. Phones stack it above the board;
              iPad/desktop keep it as a fixed left column that never moves when
              the tier strip swipes. Content capped so the calendar stays mini. */}
          <div style={{ width: stacked ? '100%' : (narrow ? 264 : 232), flexShrink: 0, borderRight: stacked ? 'none' : '1px solid #E2E8F0', borderBottom: stacked ? '1px solid #E2E8F0' : 'none', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: stacked ? 'center' : 'stretch', overflowY: stacked ? 'visible' : 'auto' }}>

            {/* Mini calendar */}
            <div style={{ padding: '18px 16px 12px', width: '100%', maxWidth: 420, boxSizing: 'border-box' }}>
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
            <div style={{ padding: '0 16px 12px', display: 'flex', gap: 10, flexWrap: 'wrap', width: '100%', maxWidth: 420, boxSizing: 'border-box' }}>
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
              <div style={{ padding: 14, width: '100%', maxWidth: 420, boxSizing: 'border-box' }}>
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

            {/* Provider notes — availability notes for the shown month, from
                admin overrides, PTO reasons, the provider app, and the
                tokenized availability link. (Replaces the old Requests & Notes
                page.) Tap a note to jump the board to that day. */}
            {visibleNotes.length > 0 && (
              <div style={{ padding: 14, width: '100%', maxWidth: 420, boxSizing: 'border-box' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  Provider Notes ({visibleNotes.length})
                </div>
                {visibleNotes.map((n, i) => {
                  const tilt = tiltFor(`${n.rid}-${n.date}`)
                  const paper = n.available === false
                    ? 'linear-gradient(160deg, #FECACA, #FBB4B4)'
                    : n.available === true
                    ? 'linear-gradient(160deg, #BFDBFE, #A9CBF7)'
                    : 'linear-gradient(160deg, #FEF08A, #FDE047)'
                  return (
                    <div
                      key={`${n.rid}-${n.date}-${i}`}
                      onClick={() => setSelDay(selDay === n.date ? null : n.date)}
                      title="Show this day on the board"
                      style={{
                        position: 'relative', background: paper, borderRadius: 3,
                        padding: '10px 12px', marginBottom: 12, cursor: 'pointer',
                        transform: `rotate(${tilt}deg)`,
                        boxShadow: '0 5px 10px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.5)',
                        outline: selDay === n.date ? '2px solid #2563EB' : 'none',
                      }}
                    >
                      <div style={{ position: 'absolute', top: -6, left: 12, width: 38, height: 13, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', transform: 'rotate(-4deg)' }} />
                      <div style={{ fontWeight: 800, fontSize: 12.5, color: '#1E293B' }}>
                        {n.name}
                        <span style={{ fontWeight: 600, color: 'rgba(30,41,59,0.55)', marginLeft: 6, fontSize: 11 }}>
                          {fmtDate(n.date)}{n.source === 'PROVIDER' ? ' · from provider' : n.source === 'PTO' ? ' · PTO' : ''}
                        </span>
                      </div>
                      <div style={{ fontFamily: '"Kalam", cursive', fontSize: 14, lineHeight: 1.35, color: '#1E293B', marginTop: 4, wordBreak: 'break-word' }}>
                        {n.note}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {work.length === 0 && ptoPending.length === 0 && notes.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                No requests yet.
              </div>
            )}
          </div>

          {/* Right: Kanban board */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: stacked ? 'visible' : 'hidden' }}>

            {/* Day header bar */}
            {selDay && (
              <div style={{ padding: '10px 20px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: 13, fontWeight: 700, color: '#1D4ED8', flexShrink: 0 }}>
                {new Date(selDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {' · '}{(filteredUnassigned.length + filteredTierGroups.reduce((s, g) => s + g.items.length, 0))} request{filteredUnassigned.length + filteredTierGroups.reduce((s, g) => s + g.items.length, 0) !== 1 ? 's' : ''}
              </div>
            )}
            {narrow && (
              <div style={{ padding: '8px 16px', fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>
                Swipe sideways to see all tiers → · Press and hold a note to drag it
              </div>
            )}

            {/* Five columns — a horizontal Post-it strip on narrow screens.
                NOTE: no -webkit-overflow-scrolling:touch here — iOS momentum
                scrolling ignores programmatic scrollLeft during an active
                touch, which broke drag-to-edge auto-scroll on iPad. */}
            <div ref={stripRef} style={{ flex: 1, display: 'flex', minHeight: 0, gap: 0, alignItems: stacked ? 'flex-start' : 'stretch', overflowX: narrow ? 'auto' : 'hidden', overflowY: stacked ? 'visible' : 'hidden' }}>

              {/* Unassigned column */}
              <KanbanColumn
                narrow={narrow}
                stacked={stacked}
                dropId="unassigned"
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
                    onTouchStart={(e) => onCardTouchStart(e, r.id)}
                    onTouchMove={onCardTouchMove}
                    onTouchEnd={onCardTouchEnd}
                    lifted={touchDragId === r.id}
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
                  narrow={narrow}
                  stacked={stacked}
                  dropId={t.n}
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
                      onTouchStart={(e) => onCardTouchStart(e, r.id)}
                      onTouchMove={onCardTouchMove}
                      onTouchEnd={onCardTouchEnd}
                      lifted={touchDragId === r.id}
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

      {/* Floating sticky that follows the finger during a touch drag */}
      {touchDragItem && (
        <div
          ref={ghostRef}
          style={{
            position: 'fixed',
            left: touchData.current?.x ?? 0,
            top: touchData.current?.y ?? 0,
            transform: 'translate(-50%, -80%) rotate(-3deg) scale(1.05)',
            width: 190,
            background: paperFor(touchDragItem, false),
            borderRadius: 3,
            padding: '12px 13px',
            boxShadow: '0 18px 36px rgba(15,23,42,0.38), inset 0 1px 0 rgba(255,255,255,0.5)',
            zIndex: 600,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 13.5, color: '#1E293B' }}>
            {touchDragItem.rosterEntry?.providerName || 'Provider'}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(30,41,59,0.8)', marginTop: 2 }}>
            {dateLabel(touchDragItem)}
          </div>
          {touchDragItem.note && (
            <div style={{ fontFamily: '"Kalam", cursive', fontSize: 14, lineHeight: 1.3, color: '#1E293B', marginTop: 4 }}>
              {touchDragItem.note}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Kanban column ─────────────────────────────────────────────────────────────
function KanbanColumn({ narrow, stacked, dropId, title, subtitle, count, color, bg, border, light, isDrop, onDragOver, onDragLeave, onDrop, children, isLast }) {
  return (
    <div
      data-drop={dropId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        flex: narrow ? '0 0 auto' : 1,
        width: narrow ? 'min(82vw, 320px)' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        borderRight: isLast ? 'none' : '1px solid #E2E8F0',
        minWidth: 0,
        transition: 'background 0.15s',
        background: isDrop ? (light || '#F0FDF4') : 'transparent',
      }}
    >
      {/* Column header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: `2px solid ${isDrop ? color : border}`, background: isDrop ? (light || bg) : bg, transition: 'all 0.15s', flexShrink: 0, position: stacked ? 'sticky' : 'static', top: 0, zIndex: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {title}{count > 0 ? <span style={{ marginLeft: 6, background: color, color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10 }}>{count}</span> : null}
        </div>
        {subtitle && <div style={{ fontSize: 10.5, color, opacity: 0.65, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {/* Cards */}
      <div style={{ flex: 1, overflowY: stacked ? 'visible' : 'auto', padding: '10px 10px 20px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Request card — a physical Post-it note ─────────────────────────────────────
function RequestCard({ r, rank, onDragStart, onTouchStart, onTouchMove, onTouchEnd, lifted, onTier, onDecline, onRestore, onUp, onDown, tierColor, declined }) {
  const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
  const paper = paperFor(r, declined)
  const tilt = tiltFor(r.id)
  const ink = declined ? '#64748B' : '#1E293B'

  const straighten = (e) => {
    if (declined) return
    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)'
    e.currentTarget.style.boxShadow = '0 12px 22px rgba(15,23,42,0.22)'
    e.currentTarget.style.zIndex = 5
  }
  const settle = (e) => {
    e.currentTarget.style.transform = `rotate(${tilt}deg)`
    e.currentTarget.style.boxShadow = '0 6px 12px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.5)'
    e.currentTarget.style.zIndex = 1
  }

  return (
    <div
      draggable={!declined}
      onDragStart={onDragStart}
      onTouchStart={declined ? undefined : onTouchStart}
      onTouchMove={declined ? undefined : onTouchMove}
      onTouchEnd={declined ? undefined : onTouchEnd}
      onMouseEnter={straighten}
      onMouseLeave={settle}
      style={{
        position: 'relative',
        background: paper,
        borderRadius: 3,
        padding: '12px 13px 11px',
        marginBottom: 13,
        cursor: declined ? 'default' : 'grab',
        opacity: lifted ? 0.35 : declined ? 0.6 : 1,
        boxShadow: '0 6px 12px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.5)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        transform: `rotate(${tilt}deg)`,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
        // 'backwards' (not 'both') — a persisted final keyframe would override
        // the inline opacity used to dim the card while it's touch-dragged.
        animation: 'postitDeal 0.28s ease backwards',
      }}
    >
      {/* Tape strip */}
      {!declined && (
        <div style={{ position: 'absolute', top: -8, left: 14, width: 46, height: 16, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', transform: 'rotate(-4deg)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
        <div style={{ minWidth: 0 }}>
          {rank != null && <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(30,41,59,0.5)', marginRight: 5 }}>#{rank}</span>}
          <span style={{ fontWeight: 800, fontSize: 13.5, color: ink }}>{r.rosterEntry?.providerName || 'Provider'}</span>
          {r.rosterEntry?.providerType && (
            <span style={{ fontSize: 10, color: 'rgba(30,41,59,0.55)', marginLeft: 5 }}>{r.rosterEntry.providerType}</span>
          )}
        </div>
        <span style={{ flexShrink: 0, background: 'rgba(255,255,255,0.7)', color: t.color, border: `1px solid ${t.border}`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>
          {t.label}
        </span>
      </div>

      {/* Date + site */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(30,41,59,0.8)', marginBottom: r.note ? 6 : 0 }}>
        {dateLabel(r)}
        {r.siteName && <span style={{ color: 'rgba(30,41,59,0.55)' }}> · {r.siteName}</span>}
      </div>

      {/* Note — in the provider's own hand */}
      {r.note && (
        <div style={{ fontFamily: '"Kalam", cursive', fontSize: 15, lineHeight: 1.35, color: ink, marginBottom: 4, wordBreak: 'break-word' }}>
          {r.note}
        </div>
      )}

      {/* Actions */}
      {!declined ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
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
                  background: active ? tier.color : 'rgba(255,255,255,0.85)',
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
        <button onClick={onRestore} style={{ marginTop: 8, padding: '4px 10px', background: 'rgba(255,255,255,0.85)', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          Restore
        </button>
      )}
    </div>
  )
}

const miniBtn = {
  width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
  background: 'rgba(255,255,255,0.85)', color: '#475569', border: '1.5px solid rgba(148,163,184,0.5)',
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
