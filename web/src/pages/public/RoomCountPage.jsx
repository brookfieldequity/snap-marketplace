import React, { useState, useEffect, useMemo } from 'react'
import { roomCountAPI } from '../../api.js'

// Public, no-login room-count submission. The URL token is the credential.
// A site scheduler declares how many anesthetizing rooms run each day next
// month; this feeds the schedule builder as the authoritative demand input.

const NAVY = '#0F172A'
const ROYAL = '#2563EB'
const SLATE = '#475569'
const MUTED = '#94A3B8'
const LINE = '#E2E8F0'
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function RoomCountPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [counts, setCounts] = useState(new Map()) // isoDate -> string
  const [notes, setNotes] = useState(new Map())   // isoDate -> string
  const [noteOpen, setNoteOpen] = useState(null)  // isoDate | null (note editor)
  const [noteDraft, setNoteDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [quickFill, setQuickFill] = useState('')

  useEffect(() => {
    let alive = true
    // Shareable demo — /rooms/demo renders sample data with no token/DB.
    if (token === 'demo') {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const monthName = now.toLocaleDateString('en-US', { month: 'long' })
      const deadline = new Date(year, month - 1, 25).toISOString()
      setData({ facilityName: 'CAPA (demo)', location: 'Kenmore', month, year, monthName, deadline, isLocked: false, submittedAt: null, counts: [] })
      setLoading(false)
      return () => { alive = false }
    }
    roomCountAPI.getRequest(token)
      .then((res) => {
        if (!alive) return
        setData(res)
        const m = new Map()
        const nm = new Map()
        for (const c of res.counts || []) {
          m.set(c.date, String(c.roomsRequired))
          if (c.note) nm.set(c.date, c.note)
        }
        setCounts(m)
        setNotes(nm)
        setSavedAt(res.submittedAt || null)
      })
      .catch((e) => { if (alive) setError(e?.code === 'NOT_FOUND' ? 'NOT_FOUND' : (e.message || 'Failed to load')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  const calendar = useMemo(() => {
    if (!data) return null
    const { year, month } = data
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const date = iso(year, month, d)
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay()
      cells.push({ d, date, isWeekend: dow === 0 || dow === 6 })
    }
    return cells
  }, [data])

  const locked = data?.isLocked
  const totalRoomDays = useMemo(() => {
    let t = 0
    for (const v of counts.values()) { const n = Number(v); if (Number.isFinite(n) && n > 0) t += n }
    return t
  }, [counts])

  function setCount(date, value) {
    if (locked) return
    const clean = value.replace(/[^\d]/g, '').slice(0, 2)
    setCounts((prev) => {
      const next = new Map(prev)
      if (clean === '') next.delete(date)
      else next.set(date, clean)
      return next
    })
    setSavedAt(null)
  }

  function applyQuickFill() {
    const n = quickFill.replace(/[^\d]/g, '').slice(0, 2)
    if (n === '' || !calendar) return
    setCounts((prev) => {
      const next = new Map(prev)
      for (const cell of calendar) {
        if (cell && !cell.isWeekend) next.set(cell.date, n)
      }
      return next
    })
    setSavedAt(null)
  }

  async function submit() {
    if (token === 'demo') { setSavedAt(new Date().toISOString()); return }
    setSaving(true)
    try {
      // Send any day that has a count or a note. A note-only day stores as 0
      // rooms (closed but with context) so the note isn't lost.
      const dates = new Set([...counts.keys(), ...notes.keys()])
      const days = []
      for (const date of dates) {
        const n = Number(counts.get(date))
        const rooms = Number.isFinite(n) && n >= 0 ? n : 0
        const note = notes.get(date) || undefined
        if (counts.has(date) || note) days.push({ date, roomsRequired: rooms, note })
      }
      await roomCountAPI.submit(token, days)
      setSavedAt(new Date().toISOString())
    } catch (e) {
      alert(e?.code === 'DEADLINE_PASSED' ? 'Submissions are closed — the deadline has passed.' : (e.message || 'Could not submit.'))
    } finally {
      setSaving(false)
    }
  }

  // ── States ──────────────────────────────────────────────────────────────────
  if (loading) return <Shell><div style={{ color: MUTED, textAlign: 'center', padding: '60px 0' }}>Loading…</div></Shell>
  if (error === 'NOT_FOUND') return (
    <Shell><Center title="Link not found" body="This room-count link is invalid or has expired. Please ask your SNAP contact to resend it." /></Shell>
  )
  if (error) return <Shell><Center title="Something went wrong" body={error} /></Shell>

  const deadlineStr = data.deadline ? new Date(data.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''

  return (
    <Shell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px 120px' }}>
        {/* Header */}
        <div style={{ padding: '28px 0 18px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: ROYAL }}>
            {data.facilityName} · Room counts
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY, margin: '8px 0 4px', letterSpacing: '-0.02em' }}>
            {data.location} — {data.monthName} {data.year}
          </h1>
          <p style={{ fontSize: 14.5, color: SLATE, margin: 0, lineHeight: 1.55 }}>
            How many rooms will be running each day? Enter a number for every operating day so the schedule is
            staffed to exactly what's running. {deadlineStr && <>Please submit by <strong>{deadlineStr}</strong>.</>}
          </p>
        </div>

        {locked && (
          <Banner tone="amber">This request is closed — the deadline has passed. Contact your SNAP contact if you still need to submit.</Banner>
        )}
        {savedAt && !locked && (
          <Banner tone="green">✓ Submitted {new Date(savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. You can update any day and re-submit until the deadline.</Banner>
        )}

        {/* Quick fill */}
        {!locked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#F8FAFC', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 16px', margin: '4px 0 18px' }}>
            <span style={{ fontSize: 13.5, color: SLATE, fontWeight: 600 }}>Run the same most weekdays?</span>
            <input
              inputMode="numeric" value={quickFill} onChange={(e) => setQuickFill(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
              placeholder="#" aria-label="Rooms per weekday"
              style={{ width: 52, textAlign: 'center', fontSize: 15, fontWeight: 700, color: NAVY, border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 0' }}
            />
            <button onClick={applyQuickFill} style={btn(false)}>Fill all weekdays</button>
            <span style={{ fontSize: 12.5, color: MUTED }}>then adjust any exceptions below</span>
          </div>
        )}

        {/* Calendar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 0' }}>{w}</div>
          ))}
          {calendar.map((cell, i) => {
            if (!cell) return <div key={`b${i}`} />
            const val = counts.get(cell.date) ?? ''
            const filled = val !== '' && Number(val) > 0
            const hasNote = notes.has(cell.date) && notes.get(cell.date).trim() !== ''
            return (
              <div key={cell.date} style={{
                border: `1px solid ${filled ? ROYAL : LINE}`,
                background: cell.isWeekend ? '#F8FAFC' : '#fff',
                borderRadius: 10, padding: '6px 4px 6px', minHeight: 74,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: cell.isWeekend ? MUTED : SLATE, alignSelf: 'flex-end', paddingRight: 4 }}>{cell.d}</div>
                <input
                  inputMode="numeric" value={val} disabled={locked}
                  onChange={(e) => setCount(cell.date, e.target.value)}
                  aria-label={`Rooms on ${cell.date}`}
                  style={{
                    width: '100%', maxWidth: 46, textAlign: 'center', fontSize: 16, fontWeight: 800,
                    color: filled ? ROYAL : NAVY, border: 'none', background: 'transparent',
                    outline: 'none', padding: 0,
                  }}
                  placeholder={cell.isWeekend ? '' : '–'}
                />
                <button
                  onClick={() => { setNoteOpen(cell.date); setNoteDraft(notes.get(cell.date) || '') }}
                  disabled={locked}
                  title={hasNote ? notes.get(cell.date) : 'Add a note for this day'}
                  aria-label={`Note for ${cell.date}`}
                  style={{
                    border: 'none', background: 'transparent', cursor: locked ? 'default' : 'pointer',
                    fontSize: 11, lineHeight: 1, padding: '1px 4px', borderRadius: 4,
                    color: hasNote ? '#B45309' : (cell.isWeekend ? '#CBD5E1' : '#94A3B8'),
                    fontWeight: hasNote ? 800 : 400,
                  }}
                >✎{hasNote ? ' note' : ''}</button>
              </div>
            )
          })}
        </div>

        <div style={{ fontSize: 13, color: MUTED, marginTop: 14 }}>
          Leave a day blank if no rooms run (weekends, holidays). Total for the month: <strong style={{ color: SLATE }}>{totalRoomDays} room-days</strong>.
        </div>
      </div>

      {/* Sticky submit */}
      {!locked && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '14px 16px', display: 'flex', justifyContent: 'center', boxShadow: '0 -4px 20px rgba(15,23,42,0.06)' }}>
          <div style={{ width: '100%', maxWidth: 720, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13.5, color: SLATE }}>{counts.size} day{counts.size === 1 ? '' : 's'} entered</span>
            <button onClick={submit} disabled={saving} style={btn(true)}>{saving ? 'Submitting…' : (savedAt ? 'Update submission' : 'Submit room counts')}</button>
          </div>
        </div>
      )}

      {/* Note editor */}
      {noteOpen && (
        <div
          onClick={() => setNoteOpen(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420, padding: 22, boxShadow: '0 25px 60px rgba(15,23,42,0.25)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: ROYAL, marginBottom: 4 }}>Note for your coordinator</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
              {new Date(noteOpen + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <textarea
              value={noteDraft} onChange={(e) => setNoteDraft(e.target.value.slice(0, 500))} autoFocus
              placeholder="e.g. one all-day spine case · half day, closing at noon · possible add-on room"
              style={{ width: '100%', minHeight: 96, resize: 'vertical', fontSize: 14, color: NAVY, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              {notes.has(noteOpen)
                ? <button onClick={() => { setNotes((p) => { const n = new Map(p); n.delete(noteOpen); return n }); setSavedAt(null); setNoteOpen(null) }} style={{ ...btn(false), color: '#DC2626', borderColor: '#FECACA' }}>Remove</button>
                : <span />}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setNoteOpen(null)} style={btn(false)}>Cancel</button>
                <button
                  onClick={() => { const t = noteDraft.trim(); setNotes((p) => { const n = new Map(p); if (t) n.set(noteOpen, t); else n.delete(noteOpen); return n }); setSavedAt(null); setNoteOpen(null) }}
                  style={btn(true)}
                >Save note</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ── Small building blocks ───────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F1F5F9', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${LINE}`, padding: '14px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', fontSize: 20, fontWeight: 900, color: ROYAL, letterSpacing: '-0.01em' }}>SNAP</div>
      </div>
      {children}
    </div>
  )
}

function Center({ title, body }) {
  return (
    <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', padding: '80px 20px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>{title}</h1>
      <p style={{ fontSize: 15, color: SLATE, lineHeight: 1.6, margin: 0 }}>{body}</p>
    </div>
  )
}

function Banner({ tone, children }) {
  const tones = {
    green: { bg: '#F0FDF4', bd: '#BBF7D0', fg: '#166534' },
    amber: { bg: '#FFFBEB', bd: '#FDE68A', fg: '#92400E' },
  }
  const t = tones[tone] || tones.green
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.bd}`, color: t.fg, borderRadius: 10, padding: '11px 16px', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 16px' }}>{children}</div>
  )
}

function btn(primary) {
  return {
    padding: primary ? '12px 26px' : '9px 16px',
    background: primary ? ROYAL : '#fff',
    color: primary ? '#fff' : NAVY,
    border: primary ? 'none' : `1px solid ${LINE}`,
    borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
    boxShadow: primary ? '0 4px 12px rgba(37,99,235,0.3)' : 'none',
  }
}
