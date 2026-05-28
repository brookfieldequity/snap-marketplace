import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

const PANEL_META = {
  TEAM_MODEL: {
    title: 'Team Model Inefficiency',
    icon: '⚖️',
    desc: 'Your provider supervision ratio is below the optimal 1:4 (one anesthesiologist supervising four CRNAs). Days where the ratio falls below 1:3 represent overpaid coverage that could be restructured.',
  },
  FRIDAY_SHORTAGE: {
    title: 'Friday CRNA Shortage',
    icon: '📅',
    desc: 'Your CRNA-to-ANES ratio drops significantly on Fridays compared to Mon-Thu. This means more expensive anesthesiologist-heavy coverage on the highest-turnover day of the week.',
  },
  UTILIZATION: {
    title: 'Staffing Utilization Summary',
    icon: '📊',
    desc: 'Overview of facility-level staffing efficiency based on uploaded scheduling data.',
  },
  // Legacy types for backward compat
  LATE_SCHEDULING: {
    title: 'Late Scheduling Premium',
    icon: '⏰',
    desc: 'When shifts are filled within 7 days of the date, you pay a premium. This analysis shows the cost of your late scheduling patterns and which provider types are most affected.',
  },
  PROVIDER_MIX: {
    title: 'Provider Mix Optimization',
    icon: '⚖️',
    desc: 'Your current mix of CRNAs, Anesthesiologists, and Anesthesia Assistants may not be optimal for your case volume and complexity. Adjusting this mix can significantly reduce your per-case cost.',
  },
  DEMAND_FORECAST: {
    title: '30-Day Demand Forecast',
    icon: '📈',
    desc: 'Based on your historical scheduling patterns, this forecast shows predicted high-demand days over the next 30 days. Plan ahead to avoid last-minute gaps.',
  },
}

function fmt(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const RISK_COLORS = { high: '#FEF2F2', medium: '#FFFBEB', low: '#F0FDF4' }
const RISK_TEXT   = { high: '#DC2626', medium: '#D97706', low: '#15803D' }

function UtilizationBar({ pct }) {
  const color = pct > 90 ? '#EF4444' : pct < 60 ? '#94A3B8' : '#10B981'
  return (
    <div style={{ background: '#F1F5F9', borderRadius: 6, height: 8, width: '100%', overflow: 'hidden' }}>
      <div style={{ background: color, width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
    </div>
  )
}

function LateSchedulingPanel({ data }) {
  const rows = data?.byProviderType || []
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {['Provider Type', 'Avg Lead Days', 'Affected Shifts', 'Annual Cost Premium'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No data available</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '10px 12px', fontWeight: 500, color: '#0F172A' }}>{r.providerType}</td>
              <td style={{ padding: '10px 12px', color: r.avgLeadDays < 7 ? '#DC2626' : '#374151', fontWeight: r.avgLeadDays < 7 ? 700 : 400 }}>{r.avgLeadDays?.toFixed(1) ?? '—'} days</td>
              <td style={{ padding: '10px 12px', color: '#374151' }}>{r.affectedShifts ?? '—'}</td>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#DC2626' }}>{fmt(r.annualCostPremium)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProviderMixPanel({ data }) {
  const current = data?.currentMix || {}
  const optimized = data?.optimizedMix || {}
  const types = ['CRNA', 'ANESTHESIOLOGIST', 'ANESTHESIA_ASSISTANT']
  const colors = { CRNA: '#3B82F6', ANESTHESIOLOGIST: '#7C3AED', ANESTHESIA_ASSISTANT: '#0F766E' }
  const labels = { CRNA: 'CRNA', ANESTHESIOLOGIST: 'Anesthesiologist', ANESTHESIA_ASSISTANT: 'Anesthesia Asst.' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {['Current Mix', 'Optimized Mix'].map((title, col) => {
          const mix = col === 0 ? current : optimized
          return (
            <div key={title}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>{title}</div>
              {types.map(t => (
                <div key={t} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#374151' }}>{labels[t]}</span>
                    <span style={{ fontWeight: 700, color: colors[t] }}>{mix[t] ?? 0}%</span>
                  </div>
                  <div style={{ background: '#F1F5F9', borderRadius: 4, height: 6 }}>
                    <div style={{ background: colors[t], width: `${mix[t] ?? 0}%`, height: '100%', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {data?.potentialSavings && (
        <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15803D', fontWeight: 600 }}>
          Estimated potential savings from mix optimization: {fmt(data.potentialSavings)}/year
        </div>
      )}
    </div>
  )
}

function DemandForecastPanel({ data }) {
  const days = data?.forecastDays || []
  if (days.length === 0) return <div style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>No forecast data available.</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
      {days.map((d, i) => {
        const risk = d.risk || 'low'
        const dateObj = new Date(d.date)
        return (
          <div key={i} title={`${d.date} — ${risk} demand`} style={{ background: RISK_COLORS[risk] || '#F8FAFC', border: `1px solid ${RISK_TEXT[risk] || '#CBD5E1'}33`, borderRadius: 6, padding: '5px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>
              {dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: RISK_TEXT[risk] || '#374151', marginTop: 2 }}>
              {risk === 'high' ? '🔴' : risk === 'medium' ? '🟡' : '🟢'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Legacy UtilizationPanel — kept for backward compat (logicalType = 'UTILIZATION' now uses UtilizationSummaryPanel)
function UtilizationPanel({ data }) {
  const providers = data?.providers || []
  if (providers.length === 0) return <div style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>No utilization data available.</div>
  const sorted = [...providers].sort((a, b) => (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((p, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ fontWeight: 500, color: '#0F172A' }}>{p.providerName}</span>
            <span style={{ fontWeight: 700, color: p.utilizationPct > 90 ? '#EF4444' : p.utilizationPct < 60 ? '#94A3B8' : '#10B981' }}>
              {p.utilizationPct ?? 0}%
            </span>
          </div>
          <UtilizationBar pct={p.utilizationPct ?? 0} />
          {p.utilizationPct > 90 && (
            <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3, fontWeight: 500 }}>⚠️ Overutilized — burnout risk</div>
          )}
        </div>
      ))}
    </div>
  )
}

function TeamModelPanel({ data }) {
  const pct = data?.inefficiencyPct ?? 0
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Location: {data?.facilityName}
      </div>
      <div style={{ fontSize: 14, color: '#374151', marginBottom: 14, fontWeight: 500 }}>
        <span style={{ fontWeight: 700, color: '#0F172A' }}>{data?.inefficientDays}</span> of{' '}
        <span style={{ fontWeight: 700, color: '#0F172A' }}>{data?.totalDays}</span> working days had suboptimal coverage
      </div>
      {/* Progress bar */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ background: '#F1F5F9', borderRadius: 6, height: 12, width: '100%', overflow: 'hidden' }}>
          <div style={{ background: '#EF4444', width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: 12, color: '#EF4444', fontWeight: 600, marginTop: 4 }}>{pct}% inefficient days</div>
      </div>
      {/* Annual waste badge */}
      <div style={{ display: 'inline-block', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#DC2626', marginTop: 10 }}>
        Estimated annual waste: {fmt(data?.annualWaste)}
      </div>
      {/* Clinical override note */}
      {data?.clinicalOverrideDays > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#94A3B8', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 12px' }}>
          Note: {data.clinicalOverrideDays} days flagged as potential clinical necessity (solo ANES) — excluded from waste calculation
        </div>
      )}
    </div>
  )
}

function FridayShortagePanel({ data }) {
  const weekdayRatio = data?.avgWeekdayRatio ?? 0
  const fridayRatio = data?.avgFridayRatio ?? 0
  const maxRatio = 4.0

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
        Location: {data?.facilityName}
      </div>
      {/* Ratio comparison side-by-side */}
      <div style={{ display: 'flex', gap: 32, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Mon–Thu Average</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#10B981', letterSpacing: '-0.02em' }}>1:{weekdayRatio.toFixed(1)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Friday Average</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#EF4444', letterSpacing: '-0.02em' }}>1:{fridayRatio.toFixed(1)}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, marginBottom: 18 }}>
        {data?.fridayRatioDrop}% drop in CRNA coverage on Fridays
      </div>
      {/* Bar visualization */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>Weekday</div>
          <div style={{ background: '#F1F5F9', borderRadius: 6, height: 10, width: '100%', overflow: 'hidden' }}>
            <div style={{ background: '#10B981', width: `${(weekdayRatio / maxRatio) * 100}%`, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>Friday</div>
          <div style={{ background: '#F1F5F9', borderRadius: 6, height: 10, width: '100%', overflow: 'hidden' }}>
            <div style={{ background: '#F97316', width: `${(fridayRatio / maxRatio) * 100}%`, height: '100%', borderRadius: 6, transition: 'width 0.4s' }} />
          </div>
        </div>
      </div>
      {/* Annual premium */}
      <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px' }}>
        This Friday shortage costs an estimated{' '}
        <span style={{ fontWeight: 700, color: '#DC2626' }}>${data?.fridayAnnualPremium?.toLocaleString()}/year</span>{' '}
        in excess anesthesiologist coverage
      </div>
    </div>
  )
}

function UtilizationSummaryPanel({ data }) {
  const rows = data?.facilityBreakdown || []
  const score = data?.score ?? null
  const scoreColor = score == null ? '#94A3B8' : score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444'

  return (
    <div>
      {/* Score badge */}
      {score != null && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Current StaffIQ Score:</div>
          <div style={{ background: scoreColor + '1A', border: `1px solid ${scoreColor}55`, borderRadius: 20, padding: '4px 14px', fontSize: 14, fontWeight: 800, color: scoreColor }}>
            {score}
          </div>
        </div>
      )}
      {/* Facility breakdown table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {['Facility', 'Avg Rooms/Day', 'Inefficient Days %', 'Annual Waste'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No data available</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0F172A' }}>{r.facilityName}</td>
              <td style={{ padding: '10px 12px', color: '#374151' }}>{r.avgRooms}</td>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: r.inefficiencyPct > 30 ? '#EF4444' : '#F59E0B' }}>{r.inefficiencyPct}%</td>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#DC2626' }}>{fmt(r.annualWaste)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Total row */}
      {data?.totalAnnualWaste != null && (
        <div style={{ marginTop: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
          Combined annual waste: ${data.totalAnnualWaste.toLocaleString()}
        </div>
      )}
    </div>
  )
}

export default function StaffIQInsightsPage({ onNavigate }) {
  const [insights, setInsights] = useState([])
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [insightData, uploadData] = await Promise.all([
        facilityAPI.getStaffIQInsights().catch(() => []),
        facilityAPI.getUploads().catch(() => []),
      ])
      setInsights(Array.isArray(insightData) ? insightData : insightData.insights || [])
      setUploads(Array.isArray(uploadData) ? uploadData : uploadData.uploads || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRunAnalysis() {
    setRunning(true)
    try {
      await facilityAPI.runStaffIQAnalysis()
      await load()
    } catch (e) {
      alert('Analysis failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  function renderInsightBody(insight) {
    const logicalType = insight.logicalType || insight.insightType
    const data = insight.insightData || insight.data || {}
    if (logicalType === 'TEAM_MODEL') return <TeamModelPanel data={data} />
    if (logicalType === 'FRIDAY_SHORTAGE') return <FridayShortagePanel data={data} />
    if (logicalType === 'UTILIZATION') return <UtilizationSummaryPanel data={data} />
    if (logicalType === 'LATE_SCHEDULING') return <LateSchedulingPanel data={data} />
    if (logicalType === 'PROVIDER_MIX') return <ProviderMixPanel data={data} />
    if (logicalType === 'DEMAND_FORECAST') return <DemandForecastPanel data={data} />
    return null
  }

  const hasUploads = uploads.length > 0
  const hasInsights = insights.length > 0

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
            StaffIQ™ Insights
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>AI-powered staffing intelligence for your facility</p>
        </div>
        <button
          onClick={handleRunAnalysis}
          disabled={running || loading}
          style={{ padding: '11px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(99,102,241,0.35)' }}
        >
          {running ? (
            <>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Running Analysis...
            </>
          ) : '⚡ Run Analysis'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading insights...</div>}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 20 }}>
          Error: {error}
        </div>
      )}

      {/* No upload prompt */}
      {!loading && !hasUploads && (
        <div style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)', border: '1px solid #A5B4FC', borderRadius: 16, padding: '32px 36px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 48 }}>📤</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
              Upload your scheduling data to unlock StaffIQ insights
            </div>
            <div style={{ fontSize: 14, color: '#64748B', marginBottom: 16 }}>
              Import your historical schedule from QGenda, Schedule4, OpenShift, or any CSV export to enable AI-powered analysis.
            </div>
            <button
              onClick={() => onNavigate('data-upload')}
              style={{ padding: '11px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Upload Scheduling Data →
            </button>
          </div>
        </div>
      )}

      {/* Insight panels */}
      {!loading && hasInsights && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {insights.map((insight, i) => {
            const logicalType = insight.logicalType || insight.insightType
            const meta = PANEL_META[logicalType] || { title: logicalType, icon: '📊', desc: '' }
            const dollarImpact = insight.dollarImpactEstimate ?? insight.dollarImpact ?? insight.annualImpact ?? insight.savingsAmount ?? null
            const lastAnalyzed = insight.generatedAt || insight.lastAnalyzedAt || insight.createdAt

            return (
              <div key={i} style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '28px 32px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                {/* Panel header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{meta.icon}</span>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{meta.title}</div>
                      {lastAnalyzed && (
                        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                          Last analyzed: {new Date(lastAnalyzed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                  </div>
                  {dollarImpact != null && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 32, fontWeight: 900, color: '#10B981', letterSpacing: '-0.03em' }}>
                        {fmt(dollarImpact)}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic', marginTop: 2 }}>Powered by StaffIQ™</div>
                    </div>
                  )}
                </div>

                {/* Description */}
                <p style={{ fontSize: 14, color: '#64748B', marginBottom: 20, lineHeight: 1.6 }}>{meta.desc}</p>

                {/* Type-specific breakdown */}
                {renderInsightBody(insight)}

                {/* SNAP Solution */}
                {insight.snapSolution && (
                  <div style={{ marginTop: 24, borderTop: '1px solid #E2E8F0', paddingTop: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                      SNAP Solution
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: 0, flex: 1 }}>
                        {insight.snapSolution.message}
                      </p>
                      <button
                        onClick={() => {
                          const action = insight.snapSolution.buttonAction
                          if (action === 'create-incentive') onNavigate('incentive')
                          else if (action === 'friday-alerts') onNavigate('windows')
                          else if (action === 'post-shift') onNavigate('dashboard')
                          else onNavigate('windows')
                        }}
                        style={{ padding: '10px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(99,102,241,0.35)', flexShrink: 0 }}
                      >
                        {insight.snapSolution.buttonLabel} →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state with uploads but no insights */}
      {!loading && hasUploads && !hasInsights && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>No insights generated yet</div>
          <div style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>Click "Run Analysis" to generate StaffIQ insights from your scheduling data.</div>
          <button onClick={handleRunAnalysis} disabled={running} style={{ padding: '11px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            ⚡ Run Analysis Now
          </button>
        </div>
      )}
    </div>
  )
}
