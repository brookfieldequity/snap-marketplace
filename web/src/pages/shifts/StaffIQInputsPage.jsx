import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

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

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      {hint && (
        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6, lineHeight: 1.4 }}>{hint}</div>
      )}
      {children}
    </div>
  )
}

const ZONE_COLORS = { red: '#EF4444', yellow: '#F59E0B', green: '#10B981', blue: '#3B82F6' }

const DEFAULT_FORM = {
  totalLocations: '',
  avgRoomsPerDay: '',
  ftAnesthesiologists: '',
  ftCRNAs: '',
  perDiemAnesthesiologists: '',
  perDiemCRNAs: '',
  agencyAnesthesiologists: '',
  agencyCRNAs: '',
  avgHourlyAnesthesiologist: '',
  avgHourlyCRNA: '',
  avgShiftLength: 10,
  operatingDaysPerYear: 250,
  primaryTeamModel: '1:2',
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

  function xPos(i) { return padL + (i / (n - 1)) * innerW }
  function yPos(score) { return padT + innerH - (score / 100) * innerH }

  const pts = history.map((d, i) => ({ x: xPos(i), y: yPos(d.score), score: d.score, label: d.label || d.date }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')

  // Zone bands background
  const zoneBands = [
    { start: 0, end: 40, color: '#EF4444' },
    { start: 40, end: 70, color: '#F59E0B' },
    { start: 70, end: 89, color: '#10B981' },
    { start: 89, end: 100, color: '#3B82F6' },
  ]

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* Zone background bands */}
      {zoneBands.map((band, i) => {
        const y1 = padT + innerH - (band.end / 100) * innerH
        const bandH = ((band.end - band.start) / 100) * innerH
        return (
          <rect
            key={i}
            x={padL}
            y={y1}
            width={innerW}
            height={bandH}
            fill={band.color}
            opacity={0.1}
          />
        )
      })}

      {/* Axis lines */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="#E2E8F0" strokeWidth={1} />
      <line x1={padL} y1={padT + innerH} x2={padL + innerW} y2={padT + innerH} stroke="#E2E8F0" strokeWidth={1} />

      {/* Y axis labels */}
      {[0, 25, 50, 75, 100].map(v => (
        <text key={v} x={padL - 4} y={yPos(v) + 4} textAnchor="end" fontSize={9} fill="#94A3B8">{v}</text>
      ))}

      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#6366F1" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots + labels */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#6366F1" />
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
          setForm(prev => ({ ...prev, ...data }))
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
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)
    try {
      const data = await facilityAPI.saveStaffIQInputs(form)
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
                style={inputStyle}
                type="number"
                min="1"
                value={form.totalLocations}
                onChange={e => setF('totalLocations', e.target.value)}
                placeholder="e.g. 20"
              />
            </Field>
            <Field
              label="Average Rooms Run Per Day"
              hint="Your typical daily utilization. E.g. if you have 20 rooms but typically run 15, enter 15."
            >
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={form.avgRoomsPerDay}
                onChange={e => setF('avgRoomsPerDay', e.target.value)}
                placeholder="e.g. 15"
              />
            </Field>
          </div>

          {/* Row 2: FT staff */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Full Time Anesthesiologists Employed">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.ftAnesthesiologists}
                onChange={e => setF('ftAnesthesiologists', e.target.value)}
                placeholder="e.g. 4"
              />
            </Field>
            <Field label="Full Time CRNAs Employed">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.ftCRNAs}
                onChange={e => setF('ftCRNAs', e.target.value)}
                placeholder="e.g. 12"
              />
            </Field>
          </div>

          {/* Row 3: Per diem */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Per Diem Anesthesiologists Per Month (avg)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.perDiemAnesthesiologists}
                onChange={e => setF('perDiemAnesthesiologists', e.target.value)}
                placeholder="e.g. 2"
              />
            </Field>
            <Field label="Per Diem CRNAs Per Month (avg)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.perDiemCRNAs}
                onChange={e => setF('perDiemCRNAs', e.target.value)}
                placeholder="e.g. 5"
              />
            </Field>
          </div>

          {/* Row 4: Agency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Agency Anesthesiologists Per Month (avg)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyAnesthesiologists}
                onChange={e => setF('agencyAnesthesiologists', e.target.value)}
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="Agency CRNAs Per Month (avg)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.agencyCRNAs}
                onChange={e => setF('agencyCRNAs', e.target.value)}
                placeholder="e.g. 3"
              />
            </Field>
          </div>

          {/* Row 5: Hourly rates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Average Hourly Rate — Anesthesiologists ($)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.avgHourlyAnesthesiologist}
                onChange={e => setF('avgHourlyAnesthesiologist', e.target.value)}
                placeholder="e.g. 320"
              />
            </Field>
            <Field label="Average Hourly Rate — CRNAs ($)">
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.avgHourlyCRNA}
                onChange={e => setF('avgHourlyCRNA', e.target.value)}
                placeholder="e.g. 215"
              />
            </Field>
          </div>

          {/* Row 6: Shift length & operating days */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 4 }}>
            <Field label="Average Shift Length (hours)">
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="24"
                value={form.avgShiftLength}
                onChange={e => setF('avgShiftLength', Number(e.target.value))}
              />
            </Field>
            <Field label="Operating Days Per Year">
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="365"
                value={form.operatingDaysPerYear}
                onChange={e => setF('operatingDaysPerYear', Number(e.target.value))}
              />
            </Field>
          </div>

          {/* Team model */}
          <Field label="Primary Team Model Currently Used">
            <select
              style={inputStyle}
              value={form.primaryTeamModel}
              onChange={e => setF('primaryTeamModel', e.target.value)}
            >
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
              background: submitting ? '#A5B4FC' : '#6366F1',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : '0 4px 14px rgba(99,102,241,0.4)',
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

          {(result.teamModelInefficiencyPct != null || result.overstaffingPct != null) && (
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 20, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.teamModelInefficiencyPct != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#FEF2F2', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Team Model Inefficiency</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                    {result.teamModelInefficiencyPct}% of budget = {fmt(result.teamModelInefficiencyCost)}/year
                  </span>
                </div>
              )}
              {result.overstaffingPct != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#FFFBEB', borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Overstaffing Waste</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#D97706' }}>
                    {result.overstaffingPct}% of budget = {fmt(result.overstaffingCost)}/year
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 20, padding: '14px 18px', background: '#EEF2FF', borderRadius: 10, fontSize: 13, color: '#4338CA', lineHeight: 1.6 }}>
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
