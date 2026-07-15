import React, { useState, useEffect, useRef } from 'react'
import { availAPI } from '../../api.js'

// Federal holidays 2026 (hardcoded)
const FEDERAL_HOLIDAYS_2026 = {
  '2026-01-01': "New Year's",
  '2026-01-19': 'MLK Day',
  '2026-02-16': 'Presidents Day',
  '2026-05-25': 'Memorial Day',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
}

const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Post-it palette — warm paper yellows + accent tints
const POSTIT_YELLOW = '#FEF08A'
const POSTIT_YELLOW_DEEP = '#FDE047'
const POSTIT_BLUE = '#BFDBFE'
const POSTIT_RED = '#FECACA'

// Deterministic tiny tilt from a date string so notes feel physical but stable
function tiltFor(iso) {
  let h = 0
  for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i)) | 0
  return ((h % 5) - 2) // -2..+2 degrees
}

function padIso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Day of week (0=Sun) for the 1st of year/month
function firstDowOfMonth(year, month) {
  return new Date(year, month - 1, 1).getDay()
}

function formatDeadline(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// Sample data for the /avail/demo showcase link — always the current month so
// the link never looks stale. Not persisted anywhere.
function buildDemoRequest() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 1-indexed
  const dim = getDaysInMonth(year, month)
  const pick = (d) => padIso(year, month, Math.min(d, dim))
  const deadline = new Date(year, month - 1, Math.min(20, dim), 17, 0, 0)
  return {
    providerName: 'Alex Morgan',
    providerFirstName: 'Alex',
    facilityName: 'Riverside Anesthesia Group',
    year, month, monthName: MONTH_NAMES[month - 1],
    deadline: deadline.toISOString(),
    isLocked: false,
    submittedAt: null,
    submissions: [
      { date: pick(3), available: true, note: '' },
      { date: pick(4), available: true, note: 'Available after 10am only' },
      { date: pick(9), available: false, note: '' },
      { date: pick(10), available: true, note: '' },
      { date: pick(16), available: false, note: 'Out of town — please no calls' },
      { date: pick(17), available: true, note: '' },
      { date: pick(19), available: false, maybe: true, note: 'Could do a half day if you really need me' },
      { date: pick(24), available: true, note: 'Happy to take a late add if needed' },
    ],
  }
}

// Skeleton pulsing card placeholder
function Skeleton({ height = 20, width = '100%', style = {} }) {
  return (
    <div
      style={{
        height,
        width,
        background: 'rgba(255,255,255,0.55)',
        borderRadius: 8,
        animation: 'snapPulse 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  )
}

export default function AvailabilityPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null) // string | null
  const [data, setData] = useState(null) // server response
  const [dayStates, setDayStates] = useState(new Map()) // isoDate -> 'available'|'unavailable'|'maybe'|'unset'
  const [notesByDate, setNotesByDate] = useState(new Map()) // isoDate -> string
  const [noteOpen, setNoteOpen] = useState(null) // isoDate | null
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const longPressTimer = useRef(null)
  // Desktop = a fine pointer (mouse). Drives the pencil affordance on unset days
  // so a provider can drop a "maybe" sticky note without right-click/long-press.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)')?.matches
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(pointer: fine)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    if (!token) {
      setError('invalid')
      setLoading(false)
      return
    }
    // Shareable demo link — /avail/demo works with no SMS and no DB token.
    // Used for device testing and sales walkthroughs. Data is not persisted.
    if (token === 'demo') {
      const res = buildDemoRequest()
      setData(res)
      const states = new Map(); const notes = new Map()
      for (const sub of res.submissions) {
        states.set(sub.date, sub.maybe ? 'maybe' : (sub.available ? 'available' : 'unavailable'))
        if (sub.note) notes.set(sub.date, sub.note)
      }
      setDayStates(states); setNotesByDate(notes); setLoading(false)
      return
    }
    availAPI.getRequest(token)
      .then((res) => {
        setData(res)
        // Populate from existing submissions
        const states = new Map()
        const notes = new Map()
        for (const sub of res.submissions || []) {
          states.set(sub.date, sub.maybe ? 'maybe' : (sub.available ? 'available' : 'unavailable'))
          if (sub.note) notes.set(sub.date, sub.note)
        }
        setDayStates(states)
        setNotesByDate(notes)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.status === 404 ? 'not_found' : 'error')
        setLoading(false)
      })
  }, [token])

  // Let the auto-updater know not to reload over unsaved day selections.
  useEffect(() => {
    window.__snapDirty = hasChanges
    return () => { window.__snapDirty = false }
  }, [hasChanges])

  // Inject keyframes + handwriting font once
  useEffect(() => {
    const fontLink = document.createElement('link')
    fontLink.rel = 'stylesheet'
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap'
    document.head.appendChild(fontLink)

    const style = document.createElement('style')
    style.textContent = `
      @keyframes snapPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      @keyframes postitPop {
        0%   { transform: scale(0.6) rotate(-10deg); opacity: 0; }
        60%  { transform: scale(1.06) rotate(var(--tilt, -2deg)); opacity: 1; }
        100% { transform: scale(1) rotate(var(--tilt, -2deg)); opacity: 1; }
      }
      @keyframes backdropIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes floatUp { from { transform: translateY(14px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes checkPop {
        0% { transform: scale(0) rotate(-20deg); opacity: 0; }
        55% { transform: scale(1.15) rotate(3deg); opacity: 1; }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes confettiFall {
        0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
        100% { transform: translateY(120px) rotate(320deg); opacity: 0; }
      }
      .snap-day { transition: transform 0.12s ease; }
      .snap-day:active { transform: scale(0.93); }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
      if (fontLink.parentNode) document.head.removeChild(fontLink)
    }
  }, [])

  function cycleDay(isoDate) {
    if (data?.isLocked) return
    setDayStates((prev) => {
      const next = new Map(prev)
      const cur = prev.get(isoDate) || 'unset'
      let newState
      if (cur === 'unset') newState = 'available'
      // A tap on a "maybe" promotes it to a firm yes (its note is kept).
      else if (cur === 'maybe') newState = 'available'
      else if (cur === 'available') newState = 'unavailable'
      else {
        newState = 'unset'
        // Clear note when cycling to unset
        setNotesByDate((pn) => {
          const nn = new Map(pn)
          nn.delete(isoDate)
          return nn
        })
      }
      next.set(isoDate, newState)
      setHasChanges(true)
      return next
    })
  }

  function openNote(isoDate) {
    if (data?.isLocked) return
    setNoteOpen(isoDate)
    setNoteText(notesByDate.get(isoDate) || '')
  }

  function closeNote() {
    setNoteOpen(null)
    setNoteText('')
  }

  function saveNote() {
    if (noteOpen) {
      setNotesByDate((prev) => {
        const next = new Map(prev)
        if (noteText.trim()) {
          next.set(noteOpen, noteText.trim())
        } else {
          next.delete(noteOpen)
        }
        return next
      })
      // A note on an otherwise-unset day is a "maybe" — a soft signal for the
      // coordinator, NOT a firm yes. Days already marked keep their state.
      if (noteText.trim()) {
        setDayStates((prev) => {
          const cur = prev.get(noteOpen)
          if (cur && cur !== 'unset') return prev
          const next = new Map(prev)
          next.set(noteOpen, 'maybe')
          return next
        })
      }
      setHasChanges(true)
    }
    closeNote()
  }

  function clearNote() {
    if (noteOpen) {
      setNotesByDate((prev) => {
        const next = new Map(prev)
        next.delete(noteOpen)
        return next
      })
      // A "maybe" is only meaningful with its note — clearing it reverts to unset.
      setDayStates((prev) => {
        if (prev.get(noteOpen) !== 'maybe') return prev
        const next = new Map(prev)
        next.set(noteOpen, 'unset')
        return next
      })
      setHasChanges(true)
    }
    closeNote()
  }

  async function handleSubmit() {
    if (!hasChanges || saving) return
    // Demo link never writes to the server — just show the celebration.
    if (token === 'demo') {
      setSaving(true)
      setTimeout(() => { setSaved(true); setHasChanges(false); setSaving(false) }, 500)
      return
    }
    setSaving(true)
    try {
      const dates = []
      for (const [date, state] of dayStates.entries()) {
        if (state !== 'unset') {
          dates.push({
            date,
            available: state === 'available',
            maybe: state === 'maybe',
            note: notesByDate.get(date) || null,
          })
        }
      }
      await availAPI.submit(token, dates)
      setSaved(true)
      setHasChanges(false)
    } catch (err) {
      alert(err.message || 'Submit failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Count stats
  const availableCount = [...dayStates.values()].filter((s) => s === 'available').length
  const unavailableCount = [...dayStates.values()].filter((s) => s === 'unavailable').length
  const maybeCount = [...dayStates.values()].filter((s) => s === 'maybe').length
  const noteCount = notesByDate.size

  const pageBg = 'linear-gradient(180deg, #EFF6FF 0%, #F8FAFC 220px, #F1F5F9 100%)'

  // ── Error states ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: pageBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 40, maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 12px 40px rgba(15,23,42,0.12)' }}>
          <SnapWordmark dark />
          <div style={{ fontSize: 48, margin: '24px 0 16px' }}>🔗</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: '0 0 12px' }}>This link isn't valid</h1>
          <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: 0 }}>
            This availability link may have expired or been shared incorrectly. Please contact your coordinator for a fresh link.
          </p>
        </div>
      </div>
    )
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: pageBg }}>
        <div style={{ background: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 55%, #3B82F6 100%)', padding: '22px 24px 30px' }}>
          <SnapWordmark />
        </div>
        <div style={{ padding: 20, maxWidth: 520, margin: '0 auto' }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 24, marginTop: -18, marginBottom: 16, boxShadow: '0 8px 28px rgba(15,23,42,0.08)' }}>
            <Skeleton height={28} width="55%" style={{ marginBottom: 12, background: '#E2E8F0' }} />
            <Skeleton height={16} width="85%" style={{ background: '#E2E8F0' }} />
          </div>
          <div style={{ background: '#fff', borderRadius: 18, padding: 20, boxShadow: '0 8px 28px rgba(15,23,42,0.08)' }}>
            <Skeleton height={200} style={{ borderRadius: 12, background: '#E2E8F0' }} />
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  // ── Post-submit celebration ───────────────────────────────────────────────────
  if (saved) {
    const confetti = ['#2563EB', POSTIT_YELLOW_DEEP, '#34D399', '#F472B6', '#60A5FA', POSTIT_YELLOW]
    return (
      <div style={{ position: 'fixed', inset: 0, background: pageBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 9999, overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {/* Confetti */}
        {[...Array(14)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute', top: '18%', left: `${8 + i * 6.4}%`,
            width: 9, height: 9, borderRadius: i % 2 ? 2 : '50%',
            background: confetti[i % confetti.length],
            animation: `confettiFall ${1.2 + (i % 5) * 0.25}s ease-in ${(i % 4) * 0.12}s infinite`,
          }} />
        ))}
        <div style={{
          width: 84, height: 84, borderRadius: 42,
          background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 42, color: '#fff', marginBottom: 24,
          boxShadow: '0 12px 30px rgba(37,99,235,0.4)',
          animation: 'checkPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
        }}>
          ✓
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', margin: '0 0 8px', textAlign: 'center', animation: 'floatUp 0.4s ease 0.15s both' }}>
          You're all set, {data.providerFirstName}!
        </h1>
        <p style={{ fontSize: 15, color: '#475569', margin: '0 0 8px', textAlign: 'center', maxWidth: 340, lineHeight: 1.5, animation: 'floatUp 0.4s ease 0.25s both' }}>
          {data.facilityName} has your <strong>{data.monthName}</strong> availability
          {noteCount > 0 ? ` and ${noteCount} note${noteCount > 1 ? 's' : ''}` : ''}.
        </p>
        <div style={{ display: 'flex', gap: 18, margin: '16px 0 28px', animation: 'floatUp 0.4s ease 0.35s both' }}>
          <Stat n={availableCount} label="available" color="#2563EB" />
          {unavailableCount > 0 && <Stat n={unavailableCount} label="off" color="#DC2626" />}
          {maybeCount > 0 && <Stat n={maybeCount} label="maybe" color="#D97706" />}
          {noteCount > 0 && <Stat n={noteCount} label="notes" color="#CA8A04" />}
        </div>
        {!data.isLocked ? (
          <div style={{ textAlign: 'center', animation: 'floatUp 0.4s ease 0.45s both' }}>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 10 }}>
              You can update anytime until {formatDeadline(data.deadline)}.
            </div>
            <button
              onClick={() => setSaved(false)}
              style={{ background: '#fff', border: '1.5px solid #CBD5E1', color: '#2563EB', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: '10px 20px', borderRadius: 10 }}
            >
              Make changes
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#64748B' }}>Submissions are now closed.</div>
        )}
        <div style={{ position: 'absolute', bottom: 22, fontSize: 12, color: '#94A3B8', textAlign: 'center', animation: 'floatUp 0.4s ease 0.6s both' }}>
          Powered by <strong style={{ color: '#2563EB' }}>SNAP</strong> — smarter medical scheduling
        </div>
      </div>
    )
  }

  // ── Calendar ──────────────────────────────────────────────────────────────────
  const { year, month, monthName, facilityName, providerFirstName, deadline, isLocked } = data
  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = firstDowOfMonth(year, month)

  // Build calendar grid — leading nulls then day numbers
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  // Deadline proximity
  const msToDeadline = new Date(deadline) - new Date()
  const within48h = msToDeadline > 0 && msToDeadline < 48 * 60 * 60 * 1000

  // Note sheet date label
  const noteDate = noteOpen ? (() => {
    const d = new Date(noteOpen + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  })() : ''
  const noteDayState = noteOpen ? (dayStates.get(noteOpen) || 'unset') : 'unset'
  const noteTilt = noteOpen ? tiltFor(noteOpen) : 0

  return (
    <div style={{ minHeight: '100vh', background: pageBg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* ── Hero header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 55%, #3B82F6 100%)',
        padding: '22px 24px 34px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* soft glow */}
        <div style={{ position: 'absolute', top: -60, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.10)' }} />
        <div style={{ position: 'absolute', bottom: -50, left: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
        <SnapWordmark />
        <div style={{ marginTop: 18, position: 'relative' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)', marginBottom: 4 }}>
            {monthName} {year} availability
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em' }}>
            Hi {providerFirstName} 👋
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', margin: '6px 0 0', lineHeight: 1.5, maxWidth: 420 }}>
            {facilityName} is building the {monthName} schedule. Tap the days you can work — it takes about a minute.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 16px 130px' }}>

        {/* ── Deadline banner ── */}
        <div style={{ marginTop: -16, marginBottom: 14, position: 'relative', zIndex: 2 }}>
          {isLocked ? (
            <Banner bg="#FEE2E2" fg="#991B1B" icon="🔒">
              Submissions are closed. Contact your coordinator to make changes.
            </Banner>
          ) : within48h ? (
            <Banner bg="#FEF3C7" fg="#92400E" icon="⏰">
              Closing soon — submit by {formatDeadline(deadline)}.
            </Banner>
          ) : (
            <Banner bg="#DBEAFE" fg="#1E40AF" icon="🗓️">
              Please submit by {formatDeadline(deadline)}. You can change it anytime until then.
            </Banner>
          )}
        </div>

        {/* ── Calendar card ── */}
        <div style={{ background: '#fff', borderRadius: 20, padding: '18px 14px 14px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>

          {/* Legend */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { color: 'linear-gradient(135deg,#2563EB,#3B82F6)', label: 'Available' },
              { color: 'linear-gradient(135deg,#DC2626,#EF4444)', label: 'Unavailable' },
              { color: 'linear-gradient(135deg,#D97706,#F59E0B)', label: 'Maybe' },
              { color: '#F1F5F9', label: 'Not set', border: '#E2E8F0' },
              { color: POSTIT_YELLOW, label: 'Has note', border: '#EAB308', pin: true },
            ].map(({ color, label, border, pin }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: pin ? 2 : 4, background: color, border: border ? `1.5px solid ${border}` : 'none', transform: pin ? 'rotate(-8deg)' : 'none' }} />
                <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5, marginBottom: 6 }}>
            {DAY_ABBREVS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#94A3B8', padding: '2px 0' }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const iso = padIso(year, month, day)
              const state = dayStates.get(iso) || 'unset'
              const holiday = FEDERAL_HOLIDAYS_2026[iso]
              const hasNote = !!notesByDate.get(iso)
              // cells[] already has firstDow leading blanks, so the column is
              // just idx % 7 (0 = Sunday … 6 = Saturday).
              const isWeekend = [0, 6].includes(idx % 7)

              let bg, textColor, border, shadow
              if (state === 'available') {
                bg = 'linear-gradient(135deg,#2563EB,#3B82F6)'
                textColor = '#fff'
                border = 'none'
                shadow = '0 4px 10px rgba(37,99,235,0.28)'
              } else if (state === 'unavailable') {
                bg = 'linear-gradient(135deg,#DC2626,#EF4444)'
                textColor = '#fff'
                border = 'none'
                shadow = '0 4px 10px rgba(220,38,38,0.25)'
              } else if (state === 'maybe') {
                bg = 'linear-gradient(135deg,#D97706,#F59E0B)'
                textColor = '#fff'
                border = 'none'
                shadow = '0 4px 10px rgba(217,119,6,0.28)'
              } else {
                bg = isWeekend ? '#F8FAFC' : '#F1F5F9'
                textColor = isWeekend ? '#CBD5E1' : '#94A3B8'
                border = '1.5px solid #E9EEF5'
                shadow = 'none'
              }

              const isSet = state === 'available' || state === 'unavailable' || state === 'maybe'

              return (
                <div
                  key={iso}
                  className="snap-day"
                  onClick={() => cycleDay(iso)}
                  onContextMenu={(e) => { e.preventDefault(); openNote(iso) }}
                  onTouchStart={() => {
                    if (isLocked) return
                    longPressTimer.current = setTimeout(() => openNote(iso), 500)
                  }}
                  onTouchEnd={() => clearTimeout(longPressTimer.current)}
                  onTouchMove={() => clearTimeout(longPressTimer.current)}
                  onTouchCancel={() => clearTimeout(longPressTimer.current)}
                  style={{
                    position: 'relative',
                    aspectRatio: '1 / 1.05',
                    minHeight: 52,
                    background: bg,
                    border,
                    borderRadius: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isLocked ? 'default' : 'pointer',
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    boxShadow: shadow,
                    padding: '2px',
                    overflow: 'visible',
                  }}
                >
                  {/* Day number */}
                  <div style={{ fontSize: 16, fontWeight: 700, color: textColor, lineHeight: 1 }}>
                    {day}
                  </div>

                  {/* Holiday name */}
                  {holiday && (
                    <div style={{
                      fontSize: 8,
                      fontWeight: 600,
                      color: isSet ? 'rgba(255,255,255,0.8)' : '#B0BAC7',
                      textAlign: 'center',
                      lineHeight: 1.1,
                      marginTop: 3,
                      maxWidth: '96%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {holiday}
                    </div>
                  )}

                  {/* Post-it corner fold — the day carries a note */}
                  {hasNote && (
                    <div
                      onClick={(e) => { e.stopPropagation(); openNote(iso) }}
                      title="View note"
                      style={{
                        position: 'absolute', top: -3, right: -3,
                        width: 20, height: 20,
                        background: POSTIT_YELLOW,
                        borderRadius: '3px 6px 3px 8px',
                        transform: 'rotate(8deg)',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.22)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, lineHeight: 1,
                        border: '1px solid #EAB308',
                      }}
                    >
                      ✎
                    </div>
                  )}

                  {/* Add-note affordance on set days without a note */}
                  {isSet && !hasNote && !isLocked && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openNote(iso) }}
                      title="Add a note"
                      style={{
                        position: 'absolute', bottom: 2, right: 3,
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 10, lineHeight: 1, padding: 2,
                        color: 'rgba(255,255,255,0.65)',
                      }}
                    >
                      ✎
                    </button>
                  )}

                  {/* Desktop pencil on "not set" days — drop a sticky note to
                      flag a soft "maybe" without committing to available/off. */}
                  {state === 'unset' && !hasNote && !isLocked && isDesktop && (
                    <button
                      className="snap-maybe-pencil"
                      onClick={(e) => { e.stopPropagation(); openNote(iso) }}
                      title="Maybe? Leave a note for your coordinator"
                      style={{
                        position: 'absolute', bottom: 2, right: 3,
                        background: POSTIT_YELLOW, border: '1px solid #EAB308',
                        borderRadius: 4, cursor: 'pointer',
                        fontSize: 10, lineHeight: 1, padding: '2px 3px',
                        color: '#854D0E',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                      }}
                    >
                      ✎
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Hint */}
          {!isLocked && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#F8FAFC', borderRadius: 12, fontSize: 12, color: '#64748B', textAlign: 'center', lineHeight: 1.5 }}>
              Tap a day: once for <strong style={{ color: '#2563EB' }}>available</strong>, again for <strong style={{ color: '#DC2626' }}>unavailable</strong>, again to clear.
              <br />On a not-set day, the <span style={{ display: 'inline-block', transform: 'rotate(-6deg)', background: POSTIT_YELLOW, borderRadius: 3, padding: '0 4px', border: '1px solid #EAB308' }}>✎</span> pencil leaves a note to flag a <strong style={{ color: '#D97706' }}>maybe</strong> day for your coordinator.
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom sticky bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)',
        borderTop: '1px solid #E2E8F0',
        padding: '14px 20px calc(14px + env(safe-area-inset-bottom))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        boxShadow: '0 -6px 24px rgba(15,23,42,0.08)',
        zIndex: 100,
        maxWidth: 520, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#64748B' }}>
          <span><strong style={{ color: '#2563EB', fontSize: 16 }}>{availableCount}</strong> avail</span>
          <span><strong style={{ color: '#DC2626', fontSize: 16 }}>{unavailableCount}</strong> off</span>
          {maybeCount > 0 && <span><strong style={{ color: '#D97706', fontSize: 16 }}>{maybeCount}</strong> maybe</span>}
          {noteCount > 0 && <span><strong style={{ color: '#CA8A04', fontSize: 16 }}>{noteCount}</strong> notes</span>}
        </div>
        {isLocked ? (
          <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700 }}>Closed</div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!hasChanges || saving}
            style={{
              padding: '12px 26px',
              background: hasChanges && !saving ? 'linear-gradient(135deg,#2563EB,#3B82F6)' : '#CBD5E1',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              cursor: hasChanges && !saving ? 'pointer' : 'default',
              boxShadow: hasChanges && !saving ? '0 6px 16px rgba(37,99,235,0.35)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Submit'}
          </button>
        )}
      </div>

      {/* ── Post-it note modal ── */}
      {noteOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeNote}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200,
              animation: 'backdropIn 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
          >
            {/* The Post-it */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                '--tilt': `${noteTilt}deg`,
                position: 'relative',
                width: '100%', maxWidth: 340,
                background: noteDayState === 'unavailable'
                  ? `linear-gradient(160deg, ${POSTIT_RED} 0%, #FBB4B4 100%)`
                  : noteDayState === 'available'
                  ? `linear-gradient(160deg, ${POSTIT_BLUE} 0%, #A9CBF7 100%)`
                  : `linear-gradient(160deg, ${POSTIT_YELLOW} 0%, ${POSTIT_YELLOW_DEEP} 100%)`,
                borderRadius: '2px',
                padding: '26px 24px 22px',
                boxShadow: '0 22px 50px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.5)',
                transform: `rotate(${noteTilt}deg)`,
                animation: 'postitPop 0.42s cubic-bezier(0.34,1.56,0.64,1) both',
                fontFamily: '"Kalam", "Comic Sans MS", cursive',
              }}
            >
              {/* Tape strip */}
              <div style={{
                position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                width: 96, height: 26,
                background: 'rgba(255,255,255,0.45)',
                border: '1px solid rgba(255,255,255,0.6)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
              }} />

              <div style={{ fontFamily: '"Kalam", cursive', fontSize: 22, fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>
                {noteDate}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(30,41,59,0.65)', marginBottom: 14, fontFamily: '-apple-system, sans-serif' }}>
                {noteDayState === 'available' && 'Marked available · '}
                {noteDayState === 'unavailable' && 'Marked unavailable · '}
                A note goes straight to your coordinator
              </div>

              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
                placeholder={'e.g. "Available after 10am"\n"Prefer the Kenmore site"\n"Can only do a half day"'}
                autoFocus
                style={{
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: '"Kalam", "Comic Sans MS", cursive',
                  fontSize: 19,
                  lineHeight: 1.5,
                  color: '#1E293B',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  // ruled-paper feel
                  backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, rgba(30,41,59,0.13) 28px)',
                  backgroundAttachment: 'local',
                }}
              />

              <div style={{ display: 'flex', gap: 10, marginTop: 16, fontFamily: '-apple-system, sans-serif' }}>
                <button
                  onClick={clearNote}
                  style={{
                    flex: 1, padding: '11px', background: 'rgba(255,255,255,0.55)',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#475569',
                  }}
                >
                  Remove
                </button>
                <button
                  onClick={saveNote}
                  style={{
                    flex: 2, padding: '11px', background: '#1E293B', border: 'none',
                    borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#fff',
                  }}
                >
                  Stick it on 📌
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Small building blocks ─────────────────────────────────────────────────────

function SnapWordmark({ dark = false }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, color: dark ? '#2563EB' : '#fff', letterSpacing: '-0.05em', lineHeight: 1 }}>
        SNAP
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: dark ? '#94A3B8' : 'rgba(255,255,255,0.65)', letterSpacing: '0.08em', marginTop: 2 }}>
        MEDICAL TECHNOLOGIES
      </div>
    </div>
  )
}

function Banner({ bg, fg, icon, children }) {
  return (
    <div style={{
      background: bg, color: fg, padding: '12px 16px', borderRadius: 14,
      fontSize: 13, fontWeight: 600, lineHeight: 1.4,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function Stat({ n, label, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginTop: 3 }}>{label}</div>
    </div>
  )
}
