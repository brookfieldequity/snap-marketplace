import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'
import NumberInput from '../../components/NumberInput.jsx'

function fmt(n) {
  if (n == null || n === 0) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 14,
  color: '#0F172A',
  background: '#F8FAFC',
  boxSizing: 'border-box',
}

function Field({ label, hint, optional, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
        {optional && (
          <span style={{ fontSize: 10, fontWeight: 500, color: '#94A3B8', textTransform: 'none', letterSpacing: 0, background: '#F1F5F9', borderRadius: 4, padding: '1px 6px' }}>
            optional
          </span>
        )}
      </label>
      {hint && (
        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6, lineHeight: 1.4 }}>{hint}</div>
      )}
      {children}
    </div>
  )
}

const ZONE_COLORS = { red: '#EF4444', yellow: '#F59E0B', green: '#10B981', blue: '#3B82F6' }

// Field names match backend schema exactly
const DEFAULT_FORM = {
  totalLocations: '',
  avgRoomsPerDay: '',
  ftAnesthesiologists: '',
  ftCrnas: '',
  pdAnesthesiologistsPerMonth: '',
  pdCrnasPerMonth: '',
  agencyAnesthesiologistsPerMonth: '',
  agencyCrnasPerMonth: '',
  agencyAnesthesiologistRate: '',
  agencyCrnaRate: '',
  avgAnesthesiologistRate: '',
  avgCrnaRate: '',
  avgShiftHours: 10,
  operatingDaysPerYear: 250,
  primaryTeamModel: '',
}

// ─── Score History SVG Line Chart ─────────────────────────────────────────────
function ScoreHistoryChart({ history }) {
  if (!history || history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>
        Your score history will appear here as you submit data over time.
      </div>
    )
  }

  const W = 700, H = 160, padL = 36, padR = 16, padT = 16, padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const n = history.length

  function xPos(i) { return padL + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2) }
  function yPos(score) { return padT + innerH - (score / 100) * innerH }

  const pts = history.map((d, i) => ({ x: xPos(i), y: yPos(d.score), score: d.score, label: d.label || d.calculatedAt }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')

  const zoneBands = [
    { start: 0, end: 40, color: '#EF4444' },
    { start: 40, end: 70, color: '#F59E0B' },
    { start: 70, end: 89, color: '#10B981' },
    { start: 89, end: 100, color: '#3B82F6' },
  ]

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {zoneBands.map((band, i) => {
        const y1 = padT + innerH - (band.end / 100) * innerH
        const bandH = ((band.end - band.start) / 100) * innerH
        return <rect key={i} x={padL} y={y1} width={innerW} height={bandH} fill={band.color} opacity={0.1} />
      })}
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="#E2E8F0" strokeWidth={1} />
      <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH} stroke="#E2E8F0" strokeWidth={1} />
      {[0, 25, 50, 75, 100].map(v => (
        <text key={v} x={padL - 4} y={yPos(v) + 4} textAnchor="end" fontSize={9} fill="#94A3B8">{v}</text>
      ))}
      {n > 1 && <polyline points={polyline} fill="none" stroke="#2563EB" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#2563EB" />
          <text x={p.x} y={padT + innerH + 18} textAnchor="middle" fontSize={9} fill="#64748B">
            {typeof p.label === 'string' ? p.label.slice(5, 10).replace('-', '/') : ''}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StaffIQInputsPage({ onNavigate }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    facilityAPI.getStaffIQInputs()
      .then(data => {
        if (data && typeof data === 'object') {
          // Field names already match backend schema
          setForm(prev => ({
            ...prev,
            totalLocations: data.totalLocations ?? '',
            avgRoomsPerDay: data.avgRoomsPerDay ?? '',
            ftAnesthesiologists: data.ftAnesthesiologists ?? '',
            ftCrnas: data.ftCrnas ?? '',
            pdAnesthesiologistsPerMonth: data.pdAnesthesiologistsPerMonth ?? '',
            pdCrnasPerMonth: data.pdCrnasPerMonth ?? '',
            agencyAnesthesiologistsPerMonth: data.agencyAnesthesiologistsPerMonth ?? '',
            agencyCrnasPerMonth: data.agencyCrnasPerMonth ?? '',
            agencyAnesthesiologistRate: data.agencyAnesthesiologistRate ?? '',
            agencyCrnaRate: data.agencyCrnaRate ?? '',
            avgAnesthesiologistRate: data.avgAnesthesiologistRate ?? '',
            avgCrnaRate: data.avgCrnaRate ?? '',
            avgShiftHours: data.avgShiftHours ?? 10,
            operatingDaysPerYear: data.operatingDaysPerYear ?? 250,
            primaryTeamModel: data.primaryTeamModel ?? '',
          }))
        }
      })
      .catch(() => {})

    facilityAPI.getStaffIQScoreHistory()
      .then(data => setHistory(Array.isArray(data) ? data : (data?.history || null)))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false))
  }, [])

  function setF(k, v) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.totalLocations) {
      setSubmitError('Total anesthetizing locations is required.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)
    try {
      // Send only non-empty fields; backend applies defaults for missing ones
      const payload = { totalLocations: form.totalLocations }
      if (form.avgRoomsPerDay !== '') payload.avgRoomsPerDay = form.avgRoomsPerDay
      if (form.ftAnesthesiologists !== '') payload.ftAnesthesiologists = form.ftAnesthesiologists
      if (form.ftCrnas !== '') payload.ftCrnas = form.ftCrnas
      if (form.pdAnesthesiologistsPerMonth !== '') payload.pdAnesthesiologistsPerMonth = form.pdAnesthesiologistsPerMonth
      if (form.pdCrnasPerMonth !== '') payload.pdCrnasPerMonth = form.pdCrnasPerMonth
      if (form.agencyAnesthesiologistsPerMonth !== '') payload.agencyAnesthesiologistsPerMonth = form.agencyAnesthesiologistsPerMonth
      if (form.agencyCrnasPerMonth !== '') payload.agencyCrnasPerMonth = form.agencyCrnasPerMonth
      if (form.agencyAnesthesiologistRate !== '') payload.agencyAnesthesiologistRate = form.agencyAnesthesiologistRate
      if (form.agencyCrnaRate !== '') payload.agencyCrnaRate = form.agencyCrnaRate
      if (form.avgAnesthesiologistRate !== '') payload.avgAnesthesiologistRate = form.avgAnesthesiologistRate
      if (form.avgCrnaRate !== '') payload.avgCrnaRate = form.avgCrnaRate
      if (form.avgShiftHours) payload.avgShiftHours = form.avgShiftHours
      if (form.operatingDaysPerYear) payload.operatingDaysPerYear = form.operatingDaysPerYear
      if (form.primaryTeamModel) payload.primaryTeamModel = form.primaryTeamModel

      const data = await facilityAPI.saveStaffIQInputs(payload)
      setResult(data)
    } catch (err) {
      setSubmitError(err.message || 'Failed to save inputs. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const resultZoneColor = result ? (ZONE_COLORS[result.zone] || '#10B981') : '#10B981'

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
          StaffIQ Data Input
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Enter your facility's staffing details to calculate your personalized StaffIQ score.
        </p>
      </div>

      {/* Quick-start note */}
      <div style={{ padding: '14px 18px', background: '#EFF6FF', border: '1px solid #C7D2FE', borderRadius: 10, marginBottom: 24, fontSize: 13, color: '#1E40AF', lineHeight: 1.6 }}>
        <strong>Only one field is required to get your score.</strong> Enter your total anesthetizing locations and we'll apply industry-standard defaults for any fields you leave blank ($390/hr ANES, $260/hr CRNA, 75% utilization, mixed team model).
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '32px 36px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 24 }}>
            Facility Staffing Details
          </div>

          {/* Row 1: Locations & Rooms */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Total Anesthetizing Locations">
              <input
                style={{ ...inputStyle, border: '1px solid #2563EB' }}
                type="number"
                min="1"
                value={form.totalLocations}
                onChange={e => setF('totalLocations', e.target.value)}
                placeholder="e.g. 20  ← required"
              />
            </Field>
            <Field
              label="Average Rooms Run Per Day"
              optional
              hint="Default: 75% of total locations. E.g. 20 rooms → assumes 15 active per day."
            >
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={form.avgRoomsPerDay}
                onChange={e => setF('avgRoomsPerDay', e.target.value)}
                placeholder="default: 75% of locations"
              />
            </Field>
          </div>

          {/* Row 2: FT staff */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Full Time Anesthesiologists Employed" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.ftAnesthesiologists}
                onChange={e => setF('ftAnesthesiologists', e.target.value)}
                placeholder="e.g. 4"
              />
            </Field>
            <Field label="Full Time CRNAs Employed" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.ftCrnas}
                onChange={e => setF('ftCrnas', e.target.value)}
                placeholder="e.g. 12"
              />
            </Field>
          </div>

          {/* Row 3: Per diem */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Per Diem Anesthesiologists Per Month (avg)" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.pdAnesthesiologistsPerMonth}
                onChange={e => setF('pdAnesthesiologistsPerMonth', e.target.value)}
                placeholder="e.g. 2"
              />
            </Field>
            <Field label="Per Diem CRNAs Per Month (avg)" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.pdCrnasPerMonth}
                onChange={e => setF('pdCrnasPerMonth', e.target.value)}
                placeholder="e.g. 5"
              />
            </Field>
          </div>

          {/* Row 4: Agency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Agency Anesthesiologists Per Month (avg)" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyAnesthesiologistsPerMonth}
                onChange={e => setF('agencyAnesthesiologistsPerMonth', e.target.value)}
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="Agency CRNAs Per Month (avg)" optional>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyCrnasPerMonth}
                onChange={e => setF('agencyCrnasPerMonth', e.target.value)}
                placeholder="e.g. 3"
              />
            </Field>
          </div>

          {/* Row 4b: Agency bill rates — what agencies actually charge this
              facility. Optional; when blank the savings math uses regional
              estimates ($425/$300) and labels the number "estimated". */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Agency Bill Rate — Anesthesiologists ($/hr)" optional hint="What agencies charge you. Blank = regional estimate ($425/hr)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyAnesthesiologistRate}
                onChange={e => setF('agencyAnesthesiologistRate', e.target.value)}
                placeholder="estimate: $425"
              />
            </Field>
            <Field label="Agency Bill Rate — CRNAs ($/hr)" optional hint="What agencies charge you. Blank = regional estimate ($300/hr)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyCrnaRate}
                onChange={e => setF('agencyCrnaRate', e.target.value)}
                placeholder="estimate: $300"
              />
            </Field>
          </div>

          {/* Row 5: Hourly rates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Average Hourly Rate — Anesthesiologists ($)" optional hint="Default: $390/hr">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.avgAnesthesiologistRate}
                onChange={e => setF('avgAnesthesiologistRate', e.target.value)}
                placeholder="default: $390"
              />
            </Field>
            <Field label="Average Hourly Rate — CRNAs ($)" optional hint="Default: $260/hr">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.avgCrnaRate}
                onChange={e => setF('avgCrnaRate', e.target.value)}
                placeholder="default: $260"
              />
            </Field>
          </div>

          {/* Row 6: Shift length & operating days */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Average Shift Length (hours)" optional hint="Default: 10 hours">
              <NumberInput
                style={inputStyle}
                min="1"
                max="24"
                value={form.avgShiftHours}
                onChange={n => setF('avgShiftHours', n)}
              />
            </Field>
            <Field label="Operating Days Per Year" optional hint="Default: 250 days">
              <NumberInput
                style={inputStyle}
                min="1"
                max="365"
                value={form.operatingDaysPerYear}
                onChange={n => setF('operatingDaysPerYear', n)}
              />
            </Field>
          </div>

          {/* Team model */}
          <Field label="Primary Team Model Currently Used" optional hint="Default: Mixed models">
            <select
              style={inputStyle}
              value={form.primaryTeamModel}
              onChange={e => setF('primaryTeamModel', e.target.value)}
            >
              <option value="">Mixed Models (default)</option>
              <option value="1:3">Mostly 1:3 (1 Anesthesiologist + 3 CRNAs) — Efficient</option>
              <option value="solo">Mostly Solo Anesthesiologists — Efficient</option>
              <option value="1:2">Mostly 1:2 (1 Anesthesiologist + 2 CRNAs) — Industry standard waste</option>
              <option value="mixed">Mixed Models</option>
            </select>
          </Field>

          {submitError && (
            <div style={{ padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 16 }}>
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '12px 28px',
              background: submitting ? '#A5B4FC' : '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : '0 4px 14px rgba(37,99,235,0.4)',
            }}
          >
            {submitting ? 'Calculating…' : 'Calculate My StaffIQ Score →'}
          </button>
        </div>
      </form>

      {/* Result card */}
      {result && (
        <div style={{ background: '#fff', borderRadius: 16, border: `2px solid ${resultZoneColor}40`, padding: '32px 36px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Your StaffIQ Score
          </div>
          <div style={{ fontSize: 72, fontWeight: 900, color: resultZoneColor, letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 8 }}>
            {result.score}
          </div>
          <div style={{ fontSize: 15, color: '#475569', marginBottom: 20 }}>
            {result.status || result.message}
          </div>

          {(result.inefficiency1Pct != null || result.inefficiency2Pct != null) && (
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 20, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.inefficiency1Pct != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#FEF2F2', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Team Model Inefficiency</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                    {result.inefficiency1Pct}% of budget = {fmt(result.inefficiency1Cost)}/year
                  </span>
                </div>
              )}
              {result.inefficiency2Pct != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#FFFBEB', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Overstaffing / Utilization Gap</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#D97706' }}>
                    {result.inefficiency2Pct}% of budget = {fmt(result.inefficiency2Cost)}/year
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 20, padding: '14px 18px', background: '#EFF6FF', borderRadius: 10, fontSize: 13, color: '#1E40AF', lineHeight: 1.6 }}>
            Your StaffIQ score has been calculated based on your inputs. Upload your scheduling data for an even more accurate analysis.
          </div>
        </div>
      )}

      {/* Score History Chart */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '28px 32px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>
          Score History
        </div>
        {historyLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#94A3B8', fontSize: 13 }}>
            Loading score history…
          </div>
        ) : (
          <ScoreHistoryChart history={history} />
        )}
      </div>
    </div>
  )
}
