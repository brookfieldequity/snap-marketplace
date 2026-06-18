import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { facilityAPI } from '../../api.js'

// Read-only monthly digest of everything providers have told the facility for a
// given month: schedule requests (day off / wants to work) AND per-date
// availability notes (from the Set Availability screen + the provider app).
// Helps the coordinator plan a schedule build at a glance. Approvals still live
// on the "Provider Requests" page.

const TYPE_STYLE = {
  DAY_OFF: { bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5', label: 'Day off' },
  WORK:    { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Wants to work' },
}
const STATUS_STYLE = {
  PENDING:  { bg: '#FEFCE8', color: '#A16207', label: 'Pending' },
  ACCEPTED: { bg: '#F0FDF4', color: '#15803D', label: 'Accepted' },
  DECLINED: { bg: '#FEF2F2', color: '#B91C1C', label: 'Declined' },
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtNoteDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function monthKey(y, m0) { return `${y}-${String(m0 + 1).padStart(2, '0')}` }

export default function RequestsNotesPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month0, setMonth0] = useState(now.getMonth())
  const [requests, setRequests] = useState([])
  const [avail, setAvail] = useState({ members: [], overrides: {} })
  const [loading, setLoading] = useState(true)

  const mk = monthKey(year, month0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reqRes, availRes] = await Promise.all([
        facilityAPI.getScheduleRequests(),
        facilityAPI.getRosterAvailability(mk),
      ])
      setRequests(reqRes?.requests || [])
      setAvail({ members: availRes?.members || [], overrides: availRes?.overrides || {} })
    } catch {
      setRequests([]); setAvail({ members: [], overrides: {} })
    } finally {
      setLoading(false)
    }
  }, [mk])

  useEffect(() => { load() }, [load])

  function prevMonth() { if (month0 === 0) { setYear((y) => y - 1); setMonth0(11) } else setMonth0((m) => m - 1) }
  function nextMonth() { if (month0 === 11) { setYear((y) => y + 1); setMonth0(0) } else setMonth0((m) => m + 1) }

  // Schedule requests falling in the selected month.
  const monthRequests = useMemo(() => requests
    .filter((r) => { const d = new Date(r.date); return d.getFullYear() === year && d.getMonth() === month0 })
    .sort((a, b) => new Date(a.date) - new Date(b.date)),
  [requests, year, month0])

  // Availability notes for the month (only days that carry a note).
  const notes = useMemo(() => {
    const nameById = {}
    for (const m of avail.members) nameById[m.rosterEntryId] = m.name
    const out = []
    for (const [rid, byDate] of Object.entries(avail.overrides || {})) {
      for (const [date, ov] of Object.entries(byDate)) {
        if (ov && ov.note) out.push({ name: nameById[rid] || 'Provider', date, available: ov.available, source: ov.source, note: ov.note })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [avail])

  const navBtn = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, width: 34, height: 34, fontSize: 18, fontWeight: 800, color: '#2563EB', cursor: 'pointer' }
  const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }
  const pill = (st) => ({ background: st.bg, color: st.color, border: st.border ? `1px solid ${st.border}` : 'none', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 })

  return (
    <div style={{ padding: '32px 40px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0F172A', margin: 0 }}>Requests &amp; Notes</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', minWidth: 150, textAlign: 'center' }}>{MONTHS[month0]} {year}</span>
          <button onClick={nextMonth} style={navBtn}>›</button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>
        Everything providers have flagged for this month — time-off / work requests and availability notes — in one place for schedule planning.
      </p>

      {loading && <div style={{ textAlign: 'center', padding: '50px 0', color: '#94A3B8' }}>Loading…</div>}

      {!loading && (
        <>
          {/* ── Requests ── */}
          <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 12px' }}>
            Requests ({monthRequests.length})
          </div>
          {monthRequests.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No day-off or work requests this month.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {monthRequests.map((r) => {
                const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
                const s = STATUS_STYLE[r.status] || STATUS_STYLE.PENDING
                return (
                  <div key={r.id} style={card}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
                      <span style={pill(t)}>{t.label}</span>
                      <span style={pill(s)}>{s.label}</span>
                      <span style={{ fontSize: 13, color: '#475569' }}><strong>{fmtDate(r.date)}</strong>
                        {r.rosterEntry?.providerType ? <span style={{ color: '#94A3B8' }}> · {r.rosterEntry.providerType}</span> : null}
                        {r.siteName ? <span style={{ color: '#94A3B8' }}> · {r.siteName}</span> : null}
                      </span>
                    </div>
                    {r.note && <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, fontStyle: 'italic' }}>“{r.note}”</div>}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Availability notes ── */}
          <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '26px 0 12px' }}>
            Availability notes ({notes.length})
          </div>
          {notes.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No availability notes this month.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map((n, i) => (
                <div key={`${n.name}-${n.date}-${i}`} style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{n.name}</span>
                    <span style={pill(n.available
                      ? { bg: '#F0FDF4', color: '#15803D' }
                      : { bg: '#FEF2F2', color: '#B91C1C' })}>{n.available ? 'Available' : 'Unavailable'}</span>
                    <span style={{ fontSize: 13, color: '#475569' }}><strong>{fmtNoteDate(n.date)}</strong>
                      <span style={{ color: '#94A3B8' }}> · {n.source === 'PROVIDER' ? 'from provider' : n.source === 'ADMIN' ? 'set by admin' : n.source === 'PTO' ? 'PTO' : ''}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, fontStyle: 'italic' }}>“{n.note}”</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
