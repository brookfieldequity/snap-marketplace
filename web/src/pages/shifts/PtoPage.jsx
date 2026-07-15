import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { facilityAPI } from '../../api.js'
import PtoBuilderPage from './PtoBuilderPage.jsx'

// The everyday PTO tab: enter, see, and adjust already-decided time off across
// the whole roster (Calendar overview + List entry), with the ranked PTO
// Builder tucked inside as the occasional allocation view.

const NAVY = '#0F172A', ROYAL = '#2563EB', SLATE = '#475569', MUTED = '#94A3B8', LINE = '#E2E8F0'
const AMBER = '#FDE68A', AMBER_BG = '#FFFBEB', AMBER_INK = '#B45309'
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const dISO = (v) => (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10))

export default function PtoPage({ onNavigate, featureFlags = {} }) {
  const [view, setView] = useState('manage')          // 'manage' | 'builder'
  const [manageView, setManageView] = useState('calendar') // 'calendar' | 'list'
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [roster, setRoster] = useState([])
  const [timeOff, setTimeOff] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ rosterId: '', start: '', end: '', reason: '' })
  const [saving, setSaving] = useState(false)

  const monthStart = iso(year, month, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthEnd = iso(year, month, daysInMonth)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, t] = await Promise.all([
        facilityAPI.getRoster(),
        facilityAPI.getTimeOff(monthStart, monthEnd),
      ])
      setRoster(Array.isArray(r) ? r : r.roster || [])
      setTimeOff((t.timeOff || []).map(x => ({ ...x, startDate: dISO(x.startDate), endDate: dISO(x.endDate) })))
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [monthStart, monthEnd])
  useEffect(() => { load() }, [load])

  const nameById = useMemo(() => Object.fromEntries(roster.map(p => [p.id, p.providerName])), [roster])
  const typeById = useMemo(() => Object.fromEntries(roster.map(p => [p.id, p.providerType])), [roster])

  // rosterEntryId -> array of {id, start, end, reason} overlapping the month
  const byMember = useMemo(() => {
    const m = {}
    for (const t of timeOff) (m[t.rosterEntryId] = m[t.rosterEntryId] || []).push(t)
    return m
  }, [timeOff])

  // Set of `${rosterEntryId}|${dayNum}` that are off this month
  const offCells = useMemo(() => {
    const s = new Set()
    for (const t of timeOff) {
      for (let d = 1; d <= daysInMonth; d++) {
        const day = iso(year, month, d)
        if (day >= t.startDate && day <= t.endDate) s.add(`${t.rosterEntryId}|${d}`)
      }
    }
    return s
  }, [timeOff, year, month, daysInMonth])

  function shiftMonth(delta) {
    let m = month + delta, y = year
    if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ }
    setMonth(m); setYear(y)
  }
  function openAdd(prefill = {}) {
    setForm({ rosterId: prefill.rosterId || '', start: prefill.start || monthStart, end: prefill.end || prefill.start || monthStart, reason: '' })
    setAddOpen(true)
  }
  async function submitAdd() {
    if (!form.rosterId || !form.start) return alert('Pick a person and a start date.')
    setSaving(true)
    try {
      await facilityAPI.addTimeOff(form.rosterId, { startDate: form.start, endDate: form.end || form.start, reason: form.reason || null })
      setAddOpen(false); await load()
    } catch (e) { alert(e.message || 'Could not add PTO') } finally { setSaving(false) }
  }
  async function removeRange(id) {
    if (!window.confirm('Remove this time-off range?')) return
    try { await facilityAPI.deleteTimeOff(id); await load() } catch (e) { alert(e.message) }
  }

  const showBuilder = !!featureFlags.pto_builder
  const membersWithPto = roster.filter(p => (byMember[p.id] || []).length > 0)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Header + top-level toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 25, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: '-0.02em' }}>🌴 PTO</h1>
          <p style={{ fontSize: 14, color: SLATE, margin: '6px 0 0', maxWidth: 620, lineHeight: 1.5 }}>
            Enter and adjust known time off across the roster. Everything here feeds the Schedule Builder — people on PTO are held out of coverage automatically.
          </p>
        </div>
        {showBuilder && (
          <Segmented value={view} onChange={setView} options={[{ v: 'manage', label: 'Manage PTO' }, { v: 'builder', label: 'PTO Builder' }]} />
        )}
      </div>

      {view === 'builder' && showBuilder ? (
        <PtoBuilderPage onNavigate={onNavigate} />
      ) : (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
              <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, minWidth: 150, textAlign: 'center' }}>{MONTHS[month]} {year}</div>
              <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
            </div>
            <Segmented value={manageView} onChange={setManageView} options={[{ v: 'calendar', label: 'Calendar' }, { v: 'list', label: 'List' }]} />
            <button onClick={() => openAdd()} style={{ ...primaryBtn, marginLeft: 'auto' }}>+ Add PTO</button>
          </div>

          {/* Add panel */}
          {addOpen && (
            <div style={{ border: `1px solid ${ROYAL}`, background: '#F5F9FF', borderRadius: 12, padding: 16, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Person">
                <select value={form.rosterId} onChange={e => setForm(f => ({ ...f, rosterId: e.target.value }))} style={ctrl}>
                  <option value="">Select…</option>
                  {roster.map(p => <option key={p.id} value={p.id}>{p.providerName}</option>)}
                </select>
              </Field>
              <Field label="First day"><input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value, end: f.end && f.end >= e.target.value ? f.end : e.target.value }))} style={ctrl} /></Field>
              <Field label="Last day"><input type="date" value={form.end} min={form.start} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} style={ctrl} /></Field>
              <Field label="Reason (optional)"><input value={form.reason} placeholder="Vacation, CME…" onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...ctrl, width: 160 }} /></Field>
              <button onClick={submitAdd} disabled={saving} style={primaryBtn}>{saving ? 'Adding…' : 'Add'}</button>
              <button onClick={() => setAddOpen(false)} style={ghostBtn}>Cancel</button>
            </div>
          )}

          {loading ? (
            <div style={{ color: MUTED, textAlign: 'center', padding: '48px 0' }}>Loading…</div>
          ) : manageView === 'calendar' ? (
            <CalendarView roster={roster} year={year} month={month} daysInMonth={daysInMonth} offCells={offCells} byMember={byMember} onCell={(rosterId, day) => openAdd({ rosterId, start: iso(year, month, day) })} />
          ) : (
            <ListView members={membersWithPto} byMember={byMember} typeById={typeById} onAdd={(rosterId) => openAdd({ rosterId })} onRemove={removeRange} />
          )}
        </>
      )}
    </div>
  )
}

// ── Calendar: roster (rows) × days (cols) ──────────────────────────────────────
function CalendarView({ roster, year, month, daysInMonth, offCells, byMember, onCell }) {
  if (roster.length === 0) return <Empty>No roster members yet.</Empty>
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const dowOf = (d) => new Date(Date.UTC(year, month - 1, d)).getUTCDay()
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'auto', background: '#fff' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${daysInMonth}, 30px)`, minWidth: 180 + daysInMonth * 30 }}>
        {/* Header */}
        <div style={{ ...cellBase, position: 'sticky', left: 0, zIndex: 2, background: '#F8FAFC', fontWeight: 800, color: SLATE, justifyContent: 'flex-start', paddingLeft: 14, borderBottom: `1px solid ${LINE}` }}>Provider</div>
        {days.map(d => {
          const wknd = dowOf(d) === 0 || dowOf(d) === 6
          return (
            <div key={d} style={{ ...cellBase, flexDirection: 'column', gap: 0, background: wknd ? '#F1F5F9' : '#F8FAFC', color: wknd ? MUTED : SLATE, borderBottom: `1px solid ${LINE}`, fontSize: 10 }}>
              <span style={{ fontWeight: 700 }}>{d}</span>
              <span style={{ fontSize: 8, color: MUTED }}>{DOW[dowOf(d)]}</span>
            </div>
          )
        })}
        {/* Rows */}
        {roster.map(p => (
          <React.Fragment key={p.id}>
            <div style={{ ...cellBase, position: 'sticky', left: 0, zIndex: 1, background: '#fff', justifyContent: 'space-between', padding: '0 10px 0 14px', borderBottom: `1px solid ${LINE}`, gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.providerName}</span>
              <span style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap' }}>{(byMember[p.id] || []).reduce((s, r) => s + rangeDays(r, year, month), 0) || ''}</span>
            </div>
            {days.map(d => {
              const off = offCells.has(`${p.id}|${d}`)
              const wknd = dowOf(d) === 0 || dowOf(d) === 6
              return (
                <div
                  key={d}
                  onClick={() => onCell(p.id, d)}
                  title={off ? 'On PTO — click to add another range' : 'Click to add PTO'}
                  style={{ ...cellBase, cursor: 'pointer', borderBottom: `1px solid ${LINE}`, background: off ? AMBER : (wknd ? '#F8FAFC' : '#fff'), transition: 'background 0.1s' }}
                >{off ? <span style={{ fontSize: 11 }}>🌴</span> : ''}</div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── List: grouped by member, range entry ───────────────────────────────────────
function ListView({ members, byMember, typeById, onAdd, onRemove }) {
  if (members.length === 0) return <Empty>No PTO entered for this month yet. Use “+ Add PTO” to enter it.</Empty>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {members.map(p => (
        <div key={p.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>
              {p.providerName}
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}> · {typeById[p.id] === 'ANESTHESIOLOGIST' ? 'MD' : typeById[p.id] === 'CRNA' ? 'CRNA' : (typeById[p.id] || '')}</span>
            </div>
            <button onClick={() => onAdd(p.id)} style={ghostBtn}>+ Add range</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(byMember[p.id] || []).sort((a, b) => a.startDate.localeCompare(b.startDate)).map(r => (
              <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 8, padding: '6px 8px 6px 11px', fontSize: 13, color: AMBER_INK }}>
                <strong>{fmtRange(r)}</strong>{r.reason ? <span style={{ color: '#92826A' }}>· {r.reason}</span> : null}
                <button onClick={() => onRemove(r.id)} aria-label="Remove" style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────
function rangeDays(r, year, month) {
  const dim = new Date(year, month, 0).getDate()
  let n = 0
  for (let d = 1; d <= dim; d++) { const day = iso(year, month, d); if (day >= r.startDate && day <= r.endDate) n++ }
  return n
}
function fmtRange(r) {
  const f = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return r.startDate === r.endDate ? f(r.startDate) : `${f(r.startDate)} → ${f(r.endDate)}`
}
function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 10, padding: 3, gap: 3 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{ padding: '7px 16px', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', background: value === o.v ? '#fff' : 'transparent', color: value === o.v ? ROYAL : SLATE, boxShadow: value === o.v ? '0 1px 3px rgba(15,23,42,0.12)' : 'none' }}>{o.label}</button>
      ))}
    </div>
  )
}
function Field({ label, children }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>{children}</label>
}
function Empty({ children }) {
  return <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>{children}</div>
}

const cellBase = { height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const navBtn = { padding: '7px 13px', background: '#F8FAFC', border: `1px solid ${LINE}`, borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }
const ctrl = { fontSize: 14, fontWeight: 600, color: NAVY, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px', background: '#fff' }
const primaryBtn = { padding: '10px 18px', background: ROYAL, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { padding: '7px 13px', background: '#fff', color: ROYAL, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
