import React, { useState, useEffect, useRef } from 'react'
import { availAPI } from '../../api.js'

// Federal holidays 2026 (hardcoded)
const FEDERAL_HOLIDAYS_2026 = {
  '2026-01-01': "New Year's",
  '2026-01-19': 'MLK Day',
  '2026-02-16': "Presidents Day",
  '2026-05-25': 'Memorial Day',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-10-12': 'Columbus Day',
  '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
}

const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

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

// Skeleton pulsing card placeholder
function Skeleton({ height = 20, width = '100%', style = {} }) {
  return (
    <div
      style={{
        height,
        width,
        background: '#E2E8F0',
        borderRadius: 6,
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
  const [dayStates, setDayStates] = useState(new Map()) // isoDate -> 'available'|'unavailable'|'unset'
  const [notesByDate, setNotesByDate] = useState(new Map()) // isoDate -> string
  const [noteOpen, setNoteOpen] = useState(null) // isoDate | null
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const backdropRef = useRef(null)
  const longPressTimer = useRef(null)

  useEffect(() => {
    if (!token) {
      setError('invalid')
      setLoading(false)
      return
    }
    availAPI.getRequest(token)
      .then((res) => {
        setData(res)
        // Populate from existing submissions
        const states = new Map()
        const notes = new Map()
        for (const sub of res.submissions || []) {
          states.set(sub.date, sub.available ? 'available' : 'unavailable')
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

  // Inject keyframe animation once
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `@keyframes snapPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  function cycleDay(isoDate) {
    if (data?.isLocked) return
    setDayStates((prev) => {
      const next = new Map(prev)
      const cur = prev.get(isoDate) || 'unset'
      let newState
      if (cur === 'unset') newState = 'available'
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

      // If tapping into available/unavailable and note exists, open note sheet
      if ((newState === 'available' || newState === 'unavailable') && notesByDate.get(isoDate)) {
        setNoteOpen(isoDate)
        setNoteText(notesByDate.get(isoDate) || '')
      }
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
      setHasChanges(true)
    }
    closeNote()
  }

  async function handleSubmit() {
    if (!hasChanges || saving) return
    setSaving(true)
    try {
      const dates = []
      for (const [date, state] of dayStates.entries()) {
        if (state !== 'unset') {
          dates.push({
            date,
            available: state === 'available',
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

  // ── Error states ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em', marginBottom: 24 }}>SNAP</div>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: '0 0 12px' }}>This link isn't valid</h1>
          <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: 0 }}>
            This availability link may have expired or been shared incorrectly. Please contact your coordinator for a new link.
          </p>
        </div>
      </div>
    )
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        {/* Header */}
        <div style={{ background: '#2563EB', padding: '20px 24px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>SNAP</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Medical Technologies</div>
        </div>
        <div style={{ padding: 24, maxWidth: 500, margin: '0 auto' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
            <Skeleton height={28} width="60%" style={{ marginBottom: 12 }} />
            <Skeleton height={16} width="85%" />
          </div>
          <Skeleton height={48} style={{ borderRadius: 8, marginBottom: 16 }} />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} height={44} style={{ borderRadius: 8, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  // ── Post-submit overlay ───────────────────────────────────────────────────────
  if (saved) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 9999 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 36, background: '#2563EB',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, color: '#fff', marginBottom: 24,
        }}>
          ✓
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '0 0 8px', textAlign: 'center' }}>
          You're all set, {data.providerFirstName}.
        </h1>
        <p style={{ fontSize: 15, color: '#475569', margin: '0 0 24px', textAlign: 'center' }}>
          {data.facilityName} has your {data.monthName} availability.
        </p>
        {!data.isLocked ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 8 }}>
              You can update until {formatDeadline(data.deadline)}.
            </div>
            <button
              onClick={() => setSaved(false)}
              style={{ background: 'none', border: 'none', color: '#2563EB', fontWeight: 600, fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Make changes
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#64748B' }}>Submissions are now closed.</div>
        )}
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
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  })() : ''

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background: '#2563EB', padding: '20px 24px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em' }}>SNAP</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Medical Technologies</div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 120px' }}>

        {/* ── Name / facility card ── */}
        <div style={{ background: '#fff', padding: 24, boxShadow: '0 1px 8px rgba(0,0,0,0.06)', marginBottom: 2 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>
            Hi {providerFirstName},
          </h1>
          <p style={{ fontSize: 15, color: '#475569', margin: 0 }}>
            {facilityName} is building the {monthName} {year} schedule.
          </p>
        </div>

        {/* ── Deadline banner ── */}
        {isLocked ? (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '12px 24px', fontSize: 13, fontWeight: 500 }}>
            Submissions are closed. Contact your coordinator to make changes.
          </div>
        ) : within48h ? (
          <div style={{ background: '#FED7AA', color: '#9A3412', padding: '12px 24px', fontSize: 13, fontWeight: 500 }}>
            Submit by {formatDeadline(deadline)}. You can update until then.
          </div>
        ) : (
          <div style={{ background: '#FEF3C7', color: '#92400E', padding: '12px 24px', fontSize: 13, fontWeight: 500 }}>
            Submit by {formatDeadline(deadline)}. You can update until then.
          </div>
        )}

        {/* ── Legend ── */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '14px 24px', background: '#fff', borderBottom: '1px solid #F1F5F9', marginBottom: 4 }}>
          {[
            { color: '#2563EB', label: 'Available' },
            { color: '#FEE2E2', label: 'Unavailable', border: '#DC2626' },
            { color: '#F1F5F9', label: 'Not set' },
          ].map(({ color, label, border }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: color, border: border ? `1.5px solid ${border}` : 'none' }} />
              <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* ── Calendar ── */}
        <div style={{ background: '#fff', padding: '16px 12px', marginBottom: 4 }}>
          <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
            {monthName} {year}
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DAY_ABBREVS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94A3B8', padding: '4px 0' }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const iso = padIso(year, month, day)
              const state = dayStates.get(iso) || 'unset'
              const holiday = FEDERAL_HOLIDAYS_2026[iso]
              const hasNote = !!notesByDate.get(iso)
              const isWeekend = [0, 6].includes((firstDow + idx) % 7)

              let bg, textColor, border
              if (state === 'available') {
                bg = '#2563EB'
                textColor = '#fff'
                border = 'none'
              } else if (state === 'unavailable') {
                bg = '#DC2626'
                textColor = '#fff'
                border = 'none'
              } else {
                bg = isWeekend ? '#F8FAFC' : '#F1F5F9'
                textColor = isWeekend ? '#CBD5E1' : '#94A3B8'
                border = '1.5px solid #E2E8F0'
              }

              const isSet = state === 'available' || state === 'unavailable'

              return (
                <div
                  key={iso}
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
                    minHeight: 58,
                    background: bg,
                    border,
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isLocked ? 'default' : 'pointer',
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    transition: 'transform 0.1s',
                    padding: '4px 2px',
                  }}
                >
                  {/* Day number */}
                  <div style={{ fontSize: 15, fontWeight: 600, color: textColor, lineHeight: 1 }}>
                    {day}
                  </div>

                  {/* Holiday name */}
                  {holiday && (
                    <div style={{
                      fontSize: 8,
                      color: state === 'available' ? 'rgba(255,255,255,0.7)' : '#94A3B8',
                      textAlign: 'center',
                      lineHeight: 1.1,
                      marginTop: 2,
                      maxWidth: '90%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {holiday}
                    </div>
                  )}

                  {/* Note icon — pencil on set days, filled dot if note exists */}
                  {isSet && !isLocked && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openNote(iso) }}
                      style={{
                        position: 'absolute', top: 3, right: 3,
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 11, lineHeight: 1, padding: 2,
                        color: hasNote
                          ? (state === 'available' ? '#fff' : '#fff')
                          : (state === 'available' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.5)'),
                      }}
                    >
                      {hasNote ? '📝' : '✎'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Add note hint */}
        {!isLocked && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
            Tap a day to mark available or unavailable. Tap ✎ to add a note.
          </div>
        )}
      </div>

      {/* ── Bottom sticky bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #E2E8F0',
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
        zIndex: 100,
      }}>
        <div style={{ fontSize: 13, color: '#64748B' }}>
          <strong style={{ color: '#059669' }}>{availableCount}</strong> available
          {' · '}
          <strong style={{ color: '#DC2626' }}>{unavailableCount}</strong> unavailable
        </div>
        {isLocked ? (
          <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600 }}>Submissions closed</div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!hasChanges || saving}
            style={{
              padding: '10px 22px',
              background: hasChanges && !saving ? '#2563EB' : '#CBD5E1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: hasChanges && !saving ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save & Submit'}
          </button>
        )}
      </div>

      {/* ── Note bottom sheet ── */}
      {noteOpen && (
        <>
          {/* Backdrop */}
          <div
            ref={backdropRef}
            onClick={closeNote}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
            }}
          />
          {/* Sheet */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
            background: '#fff',
            borderRadius: '16px 16px 0 0',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.15)',
            padding: '20px 24px 32px',
            transform: 'translateY(0)',
            transition: 'transform 0.25s ease',
            maxWidth: 520,
            margin: '0 auto',
          }}>
            <div style={{ width: 36, height: 4, background: '#CBD5E1', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{noteDate}</div>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
              Add a note — e.g. "Available after 10am", "Prefer Kenmore location"
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              placeholder='E.g. "Available after 10am only"'
              style={{
                width: '100%',
                border: 'none',
                borderBottom: '2px solid #E2E8F0',
                borderRadius: 0,
                fontSize: 14,
                color: '#0F172A',
                resize: 'none',
                outline: 'none',
                background: 'transparent',
                boxSizing: 'border-box',
                padding: '8px 0',
                fontFamily: 'inherit',
              }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={clearNote}
                style={{
                  flex: 1, padding: '12px', background: '#fff', border: '1px solid #E2E8F0',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#475569',
                }}
              >
                Clear note
              </button>
              <button
                onClick={saveNote}
                style={{
                  flex: 2, padding: '12px', background: '#2563EB', border: 'none',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#fff',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
