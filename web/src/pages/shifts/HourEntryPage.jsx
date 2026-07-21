import React, { useState, useEffect, useCallback } from 'react'
import { payrollAPI, facilityAPI } from '../../api.js'
import PayrollPeriodPicker from '../../components/PayrollPeriodPicker.jsx'

// ── Shared styles (match the SNAP Shifts light theme) ──────────────────────────
const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const primaryBtn = { padding: '10px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const inputStyle = { padding: '7px 9px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 13, color: '#0F172A' }
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#64748B', borderBottom: '1px solid #E2E8F0' }
const td = { padding: '5px 8px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
function defaultPeriod() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() - ((today.getDay() + 1) % 7))
  const start = new Date(end)
  start.setDate(end.getDate() - 13)
  return { start: fmtDate(start), end: fmtDate(end) }
}

export default function HourEntryPage({ onNavigate }) {
  const [period, setPeriod] = useState(defaultPeriod())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [data, setData] = useState(null) // { providers, pendingProviders }
  const [eligible, setEligible] = useState([]) // 1099 / dual roster providers
  const [addForm, setAddForm] = useState({ rosterEntryId: '', hours: '', location: '' })

  // Load eligible providers once (1099 or dual-employment) for the manual-add picker.
  useEffect(() => {
    facilityAPI.getRoster()
      .then((res) => {
        const list = Array.isArray(res) ? res : (res.roster || res.entries || [])
        setEligible(list.filter((p) => p.is1099 === true || p.dualEmployment === true))
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!period.start || !period.end) return
    setLoading(true); setError('')
    try {
      setData(await payrollAPI.getHourEntries({ periodStart: period.start, periodEnd: period.end }))
    } catch (err) {
      setError(err.message || 'Failed to load'); setData(null)
    } finally { setLoading(false) }
  }, [period.start, period.end])

  useEffect(() => { load() }, [load])

  async function run(key, fn) {
    setBusy(key); setError('')
    try { const res = await fn(); if (res?.providers) setData(res); else await load() }
    catch (err) { setError(err.message || 'Action failed') }
    finally { setBusy('') }
  }

  // Import an APNE Gusto-format 1099 payroll sheet for the selected period.
  async function importSheet(file) {
    if (!file) return
    setBusy('import'); setError('')
    try {
      const res = await payrollAPI.importPayrollSheet({ periodStart: period.start, periodEnd: period.end, file })
      setError('') // clear; show a transient note via the data reload
      await load()
      window.alert(res.message || 'Payroll sheet imported.')
    } catch (err) {
      setError(err.message || 'Import failed')
    } finally { setBusy('') }
  }

  const seed = () => run('seed', () => payrollAPI.seedHourEntries({ periodStart: period.start, periodEnd: period.end }))
  const submitAll = () => run('submit', () => payrollAPI.submitHourEntries({ periodStart: period.start, periodEnd: period.end }))
  const submitProvider = (rid) => run('submit-' + rid, () => payrollAPI.submitHourEntries({ periodStart: period.start, periodEnd: period.end, rosterEntryId: rid }))

  // Inline edit of a row's start/end (hours recompute server-side) or hours.
  async function editRow(id, patch) {
    try {
      await payrollAPI.updateHourEntry(id, patch)
      await load()
    } catch (err) { setError(err.message || 'Update failed') }
  }

  // Delete one hour entry (e.g. to fix a bad row).
  async function deleteRow(id) {
    if (!window.confirm('Delete this hour entry?')) return
    try {
      await payrollAPI.deleteHourEntry(id)
      await load()
    } catch (err) { setError(err.message || 'Delete failed') }
  }

  // Undo a bad import: clear every hour entry for the selected period.
  async function clearPeriod() {
    if (!window.confirm(`Delete ALL hour entries for ${period.start} → ${period.end}? This can't be undone.`)) return
    setBusy('clear'); setError('')
    try {
      const res = await payrollAPI.clearHourEntries({ periodStart: period.start, periodEnd: period.end })
      await load()
      window.alert(`Cleared ${res?.deleted ?? 0} hour entr${(res?.deleted ?? 0) === 1 ? 'y' : 'ies'} for this period.`)
    } catch (err) { setError(err.message || 'Clear failed') }
    finally { setBusy('') }
  }

  // Bulk manual entry — e.g. a fixed-rate 1099 line not tied to a shift (a
  // business-name contractor paid a set number of hours). Date defaults to
  // period end; blank location = facility site (billable).
  async function addManual() {
    if (!addForm.rosterEntryId || addForm.hours === '') { setError('Pick a provider and enter hours.'); return }
    setBusy('add'); setError('')
    try {
      await payrollAPI.addHourEntry({
        rosterEntryId: addForm.rosterEntryId,
        date: period.end,
        hours: Number(addForm.hours),
        location: addForm.location.trim() || null,
      })
      setAddForm({ rosterEntryId: '', hours: '', location: '' })
      await load()
    } catch (err) { setError(err.message || 'Add failed') }
    finally { setBusy('') }
  }

  const providers = data?.providers || []

  // ── Site default hours (pre-fill window for provider one-tap entry) ──────────
  const [siteDefaults, setSiteDefaults] = useState([]) // [{id, location, startTime, endTime}]
  const [siteLocations, setSiteLocations] = useState([])
  const [defaultsBusy, setDefaultsBusy] = useState('')

  const loadDefaults = useCallback(async () => {
    try {
      const res = await payrollAPI.getSiteHourDefaults()
      setSiteDefaults(res.defaults || [])
      setSiteLocations(res.locations || [])
    } catch { /* non-blocking — editor just shows empty */ }
  }, [])
  useEffect(() => { loadDefaults() }, [loadDefaults])

  async function saveDefault(location, startTime, endTime) {
    if (!location || !startTime || !endTime) { setError('Pick a location and both times.'); return }
    setDefaultsBusy(location); setError('')
    try { await payrollAPI.saveSiteHourDefault({ location, startTime, endTime }); await loadDefaults() }
    catch (err) { setError(err.message || 'Failed to save site default') }
    finally { setDefaultsBusy('') }
  }

  async function removeDefault(id) {
    setDefaultsBusy(id); setError('')
    try { await payrollAPI.deleteSiteHourDefault(id); await loadDefaults() }
    catch (err) { setError(err.message || 'Failed to delete site default') }
    finally { setDefaultsBusy('') }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '8px 4px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>⏱ Provider Hours</h1>
      <p style={{ fontSize: 14, color: '#64748B', marginTop: 6, marginBottom: 20 }}>
        Confirm worked hours for 1099 / per-diem providers before running payroll or the agency invoice.
        Seed pulls each provider's scheduled days pre-filled with the location's default shift window —
        just adjust exceptions, then submit.
      </p>

      {/* Controls */}
      <div style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap' }}>
        <PayrollPeriodPicker value={period} onChange={(p) => setPeriod(p)} />
        <button style={ghostBtn} onClick={seed} disabled={!!busy}>{busy === 'seed' ? 'Seeding…' : '↻ Seed from schedule'}</button>
        <label style={{ ...ghostBtn, display: 'inline-block', textAlign: 'center' }}>
          {busy === 'import' ? 'Importing…' : '⬆ Import payroll sheet'}
          <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; importSheet(f) }} />
        </label>
        <button style={primaryBtn} onClick={submitAll} disabled={!!busy}>{busy === 'submit' ? 'Submitting…' : '✓ Submit all'}</button>
        <button style={{ ...ghostBtn, color: '#DC2626', borderColor: '#FECACA' }} onClick={clearPeriod} disabled={!!busy} title="Delete all hour entries for this period (undo a bad import)">{busy === 'clear' ? 'Clearing…' : '🗑 Clear period'}</button>
      </div>

      {error && <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#B91C1C', marginBottom: 18 }}>{error}</div>}

      {data && data.pendingProviders > 0 && (
        <div style={{ ...card, borderColor: '#FCD34D', background: '#FFFBEB', color: '#92400E', marginBottom: 18, fontSize: 14 }}>
          ⚠️ {data.pendingProviders} provider{data.pendingProviders !== 1 ? 's have' : ' has'} unsubmitted hours.
          Payroll and the agency invoice only count <strong>submitted</strong> hours.
        </div>
      )}

      {/* Bulk manual entry — for fixed-rate 1099 hours not tied to a shift. */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Add manual 1099 hours</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
            Provider (1099 / dual)
            <select style={{ ...inputStyle, minWidth: 200 }} value={addForm.rosterEntryId} onChange={(e) => setAddForm((f) => ({ ...f, rosterEntryId: e.target.value }))}>
              <option value="">— Select —</option>
              {eligible.map((p) => <option key={p.id} value={p.id}>{p.providerName}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
            Hours
            <input style={{ ...inputStyle, width: 90 }} type="number" step="0.25" min="0" value={addForm.hours} onChange={(e) => setAddForm((f) => ({ ...f, hours: e.target.value }))} placeholder="e.g. 76" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
            Location (blank = facility site)
            <input style={{ ...inputStyle, width: 150 }} value={addForm.location} onChange={(e) => setAddForm((f) => ({ ...f, location: e.target.value }))} placeholder="optional" />
          </label>
          <button style={ghostBtn} onClick={addManual} disabled={!!busy}>{busy === 'add' ? 'Adding…' : '+ Add line'}</button>
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>
          Adds a draft line dated to the period end — adjust hours, then Submit. Blank location bills to the facility; an external (agency) site is excluded from the invoice.
        </div>
      </div>

      {/* Site default hours — the pre-filled window providers see when they
          one-tap confirm a day from the app. */}
      <SiteDefaultsEditor
        defaults={siteDefaults}
        locations={siteLocations}
        busy={defaultsBusy}
        onSave={saveDefault}
        onDelete={removeDefault}
      />

      {loading && <div style={{ color: '#64748B', fontSize: 14 }}>Loading…</div>}

      {!loading && providers.length === 0 && (
        <div style={{ ...card, color: '#64748B', textAlign: 'center' }}>
          No hours yet for this period. Click <strong>Seed from schedule</strong> to pull scheduled days,
          or add days manually once providers are scheduled.
        </div>
      )}

      {!loading && providers.map((p) => (
        <div key={p.rosterEntryId} style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{p.providerName}</span>
              <span style={{ marginLeft: 10, fontSize: 12, color: '#64748B' }}>
                {p.submittedHours} submitted / {p.totalHours} total hrs
                {p.pendingCount > 0 && <span style={{ color: '#B45309', fontWeight: 700 }}> · {p.pendingCount} pending</span>}
              </span>
            </div>
            {p.pendingCount > 0 && (
              <button style={ghostBtn} onClick={() => submitProvider(p.rosterEntryId)} disabled={!!busy}>
                {busy === 'submit-' + p.rosterEntryId ? 'Submitting…' : 'Submit provider'}
              </button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Location</th>
                <th style={th}>Start</th>
                <th style={th}>End</th>
                <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.date}</td>
                  <td style={td}>{r.location || '—'}</td>
                  <td style={td}>
                    <input style={{ ...inputStyle, width: 90 }} type="time" defaultValue={r.startTime || ''}
                      onBlur={(e) => e.target.value !== (r.startTime || '') && editRow(r.id, { startTime: e.target.value })} />
                  </td>
                  <td style={td}>
                    <input style={{ ...inputStyle, width: 90 }} type="time" defaultValue={r.endTime || ''}
                      onBlur={(e) => e.target.value !== (r.endTime || '') && editRow(r.id, { endTime: e.target.value })} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <input style={{ ...inputStyle, width: 64, textAlign: 'right' }} type="number" step="0.25" min="0" defaultValue={r.hours}
                      onBlur={(e) => Number(e.target.value) !== r.hours && editRow(r.id, { hours: Number(e.target.value) })} />
                  </td>
                  <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: r.status === 'SUBMITTED' ? '#DCFCE7' : '#FEF9C3',
                      color: r.status === 'SUBMITTED' ? '#166534' : '#854D0E' }}>
                      {r.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}
                    </span>
                    {r.enteredBy === 'provider' && (
                      <span title="Confirmed by the provider from the app" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                        provider ✓
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      onClick={() => deleteRow(r.id)}
                      title="Delete this hour entry"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 15, lineHeight: 1, padding: 4 }}
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Bottom Submit-all so you don't scroll back up after reviewing. */}
      {!loading && providers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={primaryBtn} onClick={submitAll} disabled={!!busy}>
            {busy === 'submit' ? 'Submitting…' : '✓ Submit all'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Site default hours editor ──────────────────────────────────────────────────
// Compact per-location default shift window (start/end). These pre-fill the
// provider's one-tap "Confirm hours" cards in the app. Locations come from the
// coverage templates + recent schedule days; sites without a default fall back
// to provider history → coverage-template window → 07:00–15:00.
function SiteDefaultsEditor({ defaults, locations, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState({}) // location → { startTime, endTime }
  const [addLoc, setAddLoc] = useState('')

  const defaultByLoc = Object.fromEntries(defaults.map((d) => [d.location, d]))
  const undefaulted = locations.filter((l) => !defaultByLoc[l])
  const valOf = (loc, field) => draft[loc]?.[field] ?? defaultByLoc[loc]?.[field] ?? ''
  const setVal = (loc, field, v) => setDraft((d) => ({ ...d, [loc]: { ...d[loc], [field]: v } }))
  const dirty = (loc) => {
    const d = draft[loc]
    if (!d) return false
    const cur = defaultByLoc[loc]
    return (d.startTime !== undefined && d.startTime !== (cur?.startTime || '')) ||
      (d.endTime !== undefined && d.endTime !== (cur?.endTime || ''))
  }

  const rows = [...defaults.map((d) => d.location), ...(addLoc && !defaultByLoc[addLoc] ? [addLoc] : [])]

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Site default hours</div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
        The pre-filled shift window providers see when they confirm a day from the app. One tap submits these times.
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>No site defaults yet — pick a location below to add one.</div>
      )}
      {rows.map((loc) => (
        <div key={loc} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', minWidth: 160 }}>{loc}</span>
          <input style={{ ...inputStyle, width: 100 }} type="time" value={valOf(loc, 'startTime')}
            onChange={(e) => setVal(loc, 'startTime', e.target.value)} />
          <span style={{ fontSize: 12, color: '#94A3B8' }}>–</span>
          <input style={{ ...inputStyle, width: 100 }} type="time" value={valOf(loc, 'endTime')}
            onChange={(e) => setVal(loc, 'endTime', e.target.value)} />
          {(dirty(loc) || !defaultByLoc[loc]) && (
            <button style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }} disabled={!!busy}
              onClick={() => { onSave(loc, valOf(loc, 'startTime'), valOf(loc, 'endTime')); setDraft((d) => { const n = { ...d }; delete n[loc]; return n }); if (addLoc === loc) setAddLoc('') }}>
              {busy === loc ? 'Saving…' : 'Save'}
            </button>
          )}
          {defaultByLoc[loc] && (
            <button
              onClick={() => onDelete(defaultByLoc[loc].id)}
              title="Remove this site default"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 14, lineHeight: 1, padding: 4 }}
            >🗑</button>
          )}
        </div>
      ))}
      {undefaulted.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <select style={{ ...inputStyle, minWidth: 200 }} value={addLoc} onChange={(e) => setAddLoc(e.target.value)}>
            <option value="">+ Add default for a site…</option>
            {undefaulted.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
