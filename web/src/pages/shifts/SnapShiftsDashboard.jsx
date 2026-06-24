import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

function fmt(n) {
  if (n == null || n === 0) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtPct(n) {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────────
function Skeleton({ width = '100%', height = 20, radius = 6 }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }}
    />
  )
}

// ─── StaffIQ Gauge ────────────────────────────────────────────────────────────
function StaffIQGauge({ score, status, zone, period, onPeriodChange }) {
  const cx = 150, cy = 140, r = 110;
  const toRad = (deg) => (deg * Math.PI) / 180;

  function arcPath(startScore, endScore) {
    const startDeg = -180 + (startScore / 100) * 180;
    const endDeg = -180 + (endScore / 100) * 180;
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(endDeg));
    const y2 = cy + r * Math.sin(toRad(endDeg));
    const large = (endScore - startScore) > 50 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  const hasScore = score != null;
  const needleDeg = -180 + ((hasScore ? score : 0) / 100) * 180;
  const needleRad = toRad(needleDeg);
  const needleLen = 85;
  const nx = cx + needleLen * Math.cos(needleRad);
  const ny = cy + needleLen * Math.sin(needleRad);

  const zoneColors = { red: '#EF4444', yellow: '#F59E0B', green: '#10B981', blue: '#3B82F6', neutral: '#94A3B8' };
  const zoneColor = hasScore ? (zoneColors[zone] || '#10B981') : '#CBD5E1';

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #E2E8F0', padding: '24px 28px', width: 360, flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      {/* Period toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
        {['today', 'week', 'month'].map(p => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            style={{
              flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: period === p ? '#2563EB' : 'transparent',
              color: period === p ? '#fff' : '#64748B',
            }}
          >
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
          </button>
        ))}
      </div>

      {/* SVG Gauge */}
      <svg width={300} height={160} style={{ display: 'block', margin: '0 auto' }}>
        {/* Background arc */}
        <path d={arcPath(0, 100)} fill="none" stroke="#E2E8F0" strokeWidth={20} strokeLinecap="round" />
        {/* Color zone arcs */}
        <path d={arcPath(0, 40)} fill="none" stroke="#EF4444" strokeWidth={20} />
        <path d={arcPath(40, 70)} fill="none" stroke="#F59E0B" strokeWidth={20} />
        <path d={arcPath(70, 89)} fill="none" stroke="#10B981" strokeWidth={20} />
        <path d={arcPath(89, 100)} fill="none" stroke="#3B82F6" strokeWidth={20} />
        {/* Needle — hidden until a real score exists */}
        {hasScore && (
          <>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0F172A" strokeWidth={3} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={6} fill="#0F172A" />
          </>
        )}
        {/* Score text */}
        <text x={cx} y={cy - 20} textAnchor="middle" fontSize={42} fontWeight={900} fill={zoneColor}>{hasScore ? score : '—'}</text>
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={12} fill="#64748B">StaffIQ Score</text>
      </svg>

      {/* Status message */}
      <div style={{ textAlign: 'center', fontSize: 12, color: '#475569', lineHeight: 1.5, marginTop: 4, minHeight: 36 }}>
        {status || (hasScore ? '' : 'Upload scheduling data and run an analysis to generate your StaffIQ score.')}
      </div>
      <div style={{ textAlign: 'center', fontSize: 10, color: '#94A3B8', fontStyle: 'italic', marginTop: 6 }}>
        Powered by StaffIQ™
      </div>
    </div>
  );
}

// ─── Unified hero: "StaffIQ saves you $X / month" ────────────────────────────
// One number, the single savings authority. Shows projected→realized state and
// the two levers underneath; never fabricates a number on a data-less facility.
function UnifiedSavingsCard({ unified, loading }) {
  const cardShell = {
    background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
    borderRadius: 20,
    padding: '36px 40px',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15,23,42,0.4), 0 0 0 2px rgba(251,191,36,0.25)',
    border: '1px solid rgba(251,191,36,0.3)',
  }

  if (loading) {
    return <div style={cardShell}><Skeleton width="60%" height={64} radius={8} /></div>
  }

  // No baseline + no data yet → invite input rather than show a fake number.
  if (!unified || unified.monthly == null || unified.basis === 'insufficient') {
    return (
      <div style={cardShell}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FCD34D', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
          ⭐ STAFFIQ SAVINGS
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>
          Add your staffing numbers to see your savings
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.5 }}>
          Enter rooms, rates, and current agency use in StaffIQ Inputs and we'll project your monthly savings — it sharpens as your schedules come in.
        </div>
      </div>
    )
  }

  const isProjected = unified.basis === 'projected'
  const components = unified.components || []

  return (
    <div style={cardShell}>
      <div style={{ position: 'absolute', top: -80, right: -80, width: 240, height: 240, background: 'radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FCD34D', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          ⭐ STAFFIQ SAVES YOU
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 20,
          background: isProjected ? 'rgba(59,130,246,0.18)' : 'rgba(16,185,129,0.18)',
          color: isProjected ? '#93C5FD' : '#6EE7B7',
          border: `1px solid ${isProjected ? 'rgba(59,130,246,0.4)' : 'rgba(16,185,129,0.4)'}`,
        }}>
          {isProjected ? 'PROJECTED' : 'REALIZED'}
        </span>
      </div>

      {/* Hero monthly number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{
          fontSize: 64, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1,
          background: 'linear-gradient(135deg, #FCD34D 0%, #10B981 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
        }}>
          {fmt(unified.monthly)}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#94A3B8' }}>/month</div>
      </div>

      {/* Annualized, always visible */}
      <div style={{ fontSize: 15, fontWeight: 700, color: '#10B981', marginTop: 4 }}>
        = {fmt(unified.annual)} / year
      </div>

      {/* Two levers (the breakdown) */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 18, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {components.map((c) => (
          <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 500 }}>{c.label}</span>
            <span style={{ fontSize: 14, color: '#E2E8F0', fontWeight: 700 }}>{fmt(c.monthly)}/mo</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#64748B', marginTop: 14, lineHeight: 1.5 }}>
        {isProjected
          ? 'Projected from your inputs — refines automatically as your real schedules and fills come in.'
          : `Based on your facility's own data · ${unified.confidence}% confidence and climbing.`}
      </div>
    </div>
  )
}

// ─── Savings hero card ────────────────────────────────────────────────────────
function SavingsCard({ label, monthValue, ytdValue, loading, size = 'normal' }) {
  const isTotal = size === 'large'
  return (
    <div
      style={{
        flex: 1,
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        borderRadius: 20,
        padding: isTotal ? '36px 40px' : '28px 32px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: isTotal
          ? '0 24px 64px rgba(15,23,42,0.4), 0 0 0 2px rgba(251,191,36,0.25)'
          : '0 16px 48px rgba(15,23,42,0.25)',
        border: isTotal ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(37,99,235,0.2)',
      }}
    >
      {/* Glow decorations */}
      <div
        style={{
          position: 'absolute',
          top: -80,
          right: -80,
          width: 240,
          height: 240,
          background: isTotal
            ? 'radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(37,99,235,0.2) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -50,
          left: -50,
          width: 180,
          height: 180,
          background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: isTotal ? '#FCD34D' : '#64748B',
          letterSpacing: '0.08em',
          marginBottom: 6,
          textTransform: 'uppercase',
        }}
      >
        {isTotal ? '⭐ TOTAL SNAP SAVINGS' : label}
      </div>

      {/* Month value */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 4 }}>
          This Month
        </div>
        {loading ? (
          <Skeleton width="60%" height={isTotal ? 56 : 44} radius={8} />
        ) : (
          <div
            style={{
              fontSize: isTotal ? 64 : 48,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              background: isTotal
                ? 'linear-gradient(135deg, #FCD34D 0%, #10B981 100%)'
                : 'none',
              WebkitBackgroundClip: isTotal ? 'text' : 'unset',
              WebkitTextFillColor: isTotal ? 'transparent' : '#10B981',
              color: isTotal ? 'transparent' : '#10B981',
              textShadow: isTotal ? 'none' : '0 0 40px rgba(16,185,129,0.35)',
            }}
          >
            {fmt(monthValue)}
          </div>
        )}
      </div>

      {/* YTD value */}
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.07)',
          paddingTop: 14,
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 500, flexShrink: 0 }}>
          Year to Date
        </div>
        {loading ? (
          <Skeleton width="50%" height={24} radius={4} />
        ) : (
          <div
            style={{
              fontSize: isTotal ? 30 : 24,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              background: isTotal
                ? 'linear-gradient(135deg, #FCD34D 0%, #10B981 100%)'
                : 'none',
              WebkitBackgroundClip: isTotal ? 'text' : 'unset',
              WebkitTextFillColor: isTotal ? 'transparent' : '#10B981',
              color: isTotal ? 'transparent' : '#10B981',
            }}
          >
            {fmt(ytdValue)}
          </div>
        )}
      </div>

    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color = '#2563EB', sub, loading, accent }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: '20px 24px',
        border: accent ? `1px solid ${accent}40` : '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#64748B',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 20 }}>{icon}</div>
      </div>
      {loading ? (
        <>
          <Skeleton width="55%" height={32} radius={4} />
          {sub !== undefined && (
            <div style={{ marginTop: 6 }}>
              <Skeleton width="75%" height={14} radius={3} />
            </div>
          )}
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color,
              letterSpacing: '-0.02em',
            }}
          >
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{sub}</div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Fallback mock data ───────────────────────────────────────────────────────
export default function SnapShiftsDashboard({ onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeMsg, setAnalyzeMsg] = useState('')
  const [staffiqScore, setStaffiqScore] = useState({ score: null, status: '', zone: 'neutral', calculationMethod: 'default' })
  const [scorePeriod, setScorePeriod] = useState('month')

  async function loadDashboard() {
    setLoading(true)
    setError(null)
    try {
      const d = await facilityAPI.getStaffIQDashboard()
      setData(d)
    } catch (err) {
      // Never show fabricated data — render the empty/zero state and prompt to
      // upload scheduling data when the API has nothing yet.
      setData(null)
      if (err.status === 404 || err.status === 422) {
        setError('no-data')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  useEffect(() => {
    facilityAPI.getStaffIQScore(scorePeriod)
      .then(res => {
        if (!res) return;
        // status comes back as { label, message, zone } — flatten it
        setStaffiqScore({
          score: res.score ?? null,
          status: res.status?.message || (typeof res.status === 'string' ? res.status : '') || '',
          zone: res.status?.zone || res.zone || 'yellow',
          calculationMethod: res.calculationMethod || 'default',
        });
      })
      .catch(() => {}); // keep default on error
  }, [scorePeriod])

  async function handleRunAnalysis() {
    setAnalyzing(true)
    setAnalyzeMsg('')
    try {
      await facilityAPI.runStaffIQAnalysis()
      setAnalyzeMsg('Analysis complete!')
      await loadDashboard()
    } catch {
      setAnalyzeMsg('Analysis failed — please upload scheduling data first.')
    } finally {
      setAnalyzing(false)
    }
  }

  const d = data || {}
  // Map the real /staffiq/dashboard response into the flat view-model this
  // page renders. Backend savings are nested ({internal,agencyReplacement,
  // total}:{month,ytd}); the stat fields are top-level. Unknown fields stay
  // null/0 — never fabricated.
  const rawSavings = d.savings || {}
  const savings = {
    efficiencyMonth:        rawSavings.internal?.month || 0,
    efficiencyYtd:          rawSavings.internal?.ytd || 0,
    agencyReplacementMonth: rawSavings.agencyReplacement?.month || 0,
    agencyReplacementYtd:   rawSavings.agencyReplacement?.ytd || 0,
    totalMonth:             rawSavings.total?.month || 0,
    totalYtd:               rawSavings.total?.ytd || 0,
  }
  // The hero "StaffIQ saves you $X/month" number (single savings authority).
  const unified = rawSavings.unified || null
  const upcoming = d.upcomingShifts || []
  const stats = {
    upcomingShifts14Days:         upcoming.length,
    upcomingFilled:               upcoming.filter((s) => s.fillStatus === 'FILLED').length,
    predictedGaps30Days:          (d.predictedGaps || []).length,
    gapDaysUntilCritical:         null, // not provided by the API
    providerUtilizationPct:       d.utilizationRate ?? null, // already 0–100
    avgFillLeadTimeDays:          d.avgFillLeadTime ?? null,
    avgFillLeadTimeLastMonthDays: null, // not provided → no trend shown
    incentiveShiftsThisMonth:     d.incentiveShiftsThisMonth || 0,
    incentiveFillRate:            null, // not provided by the API
    escalatedToMarketplace:       d.escalationsThisMonth || 0,
  }

  const gapColor =
    stats.predictedGaps30Days === 0
      ? '#10B981'
      : stats.gapDaysUntilCritical < 14
      ? '#EF4444'
      : '#F59E0B'

  const leadTimeDelta =
    stats.avgFillLeadTimeDays != null && stats.avgFillLeadTimeLastMonthDays != null
      ? stats.avgFillLeadTimeDays - stats.avgFillLeadTimeLastMonthDays
      : null
  const leadTimeTrend =
    leadTimeDelta == null
      ? ''
      : leadTimeDelta < 0
      ? `▼ ${Math.abs(leadTimeDelta).toFixed(1)}d faster vs last month`
      : leadTimeDelta > 0
      ? `▲ ${leadTimeDelta.toFixed(1)}d slower vs last month`
      : 'Same as last month'

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1300, margin: '0 auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 36,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: '#0F172A',
              letterSpacing: '-0.02em',
              marginBottom: 4,
            }}
          >
            📊 SNAP Shifts Dashboard
          </h1>
          <p style={{ fontSize: 15, color: '#64748B' }}>
            Internal scheduling intelligence — powered by StaffIQ™
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => onNavigate('data-upload')}
            style={{
              padding: '11px 20px',
              background: '#fff',
              color: '#2563EB',
              border: '1.5px solid #2563EB',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#EFF6FF'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff'
            }}
          >
            📤 Upload Scheduling Data
          </button>
          <button
            onClick={handleRunAnalysis}
            disabled={analyzing}
            style={{
              padding: '11px 20px',
              background: analyzing ? '#A5B4FC' : '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: analyzing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              boxShadow: analyzing ? 'none' : '0 4px 14px rgba(37,99,235,0.4)',
              transition: 'all 0.15s ease',
            }}
          >
            🧠 {analyzing ? 'Analyzing…' : 'Run StaffIQ Analysis'}
          </button>
        </div>
      </div>

      {/* Analyze result message */}
      {analyzeMsg && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 18px',
            borderRadius: 10,
            background: analyzeMsg.includes('failed') ? '#FEF2F2' : '#ECFDF5',
            border: `1px solid ${analyzeMsg.includes('failed') ? '#FCA5A5' : '#6EE7B7'}`,
            color: analyzeMsg.includes('failed') ? '#DC2626' : '#059669',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {analyzeMsg}
        </div>
      )}

      {/* No-data prompt */}
      {error === 'no-data' && (
        <div
          style={{
            marginBottom: 28,
            padding: '20px 24px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 28 }}>📂</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#92400E', fontSize: 15, marginBottom: 3 }}>
              No scheduling data yet
            </div>
            <div style={{ fontSize: 13, color: '#B45309' }}>
              Upload your existing schedule to activate StaffIQ™ savings calculations. The numbers below are illustrative.
            </div>
          </div>
          <button
            onClick={() => onNavigate('data-upload')}
            style={{
              padding: '10px 18px',
              background: '#F59E0B',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Upload Now →
          </button>
        </div>
      )}

      {/* ── SAVINGS SECTION ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 36 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 20 }}>💰</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
            Savings Overview
          </h2>
          <div
            style={{
              background: '#ECFDF5',
              border: '1px solid #6EE7B7',
              color: '#059669',
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 20,
              letterSpacing: '0.04em',
            }}
          >
            StaffIQ™ Powered
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, marginBottom: 32, alignItems: 'flex-start' }}>
          <StaffIQGauge
            score={staffiqScore.score}
            status={staffiqScore.status || staffiqScore.message}
            zone={staffiqScore.zone}
            period={scorePeriod}
            onPeriodChange={setScorePeriod}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <UnifiedSavingsCard unified={unified} loading={loading} />
          </div>
        </div>
      </div>

      {/* ── STATS GRID ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: '#0F172A',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>📈</span> Operational Snapshot
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          <StatCard
            label="Upcoming Shifts (14 Days)"
            value={
              loading
                ? '—'
                : `${stats.upcomingShifts14Days ?? 0} shifts`
            }
            sub={
              loading
                ? undefined
                : `${stats.upcomingFilled ?? 0} filled · ${
                    (stats.upcomingShifts14Days ?? 0) - (stats.upcomingFilled ?? 0)
                  } open`
            }
            icon="📅"
            color="#2563EB"
            loading={loading}
          />

          <StatCard
            label="Predicted Gaps (30 Days)"
            value={loading ? '—' : stats.predictedGaps30Days ?? 0}
            sub={
              loading
                ? undefined
                : stats.predictedGaps30Days === 0
                ? 'No gaps predicted — great!'
                : `${stats.gapDaysUntilCritical ?? '?'}d until coverage critical`
            }
            icon={stats.predictedGaps30Days === 0 ? '✅' : stats.gapDaysUntilCritical < 14 ? '🔴' : '🟡'}
            color={gapColor}
            accent={gapColor}
            loading={loading}
          />

          <StatCard
            label="Provider Utilization"
            value={loading ? '—' : fmtPct(stats.providerUtilizationPct)}
            sub={loading ? undefined : 'of internal roster this month'}
            icon="👥"
            color={
              (stats.providerUtilizationPct ?? 0) >= 80
                ? '#10B981'
                : (stats.providerUtilizationPct ?? 0) >= 60
                ? '#F59E0B'
                : '#EF4444'
            }
            loading={loading}
          />

          <StatCard
            label="Avg Shift Fill Lead Time"
            value={
              loading
                ? '—'
                : stats.avgFillLeadTimeDays != null
                ? `${stats.avgFillLeadTimeDays.toFixed(1)}d`
                : '—'
            }
            sub={loading ? undefined : leadTimeTrend}
            icon="⏱"
            color="#0F172A"
            loading={loading}
          />

          <StatCard
            label="Incentive Shifts (Month)"
            value={loading ? '—' : stats.incentiveShiftsThisMonth ?? 0}
            sub={
              loading
                ? undefined
                : `${fmtPct(stats.incentiveFillRate)} fill rate`
            }
            icon="🔴"
            color="#EF4444"
            loading={loading}
          />

          <StatCard
            label="Escalated to Marketplace"
            value={loading ? '—' : stats.escalatedToMarketplace ?? 0}
            sub={loading ? undefined : 'shifts sent to SNAP Marketplace'}
            icon="🌐"
            color="#2563EB"
            loading={loading}
          />
        </div>
      </div>

      {/* ── Quick nav ────────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 36,
          padding: '24px 28px',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          borderRadius: 16,
          border: '1px solid rgba(37,99,235,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', marginBottom: 4 }}>
            Ready to optimize your schedule?
          </div>
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Build your schedule, manage your roster, and track availability windows.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: '📅 Schedule Builder', key: 'schedule' },
            { label: '👥 Internal Roster', key: 'roster' },
            { label: '🗓 Availability Windows', key: 'windows' },
          ].map((link) => (
            <button
              key={link.key}
              onClick={() => onNavigate(link.key)}
              style={{
                padding: '9px 16px',
                background: 'rgba(37,99,235,0.15)',
                border: '1px solid rgba(37,99,235,0.3)',
                borderRadius: 8,
                color: '#A5B4FC',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(37,99,235,0.28)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(37,99,235,0.15)'
                e.currentTarget.style.color = '#A5B4FC'
              }}
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
