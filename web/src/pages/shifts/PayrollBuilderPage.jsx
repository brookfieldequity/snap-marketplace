import React, { useState, useEffect, useCallback } from 'react'
import { payrollAPI } from '../../api.js'
import PayrollPeriodPicker from '../../components/PayrollPeriodPicker.jsx'

// ── Shared styles (match the SNAP Shifts light theme) ──────────────────────────
const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const primaryBtn = { padding: '10px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const disabledBtn = { ...primaryBtn, background: '#CBD5E1', cursor: 'not-allowed' }
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A' }

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// Client-side gross, mirrors backend computeGross (server recomputes on export).
function clientGross({ regularHours, otHours, hourlyRate, annualRate }) {
  if (hourlyRate != null && hourlyRate !== '') {
    return Number(regularHours || 0) * Number(hourlyRate) + Number(otHours || 0) * Number(hourlyRate) * 1.5
  }
  if (annualRate != null && annualRate !== '') return Number(annualRate) / 26
  return 0
}

// Total bonus = flat + bonus hours x bonus rate (matches backend computeBonus).
function clientBonus({ bonusFlat, bonusHours, bonusRate }) {
  const flat = Number(bonusFlat || 0)
  const fromHours = Number(bonusHours || 0) * Number(bonusRate || 0)
  return Math.round((flat + fromHours) * 100) / 100
}

// Default pay period = the most recent completed two-week period (ending last Sat).
function defaultPeriod() {
  const today = new Date()
  const day = today.getDay() // 0 = Sun … 6 = Sat
  // Walk back to the most recent Saturday on/before today, then take the
  // 14-day window ending there as the most recent completed pay period.
  const end = new Date(today)
  end.setDate(today.getDate() - ((day + 1) % 7))
  const start = new Date(end)
  start.setDate(end.getDate() - 13)
  return { start: fmtDate(start), end: fmtDate(end) }
}

const STEPS = ['Select System', 'Upload Template', 'Review Payroll', 'Approve & Export']
const CLASS_LABEL = { W2: 'W-2 Employees', CONTRACTOR: '1099 / Per Diem' }

export default function PayrollBuilderPage({ onNavigate }) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [config, setConfig] = useState(null) // { fields, systems }
  const [system, setSystem] = useState(null) // 'ADP' | 'GUSTO'

  // Template upload state
  const [uploading, setUploading] = useState(false)
  const [mapping, setMapping] = useState(null) // { headers, fieldMapping, unmapped, fields }

  // Review state
  const [payClass, setPayClass] = useState('W2')
  const [period, setPeriod] = useState(defaultPeriod())
  // One invoice number for the whole run (same value on every provider row);
  // incremented manually each payroll. Maps to the template's invoice_number column.
  const [invoiceNumber, setInvoiceNumber] = useState('')
  // Per-class grid cache: { W2: { items, approved:Set, summary }, CONTRACTOR: {...} }
  const [grids, setGrids] = useState({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)
  // Once both class grids load, auto-select the class that actually has hours
  // (so an all-1099 agency doesn't land on an empty W-2 grid). Only fires once.
  const [autoPicked, setAutoPicked] = useState(false)
  // rosterEntryIds the user re-added after they were hidden for having no hours.
  const [restored, setRestored] = useState(() => new Set())

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(null) // { csv, fileName, run }

  const activeSystem = config?.systems?.find((s) => s.system === system)

  // ── Load config on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    payrollAPI
      .getConfig()
      .then((c) => {
        setConfig(c)
        // Pre-select a configured system and skip straight to review.
        const configured = c.systems.find((s) => s.configured)
        if (configured) {
          setSystem(configured.system)
          setStep(3)
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── Preview fetch when entering review / changing class or period ──────────────
  const loadPreview = useCallback(
    async (cls) => {
      setPreviewLoading(true)
      setError('')
      try {
        const res = await payrollAPI.preview({ payClass: cls, periodStart: period.start, periodEnd: period.end })
        setGrids((g) => ({
          ...g,
          [cls]: { items: res.items, approved: new Set(), summary: res.summary },
        }))
      } catch (e) {
        setError(e.message)
      } finally {
        setPreviewLoading(false)
      }
    },
    [period.start, period.end]
  )

  // On Review: load BOTH class grids, then auto-select whichever has hours.
  useEffect(() => {
    if (step !== 3) { setAutoPicked(false); return }
    if (!grids.W2) { loadPreview('W2'); return }
    if (!grids.CONTRACTOR) { loadPreview('CONTRACTOR'); return }
    if (!autoPicked) {
      setAutoPicked(true)
      const w2 = grids.W2.items?.length || 0
      const ct = grids.CONTRACTOR.items?.length || 0
      if (w2 === 0 && ct > 0) setPayClass('CONTRACTOR')
      else if (ct === 0 && w2 > 0) setPayClass('W2')
    }
  }, [step, grids, loadPreview, autoPicked])

  // Refetch both grids when the period changes.
  useEffect(() => {
    if (step === 3) {
      setGrids({})
      setAutoPicked(false)
      setRestored(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.start, period.end])

  // Clear re-added rows when switching pay class (the list changes).
  useEffect(() => { setRestored(new Set()) }, [payClass])

  const grid = grids[payClass]

  // A row is "empty" if there's nothing to pay: no hours, no gross (covers
  // salaried W-2 who keep gross from salary), no bonus. Condense the review to
  // people with hours; hidden rows can be added back individually.
  function isEmpty(item) {
    const hrs = Number(item.regularHours || 0) + Number(item.otHours || 0)
    return hrs === 0 && Number(item.grossPay || 0) === 0 && clientBonus(item) === 0 && Number(item.reimbursement || 0) === 0
  }
  // Visible rows carry their ORIGINAL index into grid.items (updateItem needs it).
  const visible = grid
    ? grid.items.map((it, idx) => ({ it, idx })).filter(({ it }) => !isEmpty(it) || restored.has(it.rosterEntryId))
    : []
  const hidden = grid ? grid.items.filter((it) => isEmpty(it) && !restored.has(it.rosterEntryId)) : []

  // Only show the OT column when the active template actually has one (e.g. ADP).
  // Gusto's contractor template has no OT column, so showing it is just noise.
  const hasOtColumn = activeSystem?.fieldMapping
    ? Object.values(activeSystem.fieldMapping).includes('otHours')
    : false
  // Grid columns: Provider, Role, Reg Hrs, [OT Hrs], Rate, Gross, Status
  const gridCols = hasOtColumn
    ? '2fr 1fr 0.8fr 0.8fr 1fr 1.2fr 110px'
    : '2fr 1fr 0.9fr 1fr 1.2fr 110px'

  // Debounced per-row autosave of bonus/reimbursement edits — without this,
  // leaving the page loses them (the grid is client state; only exported runs
  // were persisted). The preview endpoint overlays saved drafts on reload.
  const draftTimers = React.useRef({})
  const pendingDrafts = React.useRef({}) // key -> payload not yet sent
  const [draftError, setDraftError] = useState(false)
  const DRAFT_FIELDS = ['bonusFlat', 'bonusHours', 'bonusRate', 'reimbursement']
  function sendDraft(key, payload) {
    delete pendingDrafts.current[key]
    payrollAPI
      .savePayrollDraft(payload)
      .then(() => setDraftError(false))
      .catch(() => setDraftError(true))
  }
  function scheduleDraftSave(item, cls) {
    const key = `${cls}:${item.rosterEntryId}`
    const payload = {
      payClass: cls,
      periodStart: period.start,
      periodEnd: period.end,
      rosterEntryId: item.rosterEntryId,
      bonusFlat: item.bonusFlat ?? null,
      bonusHours: item.bonusHours ?? null,
      bonusRate: item.bonusRate ?? null,
      reimbursement: item.reimbursement ?? null,
    }
    pendingDrafts.current[key] = payload
    clearTimeout(draftTimers.current[key])
    draftTimers.current[key] = setTimeout(() => sendDraft(key, payload), 600)
  }
  // On unmount, flush anything still inside the debounce window so a quick
  // edit-then-navigate never loses the last keystroke.
  useEffect(() => () => {
    Object.values(draftTimers.current).forEach(clearTimeout)
    for (const [key, payload] of Object.entries(pendingDrafts.current)) sendDraft(key, payload)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function updateItem(idx, patch) {
    // Compute the edited row up front (outside the state updater — scheduling a
    // network save inside setState would double-fire under StrictMode).
    const curGrid = grids[payClass]
    if (!curGrid || !curGrid.items[idx]) return
    const edited = { ...curGrid.items[idx], ...patch }
    edited.grossPay = Math.round(clientGross(edited) * 100) / 100
    edited.missingRate = (edited.hourlyRate == null || edited.hourlyRate === '') && (edited.annualRate == null || edited.annualRate === '')

    setGrids((g) => {
      const cur = g[payClass]
      if (!cur) return g
      const items = cur.items.map((it, i) => (i === idx ? edited : it))
      // un-approve an edited row so the admin re-confirms
      const approved = new Set(cur.approved)
      approved.delete(edited.rosterEntryId)
      return { ...g, [payClass]: { ...cur, items, approved } }
    })

    // Persist bonus/reimbursement edits (hours/rates have their own homes:
    // Provider Hours entries and the roster rate flow).
    if (DRAFT_FIELDS.some((f) => f in patch)) scheduleDraftSave(edited, payClass)
  }

  function toggleApprove(item) {
    setGrids((g) => {
      const cur = g[payClass]
      const approved = new Set(cur.approved)
      if (approved.has(item.rosterEntryId)) approved.delete(item.rosterEntryId)
      else approved.add(item.rosterEntryId)
      return { ...g, [payClass]: { ...cur, approved } }
    })
  }

  function approveAll() {
    const visibleIds = new Set(visible.map(({ it }) => it.rosterEntryId))
    setGrids((g) => {
      const cur = g[payClass]
      const approved = new Set(cur.items.filter((i) => visibleIds.has(i.rosterEntryId) && !i.missingRate).map((i) => i.rosterEntryId))
      return { ...g, [payClass]: { ...cur, approved } }
    })
  }

  // Approval / export operate on the VISIBLE (condensed) rows only.
  const allApproved =
    visible.length > 0 && visible.every(({ it }) => grid.approved.has(it.rosterEntryId))
  const anyMissingRate = visible.some(({ it }) => it.missingRate)

  async function doExport() {
    setExporting(true)
    setError('')
    try {
      const res = await payrollAPI.exportRun({
        system,
        payClass,
        periodStart: period.start,
        periodEnd: period.end,
        invoiceNumber,
        lineItems: visible.map(({ it }) => it),
      })
      setExported(res)
      downloadCsv(res.csv, res.fileName)
      setStep(4)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  function downloadCsv(content, filename) {
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleTemplateUpload(file) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await payrollAPI.uploadTemplate(system, file)
      setMapping(res)
      // refresh config so "configured" reflects the new template
      const c = await payrollAPI.getConfig()
      setConfig(c)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function resetTemplate(sys) {
    if (!window.confirm(`Reset the ${sys} template? You'll re-upload it on the next step.`)) return
    setError('')
    try {
      await payrollAPI.resetTemplate(sys)
      const c = await payrollAPI.getConfig()
      setConfig(c)
      setMapping(null)
      setSystem(sys)
      setStep(2)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) {
    return <div style={{ padding: '32px 40px', color: '#64748B' }}>Loading payroll…</div>
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Payroll Builder</h1>
          <div style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            Turn your SNAP Shifts data into a ready-to-upload {activeSystem?.system || 'ADP / Gusto'} payroll file.
            SNAP processes the data — you stay the payor.
          </div>
        </div>
        <button style={ghostBtn} onClick={() => onNavigate('payroll-history')}>
          View History
        </button>
      </div>

      {/* Step tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E2E8F0', marginBottom: 24 }}>
        {STEPS.map((label, i) => {
          const n = i + 1
          const active = step === n
          const done = step > n
          return (
            <div
              key={label}
              onClick={() => n <= step && setStep(n)}
              style={{
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: n <= step ? 'pointer' : 'default',
                color: active ? '#2563EB' : done ? '#059669' : '#94A3B8',
                borderBottom: active ? '2px solid #2563EB' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: done ? '#10B981' : active ? '#2563EB' : '#E2E8F0',
                  color: done || active ? '#fff' : '#94A3B8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {done ? '✓' : n}
              </span>
              {label}
            </div>
          )
        })}
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
      {draftError && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Couldn’t save your latest bonus/reimbursement edits — they’ll be lost if you leave this page. Check your connection and edit the field again to retry.
        </div>
      )}

      {/* ── STEP 1: SELECT SYSTEM ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <p style={{ color: '#64748B', fontSize: 14, marginBottom: 20 }}>
            Choose your payroll provider. You upload your template once — SNAP maps it automatically for every future pay run.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 560 }}>
            {['ADP', 'GUSTO'].map((sys) => {
              const conf = config?.systems?.find((s) => s.system === sys)
              const selected = system === sys
              return (
                <div
                  key={sys}
                  onClick={() => setSystem(sys)}
                  style={{
                    ...card,
                    cursor: 'pointer',
                    textAlign: 'center',
                    border: selected ? '2px solid #2563EB' : '1px solid #E2E8F0',
                    background: selected ? '#EFF6FF' : '#fff',
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 800, color: sys === 'ADP' ? '#CC0000' : '#F45D48' }}>
                    {sys === 'GUSTO' ? 'Gusto' : 'ADP'}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
                    {conf?.configured ? '✓ Template configured' : 'No template yet'}
                  </div>
                  {conf?.templateName && (
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conf.templateName}
                    </div>
                  )}
                  {conf?.configured && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        resetTemplate(sys)
                      }}
                      style={{ marginTop: 10, background: 'none', border: 'none', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Reset / replace template
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button
              style={system ? primaryBtn : disabledBtn}
              disabled={!system}
              onClick={() => setStep(activeSystem?.configured ? 3 : 2)}
            >
              {activeSystem?.configured ? 'Continue to Review' : 'Continue'}
            </button>
            {activeSystem?.configured && (
              <button style={ghostBtn} onClick={() => { setMapping(null); setStep(2) }}>
                Replace template
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2: UPLOAD TEMPLATE ───────────────────────────────────────────── */}
      {step === 2 && (
        <div>
          <p style={{ color: '#64748B', fontSize: 14, marginBottom: 20 }}>
            Upload a blank export template from {system}. SNAP reads the column headers and maps your shift data to them
            automatically — you only do this once.
          </p>

          {!mapping ? (
            <label style={{ ...card, display: 'block', border: '2px dashed #CBD5E1', textAlign: 'center', padding: 48, cursor: 'pointer', maxWidth: 520 }}>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => handleTemplateUpload(e.target.files[0])}
              />
              <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 15, color: '#475569', fontWeight: 600 }}>
                {uploading ? 'Reading template…' : `Drop your ${system} CSV/XLSX template here`}
              </div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>or click to browse — .csv, .xlsx, .xls</div>
            </label>
          ) : (
            <div style={{ maxWidth: 620 }}>
              <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: '#059669', fontSize: 14 }}>✓ Template uploaded — {mapping.templateName}</div>
              </div>
              <div style={{ ...card }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Field Mapping — {system}
                </div>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12, lineHeight: 1.4 }}>
                  SNAP auto-maps the columns it has data for (name, hours, rate). Columns SNAP doesn't track —
                  e.g. SSN/EIN, bonus, reimbursement — stay <strong>unmapped</strong> and export blank for you to
                  fill in your payroll system. Adjust any mapping with the dropdowns.
                </div>
                {mapping.headers.map((h) => {
                  const mapped = mapping.fieldMapping[h]
                  return (
                    <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                      <div style={{ width: 220, color: '#0F172A', fontWeight: 500 }}>{h}</div>
                      <div style={{ color: '#CBD5E1' }}>←</div>
                      <select
                        value={mapped || ''}
                        onChange={(e) => {
                          const fm = { ...mapping.fieldMapping, [h]: e.target.value || null }
                          setMapping({ ...mapping, fieldMapping: fm })
                        }}
                        style={{ ...inputStyle, width: 220, padding: '6px 8px' }}
                      >
                        <option value="">— not mapped —</option>
                        {mapping.fields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ marginLeft: 'auto', fontSize: 12, color: mapped ? '#059669' : '#B45309' }}>
                        {mapped ? '✓ Mapped' : '⚠ Unmapped'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button style={ghostBtn} onClick={() => setStep(1)}>
              Back
            </button>
            {mapping && (
              <button
                style={primaryBtn}
                onClick={async () => {
                  try {
                    await payrollAPI.saveMapping(system, mapping.fieldMapping)
                    setStep(3)
                  } catch (e) {
                    setError(e.message)
                  }
                }}
              >
                Save Mapping & Continue
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: REVIEW PAYROLL ────────────────────────────────────────────── */}
      {step === 3 && (
        <div>
          {/* Pay class tabs + period */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {['W2', 'CONTRACTOR'].map((cls) => (
                <button
                  key={cls}
                  onClick={() => setPayClass(cls)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 999,
                    border: '1px solid',
                    borderColor: payClass === cls ? '#2563EB' : '#E2E8F0',
                    background: payClass === cls ? '#EFF6FF' : '#fff',
                    color: payClass === cls ? '#1D4ED8' : '#64748B',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {CLASS_LABEL[cls]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748B', flexWrap: 'wrap' }}>
              <PayrollPeriodPicker value={period} onChange={(p) => setPeriod(p)} />
              <span style={{ marginLeft: 8 }}>Invoice #</span>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. 25"
                title="One invoice number for this whole payroll run — applied to every provider row."
                style={{ ...inputStyle, width: 90 }}
              />
            </div>
          </div>

          {previewLoading || !grid ? (
            <div style={{ ...card, color: '#64748B' }}>Building {CLASS_LABEL[payClass]} payroll…</div>
          ) : (
            <>
              {/* Summary cards — over the condensed (visible) list */}
              {(() => {
                const vis = visible.map(({ it }) => it)
                const totalBonus = vis.reduce((s, i) => s + clientBonus(i), 0)
                const approvedCount = vis.filter((i) => grid.approved.has(i.rosterEntryId)).length
                const cards = [
                  { label: 'Providers', value: vis.length },
                  { label: 'Total Hours', value: vis.reduce((s, i) => s + Number(i.regularHours || 0) + Number(i.otHours || 0), 0).toFixed(1) },
                  { label: 'Total Gross', value: fmtMoney(vis.reduce((s, i) => s + Number(i.grossPay || 0), 0)) },
                  { label: 'Total Bonus', value: fmtMoney(totalBonus), color: totalBonus > 0 ? '#7C3AED' : '#0F172A' },
                  { label: 'Approved', value: `${approvedCount} / ${vis.length}` },
                ]
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
                    {cards.map((c) => (
                      <div key={c.label} style={{ ...card, padding: 16 }}>
                        <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{c.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: c.color || '#0F172A' }}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {grid.items.length === 0 ? (
                <div style={{ ...card, color: '#64748B', lineHeight: 1.6 }}>
                  No <strong>{CLASS_LABEL[payClass]}</strong> hours found for {period.start} → {period.end}. Check that:
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    <li>the <strong>period</strong> above matches the one you entered hours under on Provider Hours,</li>
                    <li>those hours are <strong>Submitted</strong> (green) on the Provider Hours page — drafts don't count,</li>
                    <li>and each provider's pay class (1099 vs W-2) is set correctly. Try the other class with the toggle above.</li>
                  </ul>
                </div>
              ) : (
                <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <div>Provider</div>
                    <div>Role</div>
                    <div>{hasOtColumn ? 'Reg Hrs' : 'Hours'}</div>
                    {hasOtColumn && <div>OT Hrs</div>}
                    <div>Rate</div>
                    <div>Gross</div>
                    <div style={{ textAlign: 'center' }}>Status</div>
                  </div>
                  {visible.map(({ it: item, idx }) => {
                    const isApproved = grid.approved.has(item.rosterEntryId)
                    const open = expanded === item.rosterEntryId
                    return (
                      <div key={item.rosterEntryId}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: gridCols,
                            padding: '10px 16px',
                            borderBottom: '1px solid #F1F5F9',
                            alignItems: 'center',
                            background: open ? '#F8FAFC' : '#fff',
                          }}
                        >
                          <div style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : item.rosterEntryId)}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                              {open ? '▾ ' : '▸ '}{item.providerName}
                            </div>
                            {item.useBusinessNameForPayroll && item.businessName && (
                              <div style={{ fontSize: 11, color: '#7C3AED' }}>pays as {item.businessName}</div>
                            )}
                            {item.missingRate && (
                              <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>⚠ No rate — set it on the roster</div>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: '#64748B' }}>{item.role || '—'}</div>
                          <input
                            type="number"
                            value={item.regularHours}
                            onChange={(e) => updateItem(idx, { regularHours: e.target.value })}
                            style={{ ...inputStyle, width: 64, padding: '5px 7px' }}
                          />
                          {hasOtColumn && (
                            <input
                              type="number"
                              value={item.otHours}
                              onChange={(e) => updateItem(idx, { otHours: e.target.value })}
                              style={{ ...inputStyle, width: 64, padding: '5px 7px', color: Number(item.otHours) > 0 ? '#B45309' : '#0F172A', background: Number(item.otHours) > 0 ? '#FFFBEB' : '#fff' }}
                            />
                          )}
                          {/* Rate is read-only here — it comes from the roster card */}
                          <div style={{ fontSize: 14, color: item.missingRate ? '#DC2626' : '#0F172A' }}>
                            {item.hourlyRate != null ? '$' + Number(item.hourlyRate).toFixed(2) : '—'}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>{fmtMoney(item.grossPay)}</div>
                            <div
                              onClick={() => setExpanded(open ? null : item.rosterEntryId)}
                              style={{ fontSize: 11, color: '#7C3AED', fontWeight: 600, cursor: 'pointer' }}
                            >
                              {clientBonus(item) > 0 ? `+ ${fmtMoney(clientBonus(item))} bonus` : '+ Add bonus / reimb.'}
                              {Number(item.reimbursement || 0) > 0 && (
                                <span style={{ color: '#059669', marginLeft: 6 }}>+ {fmtMoney(item.reimbursement)} reimb.</span>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => toggleApprove(item)}
                              disabled={item.missingRate}
                              style={{
                                padding: '4px 12px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: item.missingRate ? 'not-allowed' : 'pointer',
                                border: '1px solid',
                                borderColor: isApproved ? '#10B981' : '#E2E8F0',
                                background: isApproved ? '#ECFDF5' : '#fff',
                                color: isApproved ? '#059669' : '#64748B',
                              }}
                            >
                              {isApproved ? '✓ Approved' : 'Approve'}
                            </button>
                          </div>
                        </div>
                        {open && (
                          <div style={{ background: '#F8FAFC', padding: '10px 16px 14px 32px', borderBottom: '1px solid #F1F5F9' }}>
                            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Shift Detail</div>
                            {item.shiftDetail && item.shiftDetail.length > 0 ? (
                              <table style={{ fontSize: 12, color: '#475569', borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}>
                                <thead>
                                  <tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                                    <th style={{ padding: '2px 8px' }}>Date</th>
                                    <th style={{ padding: '2px 8px' }}>Start</th>
                                    <th style={{ padding: '2px 8px' }}>End</th>
                                    <th style={{ padding: '2px 8px' }}>Hours</th>
                                    <th style={{ padding: '2px 8px' }}>Type</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.shiftDetail.map((s, si) => (
                                    <tr key={si}>
                                      <td style={{ padding: '2px 8px' }}>{s.date}</td>
                                      <td style={{ padding: '2px 8px' }}>{s.start || '—'}</td>
                                      <td style={{ padding: '2px 8px' }}>{s.end || '—'}</td>
                                      <td style={{ padding: '2px 8px' }}>{Number(s.hours).toFixed(1)}</td>
                                      <td style={{ padding: '2px 8px' }}>{s.type}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div style={{ fontSize: 12, color: '#94A3B8' }}>
                                No shift records found for this period — enter hours manually above.
                              </div>
                            )}

                            {/* Bonus editor — flat + (hours × rate), summed into the CSV "bonus" column */}
                            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed #E2E8F0' }}>
                              <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
                                Bonus (optional)
                              </div>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div>
                                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>Flat bonus ($)</div>
                                  <input type="number" value={item.bonusFlat ?? ''} placeholder="0"
                                    onChange={(e) => updateItem(idx, { bonusFlat: e.target.value })}
                                    style={{ ...inputStyle, width: 110, padding: '6px 8px' }} />
                                </div>
                                <div style={{ color: '#94A3B8', paddingBottom: 8 }}>+</div>
                                <div>
                                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>Bonus hours</div>
                                  <input type="number" value={item.bonusHours ?? ''} placeholder="0"
                                    onChange={(e) => updateItem(idx, { bonusHours: e.target.value })}
                                    style={{ ...inputStyle, width: 90, padding: '6px 8px' }} />
                                </div>
                                <div style={{ color: '#94A3B8', paddingBottom: 8 }}>×</div>
                                <div>
                                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>Bonus rate ($/hr)</div>
                                  <input type="number" value={item.bonusRate ?? ''} placeholder="0"
                                    onChange={(e) => updateItem(idx, { bonusRate: e.target.value })}
                                    style={{ ...inputStyle, width: 110, padding: '6px 8px' }} />
                                </div>
                                <div style={{ color: '#94A3B8', paddingBottom: 8 }}>=</div>
                                <div style={{ paddingBottom: 6 }}>
                                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>Total bonus</div>
                                  <div style={{ fontSize: 16, fontWeight: 700, color: clientBonus(item) > 0 ? '#059669' : '#94A3B8' }}>
                                    {fmtMoney(clientBonus(item))}
                                  </div>
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                                Use either or both. The total exports in the template's <strong>bonus</strong> column — separate from regular pay.
                              </div>

                              {/* Reimbursement — separate payroll line, pre-filled from the import. */}
                              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F1F5F9' }}>
                                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>Reimbursement ($)</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <input type="number" step="0.01" min="0" value={item.reimbursement ?? ''} placeholder="0"
                                    onChange={(e) => updateItem(idx, { reimbursement: e.target.value === '' ? null : Number(e.target.value) })}
                                    style={{ ...inputStyle, width: 140 }} />
                                  <span style={{ fontSize: 11, color: '#94A3B8' }}>Paid to the contractor — exports in the <strong>reimbursement</strong> column, separate from pay + bonus.</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Condensed-list controls: only people with hours show; add back or reveal all. */}
              {grid && (hidden.length > 0 || restored.size > 0) && (
                <div style={{ ...card, marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {hidden.length > 0 && (
                    <>
                      <span style={{ fontSize: 13, color: '#64748B' }}>
                        {hidden.length} provider{hidden.length === 1 ? '' : 's'} with no hours hidden.
                      </span>
                      <select
                        value=""
                        onChange={(e) => { const id = e.target.value; if (id) setRestored((s) => new Set([...s, id])) }}
                        style={{ ...inputStyle, minWidth: 230 }}
                      >
                        <option value="">+ Add a provider back…</option>
                        {hidden.map((h) => (
                          <option key={h.rosterEntryId} value={h.rosterEntryId}>
                            {h.useBusinessNameForPayroll && h.businessName ? h.businessName : h.providerName}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setRestored(new Set(grid.items.map((i) => i.rosterEntryId)))} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                        Show all
                      </button>
                    </>
                  )}
                  {restored.size > 0 && (
                    <button onClick={() => setRestored(new Set())} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      Condense (hide no-hours)
                    </button>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12, marginTop: 20, alignItems: 'center' }}>
                <button style={ghostBtn} onClick={() => setStep(activeSystem?.configured ? 1 : 2)}>
                  Back
                </button>
                <button style={{ ...ghostBtn, color: '#1D4ED8', borderColor: '#BFDBFE' }} onClick={approveAll} disabled={visible.length === 0}>
                  Approve All
                </button>
                <button
                  style={allApproved ? primaryBtn : disabledBtn}
                  disabled={!allApproved || exporting}
                  onClick={doExport}
                >
                  {exporting ? 'Exporting…' : `Export ${CLASS_LABEL[payClass]} CSV`}
                </button>
                {anyMissingRate && (
                  <span style={{ fontSize: 12, color: '#DC2626' }}>Set a rate for flagged providers before approving.</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 4: EXPORT ────────────────────────────────────────────────────── */}
      {step === 4 && exported && (
        <div style={{ maxWidth: 560 }}>
          {exported.templateStale && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, color: '#B45309', fontSize: 14 }}>⚠ Your saved {system} template needs re-uploading</div>
              <div style={{ fontSize: 13, color: '#92400E', marginTop: 4 }}>
                This file used SNAP's default column layout because your saved template had no usable column mapping
                (an older upload). Go to Step 1 → <strong>Reset / replace template</strong> and re-upload your {system}
                template so future files match its exact columns.
              </div>
            </div>
          )}
          <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: '#059669', fontSize: 15 }}>✓ Payroll file generated & downloaded</div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
              Upload <strong>{exported.fileName}</strong> into {system} to complete payroll processing.
            </div>
          </div>
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Export Summary</div>
            {[
              ['Pay Period', `${exported.run.periodStart?.slice(0, 10)} — ${exported.run.periodEnd?.slice(0, 10)}`],
              ['Invoice #', exported.run.invoiceNumber || '—'],
              ['System', exported.run.system],
              ['Pay Class', CLASS_LABEL[exported.run.payClass]],
              ['Providers', exported.run.providerCount],
              ['Total Hours', `${exported.run.totalHours} hrs`],
              ['Base Gross', fmtMoney(exported.run.totalGross)],
              ...(exported.run.totalBonus > 0 ? [['Total Bonus', fmtMoney(exported.run.totalBonus)]] : []),
              ...(exported.run.totalReimbursement > 0 ? [['Total Reimb.', fmtMoney(exported.run.totalReimbursement)]] : []),
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                <span style={{ color: '#64748B' }}>{k}</span>
                <span style={{ color: k === 'Total Bonus' ? '#7C3AED' : k === 'Total Reimb.' ? '#0369A1' : '#0F172A', fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={ghostBtn} onClick={() => downloadCsv(exported.csv, exported.fileName)}>
              Download Again
            </button>
            <button
              style={primaryBtn}
              onClick={() => {
                setExported(null)
                setGrids({})
                setStep(3)
              }}
            >
              Start New Pay Run
            </button>
            <button style={ghostBtn} onClick={() => onNavigate('payroll-history')}>
              View History
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
