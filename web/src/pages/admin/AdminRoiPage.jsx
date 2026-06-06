import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { adminAPI } from '../../api'

// SNAP Admin · ROI Tracker
//
// Per-facility ROI dashboard + SNAP-wide rollup + prospect projection
// + sales-case PDF export. Visual style follows the CAPA-pilot tracker
// prototype (dark navy, serif, restrained typography) since this surface
// is shown to customers and prospects, not just internal admins.

// ── Style tokens ───────────────────────────────────────────────────────
const C = {
  bg: '#0A0F1E',
  card: '#0F1929',
  border: '#1E2A3A',
  text: '#E8E4DC',
  muted: '#8A9BB0',
  dim: '#4A7FA5',
  faint: '#444',
  good: '#00C896',
  warn: '#F5A623',
  bad: '#E8534A',
  accent: '#9B7FD4',
}

const eyebrow = { fontSize: 10, letterSpacing: 3, color: C.dim, textTransform: 'uppercase' }
const card = { background: C.card, border: `1px solid ${C.border}`, padding: 24 }

const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString()
const fmtMonth = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const monthKey = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const todayMonthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Components ─────────────────────────────────────────────────────────

function StatBlock({ label, value, sub, color = C.text }) {
  return (
    <div style={card}>
      <div style={{ ...eyebrow, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, color, fontWeight: 300 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: active ? C.text : C.dim,
        borderBottom: active ? `2px solid ${C.dim}` : '2px solid transparent',
        padding: '14px 20px',
        cursor: 'pointer',
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  )
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ background: C.border, height: 6, borderRadius: 3 }}>
      <div style={{ background: color, width: `${value}%`, height: '100%', borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  )
}

function getColor(progress) {
  if (progress >= 80) return C.good
  if (progress >= 40) return C.warn
  return C.bad
}

// ── Rollup band ────────────────────────────────────────────────────────

function RollupBand({ rollup }) {
  if (!rollup) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
      <StatBlock
        label="SNAP-wide monthly savings"
        value={fmt(rollup.totalSavingsMonthly)}
        sub={`across ${rollup.facilitiesWithSavings} of ${rollup.facilitiesTracked} customers`}
        color={C.good}
      />
      <StatBlock
        label="Annualized SNAP impact"
        value={fmt(rollup.totalSavingsAnnualized)}
        sub="projected run rate"
        color={C.dim}
      />
      <StatBlock
        label="Providers managed"
        value={(rollup.totalProviders || 0).toLocaleString()}
        sub="across all customer rosters"
        color={C.accent}
      />
      <StatBlock
        label="Customers tracked"
        value={rollup.facilitiesTracked}
        sub="with ROI baseline set"
        color={C.warn}
      />
    </div>
  )
}

// ── Per-facility tab views ─────────────────────────────────────────────

function DashboardTab({ data }) {
  const { baseline, computed } = data
  if (!baseline) {
    return (
      <EmptyBaseline />
    )
  }
  const { savings, metrics } = computed
  return (
    <>
      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatBlock label="Monthly Savings" value={fmt(savings.totalMonthly)} sub="vs baseline" color={savings.totalMonthly > 0 ? C.good : C.bad} />
        <StatBlock label="Annualized" value={fmt(savings.totalAnnualized)} sub="projected run rate" color={C.dim} />
        <StatBlock label="Backup Savings" value={fmt(savings.backupSavingsMonthly)} sub="per month" color={C.warn} />
        <StatBlock label="Admin Savings" value={fmt(savings.adminSavingsMonthly)} sub="per month" color={C.accent} />
      </div>

      {/* Baseline vs Current */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        <div style={card}>
          <div style={{ ...eyebrow, marginBottom: 16 }}>Baseline Cost Structure</div>
          {[
            ['Provider Costs (Monthly)', fmt(baseline.monthlyProviderCost)],
            ['Backup Staffing (Monthly)', fmt(savings.baseline.backupMonthly)],
            ['Admin — Scheduling (Monthly)', fmt(savings.baseline.adminSchedulingMonthly)],
            ['Admin — Credentialing (Monthly)', fmt(savings.baseline.credentialingMonthly)],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
              <span style={{ color: C.muted }}>{label}</span>
              <span style={{ color: C.text }}>{val}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ ...eyebrow, color: C.good, marginBottom: 16 }}>Current Savings Identified</div>
          {[
            ['Backup Staffing Reduction', fmt(savings.backupSavingsMonthly) + '/mo', false],
            ['Admin Efficiency Savings', fmt(savings.adminSavingsMonthly) + '/mo', false],
            ['Total Monthly Savings', fmt(savings.totalMonthly) + '/mo', true],
            ['Annualized Savings', fmt(savings.totalAnnualized) + '/yr', true],
          ].map(([label, val, hi]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
              <span style={{ color: C.muted }}>{label}</span>
              <span style={{ color: hi ? C.good : C.text, fontWeight: hi ? 600 : 400 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bars */}
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 20 }}>Progress to Target</div>
        {metrics.map((m) => (
          <div key={m.key} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: C.muted }}>{m.label}</span>
              <span style={{ color: C.text }}>
                {round1(m.actual)}{m.unit} <span style={{ color: C.faint }}>→ target {m.target}{m.unit}</span>
              </span>
            </div>
            <ProgressBar value={m.progress} color={getColor(m.progress)} />
          </div>
        ))}
      </div>
    </>
  )
}

function MetricsTab({ data, monthKey: selMonth, onSave, onAutoPull, autoPulled, saving }) {
  const { baseline, computed, selected } = data
  // Local form state mirrors `selected` snapshot, falling back to baseline.
  const [form, setForm] = useState({})
  useEffect(() => {
    if (!baseline) return
    setForm({
      backupShiftsPerDay: selected?.backupShiftsPerDay ?? baseline.backupShiftsPerDay,
      adminSchedulingHours: selected?.adminSchedulingHours ?? (baseline.adminSchedulingStaff * baseline.adminSchedulingHours),
      credentialingHours: selected?.credentialingHours ?? (baseline.credentialingStaff * baseline.credentialingHours),
      credentialingTurnaround: selected?.credentialingTurnaround ?? baseline.credentialingTurnaround,
      schedulingGapRate: selected?.schedulingGapRate ?? baseline.schedulingGapRate,
      providerSatisfaction: selected?.providerSatisfaction ?? baseline.providerSatisfaction,
      notes: selected?.notes ?? '',
    })
  }, [baseline, selected, selMonth])

  if (!baseline) return <EmptyBaseline />
  if (!computed) return null

  const metrics = computed.metrics
  const SLIDER_BOUNDS = {
    backupShiftsPerDay: { min: 0, max: Math.max(10, baseline.backupShiftsPerDay * 1.5), step: 0.5 },
    adminSchedulingHours: { min: 0, max: Math.max(80, baseline.adminSchedulingStaff * baseline.adminSchedulingHours * 1.5), step: 1 },
    credentialingHours: { min: 0, max: Math.max(40, baseline.credentialingStaff * baseline.credentialingHours * 1.5), step: 1 },
    credentialingTurnaround: { min: 1, max: 45, step: 1 },
    schedulingGapRate: { min: 0, max: 35, step: 0.5 },
    providerSatisfaction: { min: 1, max: 10, step: 0.1 },
  }
  const AUTO_PULLABLE = new Set(['backupShiftsPerDay', 'schedulingGapRate'])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {metrics.map((m) => {
          const bounds = SLIDER_BOUNDS[m.key]
          const formVal = form[m.key] ?? m.actual
          // Use the FORM value (live as the slider moves) for color/progress
          // so the meter tracks the slider — otherwise it lags until save.
          const liveProg = progressOf({ baseline: m.baseline, actual: formVal, target: m.target })
          const color = getColor(liveProg)
          const isAuto = autoPulled?.[m.key]
          return (
            <div key={m.key} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div style={eyebrow}>{m.label}</div>
                {AUTO_PULLABLE.has(m.key) && (
                  <button
                    onClick={() => onAutoPull(m.key)}
                    title="Pull this value from live SNAP data for the selected month"
                    style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.dim, fontSize: 10, letterSpacing: 1, padding: '4px 8px', cursor: 'pointer', textTransform: 'uppercase' }}
                  >
                    ⟲ Auto-pull
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.faint, marginBottom: 4 }}>BASELINE</div>
                  <div style={{ fontSize: 22, color: '#666' }}>{round1(m.baseline)}{m.unit}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>CURRENT {isAuto && <span style={{ color: C.good, marginLeft: 4 }}>· auto</span>}</div>
                  <div style={{ fontSize: 22, color }}>{round1(formVal)}{m.unit}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: C.faint, marginBottom: 4 }}>TARGET</div>
                  <div style={{ fontSize: 22, color: C.text }}>{m.target}{m.unit}</div>
                </div>
              </div>
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={formVal}
                onChange={(e) => setForm((f) => ({ ...f, [m.key]: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: color, marginBottom: 12 }}
              />
              <div style={{ background: C.border, height: 4, borderRadius: 2, marginBottom: 8 }}>
                <div style={{ background: color, width: `${liveProg}%`, height: '100%', borderRadius: 2 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: C.faint }}>{Math.round(liveProg)}% to target</span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 24, ...card }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Notes for this month</div>
        <textarea
          value={form.notes || ''}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Anything to remember about this month's numbers — context for renewal conversations"
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: 12, fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            onClick={() => onSave(form)}
            disabled={saving}
            style={{ background: C.good, color: C.bg, border: 'none', padding: '10px 22px', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : `Save Snapshot — ${selMonth}`}
          </button>
        </div>
      </div>
    </>
  )
}

function SalesCaseTab({ data, customerName, snapshotMonth }) {
  const { baseline, computed } = data
  if (!baseline) return <EmptyBaseline />
  const { savings } = computed
  const adminHoursWeek =
    (baseline.adminSchedulingStaff * baseline.adminSchedulingHours) +
    (baseline.credentialingStaff * baseline.credentialingHours)
  return (
    <div style={{ maxWidth: 760 }}>
      {/* Print header — only renders when @media print kicks in */}
      <div className="roi-print-header" style={{ display: 'none' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>SNAP Medical — ROI Report</div>
        <div style={{ fontSize: 12 }}>{customerName} · Generated {new Date().toLocaleDateString()}</div>
      </div>

      <div style={{ ...card, padding: 32, marginBottom: 16 }}>
        <div style={{ ...eyebrow, marginBottom: 20 }}>Executive Summary — SNAP Medical ROI Case</div>
        <div style={{ fontSize: 15, lineHeight: 1.8, color: '#C8C4BC', marginBottom: 24 }}>
          <strong style={{ color: C.text }}>{customerName}</strong> manages <strong style={{ color: C.text }}>{baseline.providerCount} providers</strong> at approximately <strong style={{ color: C.text }}>{fmt(baseline.monthlyProviderCost)}/month</strong>. Administrative overhead for scheduling and credentialing consumes <strong style={{ color: C.text }}>{Math.round(adminHoursWeek)} hours per week</strong>. Backup staffing to cover gaps costs roughly <strong style={{ color: C.text }}>{fmt(baseline.annualBackupStaffing)} annually</strong>.
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24 }}>
          <div style={{ ...eyebrow, color: C.good, marginBottom: 16 }}>SNAP Impact — {fmtMonth(snapshotMonth) || 'latest snapshot'}</div>
          <div style={{ fontSize: 15, lineHeight: 1.8, color: '#C8C4BC' }}>
            On SNAP Medical, {customerName} has identified <strong style={{ color: C.good }}>{fmt(savings.totalMonthly)} in monthly savings</strong>, representing an annualized reduction of <strong style={{ color: C.good }}>{fmt(savings.totalAnnualized)}</strong>. Backup costs have dropped <strong style={{ color: C.text }}>{fmt(savings.backupSavingsMonthly)}/mo</strong> and admin/credentialing time <strong style={{ color: C.text }}>{fmt(savings.adminSavingsMonthly)}/mo</strong>.
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: 32, marginBottom: 16 }}>
        <div style={{ ...eyebrow, marginBottom: 20 }}>Projection: Larger Systems</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
          For a system managing 5× to 8× {customerName}'s provider volume, SNAP's impact scales proportionally.
        </div>
        {[
          ['Estimated Monthly Savings (5× scale)', fmt(savings.totalMonthly * 5)],
          ['Estimated Monthly Savings (8× scale)', fmt(savings.totalMonthly * 8)],
          ['Annualized at 5×', fmt(savings.totalAnnualized * 5)],
          ['Annualized at 8×', fmt(savings.totalAnnualized * 8)],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
            <span style={{ color: C.muted }}>{label}</span>
            <span style={{ color: C.good, fontWeight: 600 }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>The Pitch in One Line</div>
        <div style={{ fontSize: 16, color: C.text, lineHeight: 1.7, fontStyle: 'italic' }}>
          "We are saving {customerName} {fmt(savings.totalAnnualized)} per year. A system your size would see proportionally larger returns. The pilot is risk-free, and the numbers speak for themselves."
        </div>
      </div>
    </div>
  )
}

function ProspectTab({ facilities }) {
  const [providerCount, setProviderCount] = useState(100)
  const [monthlyProviderCost, setMonthlyProviderCost] = useState('')
  const [sourceFacilityId, setSourceFacilityId] = useState('')
  const [name, setName] = useState('Acme Surgical Center')
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  async function run() {
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await adminAPI.projectRoi({
        providerCount: parseInt(providerCount, 10),
        monthlyProviderCost: monthlyProviderCost ? parseFloat(monthlyProviderCost) : null,
        sourceFacilityId: sourceFacilityId || undefined,
      })
      setResult(res)
    } catch (e) {
      setError(e.message || 'Projection failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 16 }}>Prospect Inputs</div>
        <Label>Prospect name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Label>Provider count</Label>
        <Input type="number" min={1} value={providerCount} onChange={(e) => setProviderCount(e.target.value)} />
        <Label>Monthly provider spend (optional)</Label>
        <Input type="number" min={0} step={1000} value={monthlyProviderCost} onChange={(e) => setMonthlyProviderCost(e.target.value)} placeholder="e.g. 5750000" />
        <Label>Project from (customer)</Label>
        <select
          value={sourceFacilityId}
          onChange={(e) => setSourceFacilityId(e.target.value)}
          style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: 10, fontSize: 13, marginBottom: 18 }}
        >
          <option value="">— Best customer (highest savings)</option>
          {facilities.filter((f) => f.hasBaseline).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={running || !providerCount}
          style={{ background: C.good, color: C.bg, border: 'none', padding: '10px 22px', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', cursor: running ? 'default' : 'pointer', opacity: running ? 0.6 : 1, width: '100%' }}
        >
          {running ? 'Projecting…' : 'Run projection'}
        </button>
        {error && <div style={{ color: C.bad, fontSize: 12, marginTop: 12 }}>{error}</div>}
      </div>

      <div>
        {!result ? (
          <div style={{ ...card, color: C.muted }}>
            Inputs on the left → SNAP scales a known customer's per-provider savings to the prospect's size and shows projected monthly + annual impact.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <StatBlock label="Projected Monthly Savings" value={fmt(result.projection.monthlySavings)} sub={`based on ${result.sourceCustomer.name}`} color={C.good} />
              <StatBlock label="Annualized" value={fmt(result.projection.annualSavings)} sub={`${result.projection.scale.toFixed(1)}× ${result.sourceCustomer.name} scale`} color={C.dim} />
            </div>
            <div style={card}>
              <div style={{ ...eyebrow, marginBottom: 16 }}>How we got here</div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: C.muted }}>
                <strong style={{ color: C.text }}>{result.sourceCustomer.name}</strong> currently manages <strong style={{ color: C.text }}>{result.projection.sourceCustomerProviderCount} providers</strong> and is saving <strong style={{ color: C.good }}>{fmt(result.projection.sourceMonthlySavings)}/month</strong> on SNAP. {name} manages <strong style={{ color: C.text }}>{providerCount} providers</strong>, a <strong style={{ color: C.text }}>{result.projection.scale.toFixed(1)}×</strong> scale — the same per-provider impact projects to <strong style={{ color: C.good }}>{fmt(result.projection.monthlySavings)}/month</strong>.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Baseline editor (modal) ────────────────────────────────────────────

function BaselineEditor({ open, facility, baseline, onSave, onClose }) {
  const [form, setForm] = useState({})
  useEffect(() => {
    if (!open) return
    setForm(baseline || {
      providerCount: 83, monthlyProviderCost: 1150000, providerHourlyRate: 295,
      backupPremium: 0.15, backupShiftsPerDay: 5, shiftHours: 8, annualBackupStaffing: 287500,
      adminSchedulingStaff: 2, adminSchedulingHours: 25, adminSchedulingRate: 100,
      credentialingStaff: 1, credentialingHours: 20, credentialingRate: 75,
      credentialingTurnaround: 21, schedulingGapRate: 18, providerSatisfaction: 6.2,
      notes: '',
    })
  }, [open, baseline])
  if (!open) return null
  const F = (k, label, hint) => (
    <div style={{ marginBottom: 12 }}>
      <Label>{label}{hint ? <span style={{ color: C.faint, marginLeft: 8, fontSize: 10, letterSpacing: 1 }}>{hint}</span> : null}</Label>
      <Input
        type="number" step="any"
        value={form[k] ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === '' ? null : parseFloat(e.target.value) }))}
      />
    </div>
  )
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 24 }}>
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, padding: 32, maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
          <div>
            <div style={eyebrow}>{baseline ? 'Edit baseline' : 'Set baseline'}</div>
            <div style={{ fontSize: 18, color: C.text, marginTop: 4 }}>{facility?.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {F('providerCount', 'Provider count', 'people')}
          {F('monthlyProviderCost', 'Monthly provider cost', '$')}
          {F('providerHourlyRate', 'Provider hourly rate', '$/hr')}
          {F('backupPremium', 'Backup premium', '0.15 = 15%')}
          {F('backupShiftsPerDay', 'Backup shifts / day', 'shifts')}
          {F('shiftHours', 'Shift length', 'hrs')}
          {F('annualBackupStaffing', 'Annual backup spend', '$')}
          {F('adminSchedulingStaff', 'Scheduling staff (FTE)', 'people')}
          {F('adminSchedulingHours', 'Scheduling hrs / week / staff', 'hrs')}
          {F('adminSchedulingRate', 'Scheduling rate', '$/hr')}
          {F('credentialingStaff', 'Credentialing staff (FTE)', 'people')}
          {F('credentialingHours', 'Cred hrs / week / staff', 'hrs')}
          {F('credentialingRate', 'Cred rate', '$/hr')}
          {F('credentialingTurnaround', 'Cred turnaround', 'days')}
          {F('schedulingGapRate', 'Schedule gap rate', '%')}
          {F('providerSatisfaction', 'Provider satisfaction', '/10')}
        </div>
        <Label>Notes</Label>
        <textarea
          value={form.notes || ''}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
          style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: 12, fontFamily: 'inherit', fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, padding: '10px 22px', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave(form)} style={{ background: C.good, color: C.bg, border: 'none', padding: '10px 22px', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' }}>Save baseline</button>
        </div>
      </div>
    </div>
  )
}

function EmptyBaseline() {
  return (
    <div style={{ ...card, textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 28, color: C.text, fontWeight: 300, marginBottom: 8 }}>No baseline yet</div>
      <div style={{ color: C.muted, marginBottom: 16, fontSize: 14 }}>Set this customer's "before SNAP" numbers to start tracking savings.</div>
      <div style={{ color: C.dim, fontSize: 12 }}>Click "Edit baseline" in the header.</div>
    </div>
  )
}

// Small input helpers
function Label({ children }) {
  return <div style={{ ...eyebrow, marginBottom: 4 }}>{children}</div>
}
function Input(props) {
  return (
    <input
      {...props}
      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: 10, fontSize: 13, marginBottom: 12, ...(props.style || {}) }}
    />
  )
}
function progressOf(m) {
  const isReduction = m.target < m.baseline
  if (isReduction) {
    const totalChange = m.baseline - m.target
    const actualChange = m.baseline - m.actual
    if (totalChange === 0) return 0
    return Math.max(0, Math.min(100, (actualChange / totalChange) * 100))
  }
  const totalChange = m.target - m.baseline
  const actualChange = m.actual - m.baseline
  if (totalChange === 0) return 0
  return Math.max(0, Math.min(100, (actualChange / totalChange) * 100))
}
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10 }

// ── Page ────────────────────────────────────────────────────────────────

export default function AdminRoiPage({ preselectedFacilityId } = {}) {
  const [facilities, setFacilities] = useState([])
  const [rollup, setRollup] = useState(null)
  const [facilityId, setFacilityId] = useState(preselectedFacilityId || '')
  const [month, setMonth] = useState(todayMonthKey())
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoPulled, setAutoPulled] = useState({})
  const [autoOverride, setAutoOverride] = useState(null) // {key: value} pulled but not yet saved
  const [editorOpen, setEditorOpen] = useState(false)

  const loadFacilities = useCallback(async () => {
    const [list, rollupRes] = await Promise.all([
      adminAPI.getRoiFacilities().catch(() => ({ facilities: [] })),
      adminAPI.getRoiRollup().catch(() => null),
    ])
    setFacilities(list.facilities || [])
    setRollup(rollupRes)
    if (!facilityId && list.facilities?.length > 0) {
      setFacilityId(list.facilities[0].id)
    }
  }, [facilityId])

  const loadData = useCallback(async () => {
    if (!facilityId) return
    setLoading(true)
    try {
      const res = await adminAPI.getRoiForFacility(facilityId, month)
      // Layer auto-pulled overrides on top of the selected snapshot so the
      // Metrics tab reflects pre-fills without writing to disk.
      if (autoOverride && Object.keys(autoOverride).length > 0) {
        res.selected = { ...(res.selected || {}), ...autoOverride }
        // Recompute progress with the overrides on the fly.
        // (Server computes from the saved snapshot only; we mutate locally
        // for the UI.) The displayed slider value drives liveProgress in
        // MetricsTab, so the only thing we need correct here is `selected`.
      }
      setData(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [facilityId, month, autoOverride])

  useEffect(() => { loadFacilities() }, [loadFacilities])
  useEffect(() => { loadData() }, [loadData])

  const selectedFacility = facilities.find((f) => f.id === facilityId)
  const months = useMemo(() => {
    if (!data?.snapshots) return [todayMonthKey()]
    const set = new Set([todayMonthKey()])
    for (const s of data.snapshots) set.add(monthKey(s.month))
    return Array.from(set).sort().reverse()
  }, [data])

  async function saveSnapshot(form) {
    setSaving(true)
    try {
      const body = { month, ...form, autoPulled }
      await adminAPI.saveRoiSnapshot(facilityId, body)
      setAutoOverride(null)
      await loadData()
      await loadFacilities()
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  async function autoPull(metricKey) {
    try {
      const res = await adminAPI.autoPullRoi(facilityId, month)
      const val = res[metricKey]
      if (val == null) {
        alert('No data found for that metric this month.')
        return
      }
      setAutoOverride((p) => ({ ...(p || {}), [metricKey]: val }))
      setAutoPulled((p) => ({ ...(p || {}), [metricKey]: true }))
    } catch (e) {
      alert('Auto-pull failed: ' + (e.message || 'Unknown error'))
    }
  }

  async function saveBaseline(form) {
    try {
      await adminAPI.saveRoiBaseline(facilityId, form)
      setEditorOpen(false)
      await loadData()
      await loadFacilities()
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown error'))
    }
  }

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: C.bg, minHeight: '100vh', color: C.text }}>
      <PrintStyles />
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '24px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ ...eyebrow, marginBottom: 4 }}>SNAP Medical</div>
            <div style={{ fontSize: 22, fontWeight: 400, color: C.text }}>ROI Tracker</div>
          </div>
          <div className="roi-no-print" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '8px 12px', fontSize: 13, minWidth: 220 }}
            >
              {facilities.length === 0 && <option value="">No facilities yet</option>}
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>{f.name}{!f.hasBaseline ? ' · no baseline' : ''}</option>
              ))}
            </select>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '8px 12px', fontSize: 13 }}
            >
              {months.map((m) => <option key={m} value={m}>{fmtMonth(m + '-01')}</option>)}
            </select>
            {facilityId && (
              <button onClick={() => setEditorOpen(true)} style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.dim, padding: '8px 14px', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' }}>
                {data?.baseline ? 'Edit baseline' : 'Set baseline'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="roi-no-print" style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '0 32px' }}>
        <Tab active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</Tab>
        <Tab active={tab === 'metrics'} onClick={() => setTab('metrics')}>Metrics</Tab>
        <Tab active={tab === 'sales-case'} onClick={() => setTab('sales-case')}>Sales Case</Tab>
        <Tab active={tab === 'prospect'} onClick={() => setTab('prospect')}>Prospect Projection</Tab>
        {tab === 'sales-case' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8 }}>
            <button onClick={() => window.print()} style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.dim, padding: '6px 12px', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' }}>
              ⎙ Export PDF
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: 32 }}>
        {/* Rollup band — hidden on Sales Case + Prospect (those are the customer/prospect view). */}
        {(tab === 'dashboard' || tab === 'metrics') && <div className="roi-no-print"><RollupBand rollup={rollup} /></div>}

        {!facilityId ? (
          <div style={{ ...card, textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 18, color: C.text, marginBottom: 8 }}>No facilities yet.</div>
            <div style={{ color: C.muted, fontSize: 13 }}>Once a facility exists, pick it above to start an ROI baseline.</div>
          </div>
        ) : loading ? (
          <div style={{ color: C.muted, padding: 20 }}>Loading…</div>
        ) : !data ? null : (
          <>
            {tab === 'dashboard' && <DashboardTab data={data} />}
            {tab === 'metrics' && (
              <MetricsTab
                data={data}
                monthKey={month}
                onSave={saveSnapshot}
                onAutoPull={autoPull}
                autoPulled={autoPulled}
                saving={saving}
              />
            )}
            {tab === 'sales-case' && (
              <SalesCaseTab data={data} customerName={selectedFacility?.name || data.facility.name} snapshotMonth={data.selected?.month} />
            )}
            {tab === 'prospect' && <ProspectTab facilities={facilities} />}
          </>
        )}
      </div>

      <BaselineEditor
        open={editorOpen}
        facility={selectedFacility}
        baseline={data?.baseline}
        onSave={saveBaseline}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  )
}

// ── Print styles (Sales Case → PDF) ────────────────────────────────────

function PrintStyles() {
  return (
    <style>{`
      @media print {
        .roi-no-print { display: none !important; }
        .roi-print-header { display: block !important; padding: 12px 0 16px; border-bottom: 1px solid #999; margin-bottom: 24px; color: #000; }
        body { background: #fff !important; color: #000 !important; }
        * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
        a { text-decoration: none; }
      }
    `}</style>
  )
}
