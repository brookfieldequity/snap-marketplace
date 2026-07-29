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
  const [editing, setEditing] = useState(null)   // existing entry being edited, or null for add
  const [uploadOpen, setUploadOpen] = useState(false)
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
    setEditing(null)
    setForm({ rosterId: prefill.rosterId || '', start: prefill.start || monthStart, end: prefill.end || prefill.start || monthStart, reason: '' })
    setAddOpen(true)
  }
  // Open an existing entry for edit/delete (calendar cell or list chip click).
  function openEdit(entry) {
    setEditing(entry)
    setForm({ rosterId: entry.rosterEntryId, start: entry.startDate, end: entry.endDate, reason: entry.reason || '' })
    setAddOpen(true)
  }
  // Calendar cell click: an existing PTO day opens that entry; an empty day
  // starts a new one prefilled to that person + date.
  function onCalendarCell(rosterId, day) {
    const clicked = iso(year, month, day)
    const existing = (byMember[rosterId] || []).find(t => clicked >= t.startDate && clicked <= t.endDate)
    if (existing) openEdit(existing)
    else openAdd({ rosterId, start: clicked })
  }
  async function submitAdd() {
    if (!form.rosterId || !form.start) return alert('Pick a person and a start date.')
    setSaving(true)
    try {
      const body = { startDate: form.start, endDate: form.end || form.start, reason: form.reason || null }
      if (editing) await facilityAPI.updateTimeOff(editing.id, body)
      else await facilityAPI.addTimeOff(form.rosterId, body)
      setAddOpen(false); setEditing(null); await load()
    } catch (e) { alert(e.message || (editing ? 'Could not update PTO' : 'Could not add PTO')) } finally { setSaving(false) }
  }
  async function removeRange(id) {
    if (!window.confirm('Remove this time-off range?')) return
    try { await facilityAPI.deleteTimeOff(id); await load() } catch (e) { alert(e.message) }
  }
  async function removeFromModal() {
    if (!editing) return
    if (!window.confirm('Remove this time-off range?')) return
    setSaving(true)
    try {
      await facilityAPI.deleteTimeOff(editing.id)
      setAddOpen(false); setEditing(null); await load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
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
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button onClick={() => setUploadOpen(true)} style={{ ...ghostBtn, padding: '10px 16px', fontSize: 14 }}>⬆ Upload spreadsheet</button>
              <button onClick={() => openAdd()} style={primaryBtn}>+ Add PTO</button>
            </div>
          </div>

          {uploadOpen && (
            <UploadPtoModal
              roster={roster}
              year={year}
              onClose={() => setUploadOpen(false)}
              onImported={async () => { await load() }}
            />
          )}

          {/* Add / Edit PTO — centered overlay so it's visible no matter where you scrolled */}
          {addOpen && (
            <div onClick={() => { setAddOpen(false); setEditing(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(15,23,42,0.28)' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 16 }}>{editing ? `Edit PTO — ${nameById[form.rosterId] || ''}` : 'Add PTO'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {!editing && (
                    <Field label="Person">
                      <select value={form.rosterId} onChange={e => setForm(f => ({ ...f, rosterId: e.target.value }))} style={{ ...ctrl, width: '100%' }}>
                        <option value="">Select…</option>
                        {roster.map(p => <option key={p.id} value={p.id}>{p.providerName}</option>)}
                      </select>
                    </Field>
                  )}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Field label="First day"><input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value, end: f.end && f.end >= e.target.value ? f.end : e.target.value }))} style={{ ...ctrl, width: '100%' }} /></Field>
                    <Field label="Last day"><input type="date" value={form.end} min={form.start} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} style={{ ...ctrl, width: '100%' }} /></Field>
                  </div>
                  <Field label="Reason (optional)"><input value={form.reason} placeholder="Vacation, CME…" onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...ctrl, width: '100%' }} /></Field>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 22 }}>
                  {editing && (
                    <button onClick={removeFromModal} disabled={saving} style={{ ...ghostBtn, color: '#DC2626', borderColor: '#FECACA' }}>Remove</button>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                    <button onClick={() => { setAddOpen(false); setEditing(null) }} style={ghostBtn}>Cancel</button>
                    <button onClick={submitAdd} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add PTO'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ color: MUTED, textAlign: 'center', padding: '48px 0' }}>Loading…</div>
          ) : manageView === 'calendar' ? (
            <CalendarView roster={roster} year={year} month={month} daysInMonth={daysInMonth} offCells={offCells} byMember={byMember} onCell={onCalendarCell} />
          ) : (
            <ListView members={membersWithPto} byMember={byMember} typeById={typeById} onAdd={(rosterId) => openAdd({ rosterId })} onEdit={openEdit} onRemove={removeRange} />
          )}
        </>
      )}
    </div>
  )
}

// ── Upload spreadsheet → preview & match → import ──────────────────────────────
// The org's existing PTO workbook (range list or name × dates grid, any tabs)
// is parsed server-side into per-person ranges with fuzzy roster matching.
// Nothing is written until the coordinator confirms the preview; unmatched
// names can be remapped (or skipped) right in the table.
function UploadPtoModal({ roster, year, onClose, onImported }) {
  const [step, setStep] = useState('pick')      // 'pick' | 'preview' | 'done'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)  // { rows, warnings, summary }
  const [picks, setPicks] = useState({})        // sourceName -> rosterId | '' (skip)
  const [result, setResult] = useState(null)    // { created, skipped }
  const fileRef = React.useRef(null)

  async function handleFile(file) {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const res = await facilityAPI.uploadPtoSheet(file, year)
      setPreview(res)
      setPicks(Object.fromEntries(res.rows.map(r => [r.sourceName, r.rosterId || ''])))
      setStep('preview')
    } catch (e) {
      setError(e.message || 'Could not read that spreadsheet.')
    } finally { setBusy(false) }
  }

  const rows = preview?.rows || []
  const entries = rows.flatMap(r => {
    const rosterId = picks[r.sourceName]
    if (!rosterId) return []
    return r.ranges.filter(x => !x.duplicate).map(x => ({ rosterId, startDate: x.startDate, endDate: x.endDate, reason: x.reason }))
  })
  const skippedPeople = rows.filter(r => !picks[r.sourceName]).length
  const dupCount = rows.reduce((s, r) => s + (picks[r.sourceName] ? r.ranges.filter(x => x.duplicate).length : 0), 0)

  async function handleImport() {
    setBusy(true); setError(null)
    try {
      const res = await facilityAPI.importTimeOff(entries)
      setResult(res)
      setStep('done')
      await onImported()
    } catch (e) {
      setError(e.message || 'Import failed.')
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: step === 'preview' ? 760 : 480, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(15,23,42,0.28)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
          {step === 'done' ? 'PTO imported ✓' : 'Upload PTO spreadsheet'}
        </div>

        {step === 'pick' && (
          <>
            <p style={{ fontSize: 13.5, color: SLATE, lineHeight: 1.55, margin: '6px 0 16px' }}>
              Already have this year's PTO in a spreadsheet? Upload it and we'll read it — either
              <strong> one row per PTO range</strong> (Name / Start / End columns) or a
              <strong> grid</strong> with names down the side and dates across the top (monthly tabs are fine).
              You'll review every match before anything is saved.
            </p>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
              style={{ border: `2px dashed ${LINE}`, borderRadius: 12, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', background: '#F8FAFC' }}
            >
              {busy ? (
                <div style={{ color: SLATE, fontWeight: 700 }}>Reading spreadsheet…</div>
              ) : (
                <>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY }}>Drop your file here or click to browse</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>.xlsx, .xls, or .csv — up to 5&nbsp;MB</div>
                </>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
            </div>
            {error && <div style={{ marginTop: 12, fontSize: 13, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
            </div>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <p style={{ fontSize: 13, color: SLATE, margin: '4px 0 12px' }}>
              Found <strong>{preview.summary.ranges}</strong> PTO range{preview.summary.ranges === 1 ? '' : 's'} for <strong>{preview.summary.people}</strong> {preview.summary.people === 1 ? 'person' : 'people'}. Check the matches, fix any with the dropdowns, then import.
            </p>
            {preview.warnings?.length > 0 && (
              <div style={{ fontSize: 12, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <div style={{ overflow: 'auto', border: `1px solid ${LINE}`, borderRadius: 10, flex: 1, minHeight: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
                    <th style={th}>In spreadsheet</th>
                    <th style={th}>Roster member</th>
                    <th style={th}>PTO ranges</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const picked = picks[r.sourceName]
                    return (
                      <tr key={r.sourceName} style={{ borderTop: `1px solid ${LINE}`, background: picked ? '#fff' : '#FAFAFA' }}>
                        <td style={{ ...td, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>
                          {r.sourceName}
                          {!r.rosterId && <div style={{ fontSize: 11, color: '#B91C1C', fontWeight: 600 }}>no confident match</div>}
                        </td>
                        <td style={td}>
                          <select value={picked} onChange={e => setPicks(p => ({ ...p, [r.sourceName]: e.target.value }))} style={{ ...ctrl, padding: '6px 8px', fontSize: 12.5, maxWidth: 200 }}>
                            <option value="">— skip this person —</option>
                            {roster.map(p => <option key={p.id} value={p.id}>{p.providerName}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {r.ranges.map((x, i) => (
                              <span key={i} style={{ fontSize: 11.5, background: x.duplicate ? '#F1F5F9' : AMBER_BG, border: `1px solid ${x.duplicate ? LINE : AMBER}`, color: x.duplicate ? MUTED : AMBER_INK, borderRadius: 6, padding: '3px 7px', textDecoration: x.duplicate ? 'line-through' : 'none' }}>
                                {fmtRange({ startDate: x.startDate, endDate: x.endDate })}{x.reason ? ` · ${x.reason}` : ''}{x.duplicate ? ' (already entered)' : ''}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {error && <div style={{ marginTop: 10, fontSize: 13, color: '#B91C1C' }}>{error}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <div style={{ fontSize: 12, color: MUTED }}>
                {skippedPeople > 0 && <span>{skippedPeople} person{skippedPeople === 1 ? '' : 's'} will be skipped. </span>}
                {dupCount > 0 && <span>{dupCount} duplicate range{dupCount === 1 ? '' : 's'} won't be re-added.</span>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                <button onClick={() => { setStep('pick'); setPreview(null); setError(null) }} style={ghostBtn}>Back</button>
                <button onClick={handleImport} disabled={busy || entries.length === 0} style={{ ...primaryBtn, opacity: busy || entries.length === 0 ? 0.6 : 1 }}>
                  {busy ? 'Importing…' : `Import ${entries.length} range${entries.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <p style={{ fontSize: 14, color: SLATE, lineHeight: 1.6, margin: '8px 0 4px' }}>
              <strong style={{ color: NAVY }}>{result.created}</strong> PTO range{result.created === 1 ? '' : 's'} added{result.skipped > 0 ? ` (${result.skipped} already entered — skipped)` : ''}.
            </p>
            <p style={{ fontSize: 13, color: SLATE, lineHeight: 1.6, margin: '4px 0 0' }}>
              This calendar is the source of truth — the imported PTO is now live in the providers' own
              availability calendars, the Schedule Builder (they're held out of coverage automatically),
              and the schedule day editor.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 800, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.04em' }
const td = { padding: '9px 12px', verticalAlign: 'top' }

// ── Calendar: roster (rows) × days (cols) ──────────────────────────────────────
function CalendarView({ roster, year, month, daysInMonth, offCells, byMember, onCell }) {
  if (roster.length === 0) return <Empty>No roster members yet.</Empty>
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const dowOf = (d) => new Date(Date.UTC(year, month - 1, d)).getUTCDay()
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'auto', background: '#fff', maxHeight: 'calc(100vh - 250px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${daysInMonth}, 30px)`, minWidth: 180 + daysInMonth * 30 }}>
        {/* Header — frozen at top so day numbers stay visible while scrolling providers */}
        <div style={{ ...cellBase, position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#F8FAFC', fontWeight: 800, color: SLATE, justifyContent: 'flex-start', paddingLeft: 14, borderBottom: `1px solid ${LINE}` }}>Provider</div>
        {days.map(d => {
          const wknd = dowOf(d) === 0 || dowOf(d) === 6
          return (
            <div key={d} style={{ ...cellBase, position: 'sticky', top: 0, zIndex: 2, flexDirection: 'column', gap: 0, background: wknd ? '#F1F5F9' : '#F8FAFC', color: wknd ? MUTED : SLATE, borderBottom: `1px solid ${LINE}`, fontSize: 10 }}>
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
                  title={off ? 'On PTO — click to edit or remove' : 'Click to add PTO'}
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
function ListView({ members, byMember, typeById, onAdd, onEdit, onRemove }) {
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
                <span onClick={() => onEdit(r)} title="Click to edit" style={{ cursor: 'pointer' }}>
                  <strong>{fmtRange(r)}</strong>{r.reason ? <span style={{ color: '#92826A' }}> · {r.reason}</span> : null}
                </span>
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
