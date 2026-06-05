import React, { useState } from 'react'
import { facilityAPI } from '../../api.js'
import StaffIQRecommendations from './StaffIQRecommendations.jsx'

/**
 * Schedule Builder v2 flow component.
 *
 * State machine:
 *   'picking'  → user chooses modes and clicks Build
 *   'building' → backend running, spinner shown
 *   'comparing'→ 4 cards side-by-side with score + insights + Use-this CTA
 *   'done'     → one selected; component closes via onSelected callback
 *
 * Renders as a full-page modal overlay. Parent (ScheduleBuilderPage) renders
 * this when its showBuildFlow state is true and closes via onClose.
 */

const MODES = [
  {
    key: 'COST_EFFICIENT',
    label: 'Cost-Efficient',
    icon: '💰',
    description: 'Lowest labor cost. Prefers cheaper rates and full-time staff. Best when budget is tight.',
  },
  {
    key: 'HIGHEST_QUALITY',
    label: 'Highest Quality',
    icon: '⭐',
    description: 'Most senior + most reliable providers. Fewer locums. Best for high-stakes weeks.',
  },
  {
    key: 'HYBRID',
    label: 'Hybrid',
    icon: '⚖️',
    description: 'Balanced 50/50 between cost and quality. The safe middle.',
  },
  {
    key: 'STAFFIQ',
    label: 'Let StaffIQ Decide',
    icon: '🧠',
    description: 'Algorithm tilts the weighting based on your practice\'s historical priorities. Gets smarter every build.',
  },
]

function fmtMoney(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US')
}

function MonthName(year, month) {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export default function ScheduleBuildFlow({ year, month, onSelected, onClose, industryRoomRate }) {
  const [phase, setPhase] = useState('picking') // 'picking' | 'building' | 'comparing'
  const [selectedModes, setSelectedModes] = useState(new Set(MODES.map((m) => m.key))) // default: all 4
  const [runs, setRuns] = useState([])
  const [error, setError] = useState(null)
  const [selecting, setSelecting] = useState(null) // runId being applied

  function toggleMode(key) {
    const next = new Set(selectedModes)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedModes(next)
  }

  async function startBuild(modes) {
    setError(null)
    setPhase('building')
    try {
      const res = await facilityAPI.buildSchedule(year, month, modes)
      setRuns(res.runs || [])
      setPhase('comparing')
    } catch (err) {
      setError(err.message || 'Build failed.')
      setPhase('picking')
    }
  }

  async function selectRun(run) {
    setSelecting(run.id)
    setError(null)
    try {
      const res = await facilityAPI.selectBuildRun(run.id)
      onSelected({ run, message: res.message, assignmentsApplied: res.assignmentsApplied })
    } catch (err) {
      setError(err.message || 'Could not apply this build.')
    } finally {
      setSelecting(null)
    }
  }

  return (
    <div style={styles.overlay} onClick={phase === 'building' ? null : onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.headerEyebrow}>Build the Schedule</div>
            <div style={styles.headerTitle}>{MonthName(year, month)}</div>
          </div>
          {phase !== 'building' && (
            <button style={styles.closeBtn} onClick={onClose}>✕</button>
          )}
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {phase === 'picking' && (
          <PickingPhase
            selectedModes={selectedModes}
            toggleMode={toggleMode}
            onRunAll={() => startBuild(MODES.map((m) => m.key))}
            onRunSelected={() => startBuild([...selectedModes])}
          />
        )}

        {phase === 'building' && <BuildingPhase modes={[...selectedModes]} />}

        {phase === 'comparing' && (
          <ComparingPhase
            runs={runs}
            onSelect={selectRun}
            selecting={selecting}
            onBack={() => setPhase('picking')}
            industryRoomRate={industryRoomRate}
          />
        )}
      </div>
    </div>
  )
}

// ─── Phase: picking modes ────────────────────────────────────────────────────

function PickingPhase({ selectedModes, toggleMode, onRunAll, onRunSelected }) {
  return (
    <>
      <p style={styles.body}>
        Pick one or more strategies. We&apos;ll generate a candidate schedule for each, score them with StaffIQ,
        and let you compare side-by-side.
      </p>

      <div style={styles.modeGrid}>
        {MODES.map((m) => {
          const isOn = selectedModes.has(m.key)
          return (
            <button
              key={m.key}
              style={{ ...styles.modeCard, ...(isOn ? styles.modeCardOn : {}) }}
              onClick={() => toggleMode(m.key)}
            >
              <div style={styles.modeIcon}>{m.icon}</div>
              <div style={styles.modeLabel}>{m.label}</div>
              <div style={styles.modeDesc}>{m.description}</div>
              {isOn && <div style={styles.modeChecked}>✓ selected</div>}
            </button>
          )
        })}
      </div>

      <div style={styles.actions}>
        <button
          style={styles.secondaryBtn}
          onClick={onRunSelected}
          disabled={selectedModes.size === 0}
        >
          Run {selectedModes.size} selected
        </button>
        <button style={styles.primaryBtn} onClick={onRunAll}>
          🚀 Run all 4 and compare
        </button>
      </div>
    </>
  )
}

// ─── Phase: building (spinner) ───────────────────────────────────────────────

function BuildingPhase({ modes }) {
  return (
    <div style={styles.buildingWrap}>
      <div style={styles.spinner}>⟳</div>
      <div style={styles.buildingTitle}>StaffIQ is building your schedule…</div>
      <div style={styles.buildingSub}>
        Running {modes.length} {modes.length === 1 ? 'strategy' : 'strategies'} in parallel. This usually takes a few seconds.
      </div>
      <div style={styles.buildingList}>
        {modes.map((m) => (
          <div key={m} style={styles.buildingItem}>
            <span>{MODES.find((x) => x.key === m)?.icon}</span>
            <span>{MODES.find((x) => x.key === m)?.label}</span>
            <span style={styles.buildingItemStatus}>computing…</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Phase: comparing results ────────────────────────────────────────────────

function ComparingPhase({ runs, onSelect, selecting, onBack, industryRoomRate }) {
  // Sort by score descending so the "winner" reads naturally
  const sorted = [...runs].sort((a, b) => (b.staffiqScore || 0) - (a.staffiqScore || 0))
  const topScore = sorted[0]?.staffiqScore || 0

  return (
    <>
      <p style={styles.body}>
        Here&apos;s how each strategy played out. Pick the one you want to apply &mdash; you can still edit any day afterward.
      </p>

      <div style={styles.compareGrid}>
        {sorted.map((run, idx) => {
          const mode = MODES.find((m) => m.key === run.mode)
          const isTop = idx === 0 && (run.staffiqScore || 0) === topScore && runs.length > 1
          const failed = run.status === 'FAILED'
          const insights = run.insights || {}
          return (
            <div key={run.id} style={{ ...styles.compareCard, ...(isTop ? styles.compareCardTop : {}) }}>
              {isTop && <div style={styles.topBadge}>TOP PICK</div>}
              <div style={styles.compareIcon}>{mode?.icon}</div>
              <div style={styles.compareLabel}>{mode?.label}</div>

              {failed ? (
                <div style={styles.compareFailed}>
                  Build failed.
                  <div style={styles.compareFailedReason}>
                    {(run.warnings && run.warnings[0]) || 'Unknown error.'}
                  </div>
                </div>
              ) : (
                <>
                  <div style={styles.compareScoreRow}>
                    <div style={styles.compareScore}>{run.staffiqScore}</div>
                    <div style={styles.compareScoreLabel}>StaffIQ score</div>
                  </div>

                  <div style={styles.insightsList}>
                    <InsightRow
                      label="Total cost"
                      value={fmtMoney(insights.totalCost)}
                      sub={`avg ${fmtMoney(insights.avgRatePerHour)}/hr`}
                    />
                    <InsightRow
                      label="Rooms filled"
                      value={`${(run.assignmentCount || 0) - (insights.supervisingMds || 0)}`}
                      sub={`${insights.uniqueProvidersUsed || 0} unique providers`}
                    />
                    {insights.supervisingMds > 0 && (
                      <InsightRow
                        label="Care team"
                        value={`${insights.crnaRooms || 0} CRNA · ${insights.supervisingMds} MD`}
                        sub="CRNA rooms / supervising anesthesiologists"
                      />
                    )}
                    <InsightRow
                      label="Staff mix"
                      value={`${insights.fullTimeUsed || 0}/${insights.perDiemUsed || 0}/${insights.locumsUsed || 0}`}
                      sub="FT / per-diem / locum"
                    />
                    <InsightRow
                      label="Avg reliability"
                      value={
                        insights.avgReliability != null
                          ? `${Math.round(insights.avgReliability * 100)}%`
                          : '—'
                      }
                    />
                  </div>

                  {industryRoomRate > 0 && insights.roomDays > 0 && (() => {
                    const baseline = industryRoomRate * insights.roomDays
                    const savings = baseline - (insights.totalCost || 0)
                    const pct = baseline > 0 ? Math.round((savings / baseline) * 100) : 0
                    const good = savings >= 0
                    const defaulted = insights.defaultRateProviders || 0
                    return (
                      <div style={good ? styles.savingsBlock : styles.savingsBlockBad}>
                        <div style={{ ...styles.savingsTop, color: good ? '#065F46' : '#991B1B' }}>
                          {good ? 'Saves ' : 'Over by '}{fmtMoney(Math.abs(savings))}/mo
                        </div>
                        <div style={{ ...styles.savingsSub, color: good ? '#047857' : '#B91C1C' }}>
                          vs {fmtMoney(baseline)} your way · {Math.abs(pct)}% {good ? 'below' : 'above'}
                        </div>
                        {defaulted > 0 && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#92400E', fontWeight: 600 }}>
                            ⚠️ {defaulted} provider{defaulted !== 1 ? 's' : ''} on estimated rates — approximate
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {run.warnings && run.warnings.length > 0 && (
                    <div style={styles.warningsBlock}>
                      ⚠ {run.warnings.length} warning{run.warnings.length === 1 ? '' : 's'}
                      <div style={styles.warningsList}>
                        {run.warnings.slice(0, 3).map((w, i) => (
                          <div key={i} style={styles.warning}>{w}</div>
                        ))}
                        {run.warnings.length > 3 && <div style={styles.warning}>+ {run.warnings.length - 3} more</div>}
                      </div>
                    </div>
                  )}

                  <StaffIQRecommendations recommendations={run.staffiqRecommendations} compact />

                  <button
                    style={styles.useBtn}
                    onClick={() => onSelect(run)}
                    disabled={selecting === run.id}
                  >
                    {selecting === run.id ? 'Applying…' : 'Use this schedule'}
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={styles.actions}>
        <button style={styles.secondaryBtn} onClick={onBack}>← Back to strategies</button>
      </div>
    </>
  )
}

function InsightRow({ label, value, sub }) {
  return (
    <div style={styles.insightRow}>
      <div style={styles.insightLabel}>{label}</div>
      <div style={styles.insightValueWrap}>
        <div style={styles.insightValue}>{value}</div>
        {sub && <div style={styles.insightSub}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 2000, padding: 32, overflowY: 'auto',
  },
  modal: {
    background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 1200,
    minHeight: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerEyebrow: { fontSize: 11, fontWeight: 700, color: '#6366F1', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 },
  headerTitle: { fontSize: 26, fontWeight: 800, color: '#1E293B' },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, color: '#64748B', cursor: 'pointer', padding: 8 },
  errorBanner: { background: '#FEF2F2', color: '#991B1B', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 },
  body: { color: '#64748B', fontSize: 14, lineHeight: 1.6, marginBottom: 24 },

  // Picking phase
  modeGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 },
  modeCard: {
    textAlign: 'left', padding: 20, background: '#fff',
    border: '2px solid #E2E8F0', borderRadius: 12, cursor: 'pointer',
    transition: 'all 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, position: 'relative',
  },
  modeCardOn: { borderColor: '#6366F1', background: '#F5F3FF' },
  modeIcon: { fontSize: 28 },
  modeLabel: { fontSize: 16, fontWeight: 700, color: '#1E293B' },
  modeDesc: { fontSize: 13, color: '#64748B', lineHeight: 1.5 },
  modeChecked: { fontSize: 11, fontWeight: 700, color: '#6366F1', marginTop: 4 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12 },
  secondaryBtn: { padding: '12px 24px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  primaryBtn: { padding: '12px 24px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' },

  // Building phase
  buildingWrap: { padding: '60px 40px', textAlign: 'center' },
  spinner: { fontSize: 48, color: '#6366F1', animation: 'spin 1.5s linear infinite' /* note: actual spin requires keyframes */ },
  buildingTitle: { fontSize: 18, fontWeight: 700, color: '#1E293B', marginTop: 16 },
  buildingSub: { fontSize: 14, color: '#64748B', marginTop: 8, marginBottom: 24 },
  buildingList: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400, margin: '0 auto' },
  buildingItem: { display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#F8FAFC', borderRadius: 8, fontSize: 14, color: '#475569' },
  buildingItemStatus: { marginLeft: 'auto', fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },

  // Comparing phase
  compareGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 },
  compareCard: { position: 'relative', padding: 20, background: '#fff', border: '2px solid #E2E8F0', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 },
  compareCardTop: { borderColor: '#10B981', background: '#F0FDF4' },
  topBadge: { position: 'absolute', top: -10, left: 16, padding: '4px 10px', background: '#10B981', color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: 1, borderRadius: 999 },
  compareIcon: { fontSize: 24 },
  compareLabel: { fontSize: 14, fontWeight: 700, color: '#1E293B' },
  compareScoreRow: { display: 'flex', alignItems: 'baseline', gap: 10 },
  compareScore: { fontSize: 36, fontWeight: 800, color: '#6366F1', letterSpacing: '-0.02em' },
  compareScoreLabel: { fontSize: 12, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  insightsList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  insightRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F1F5F9' },
  insightLabel: { fontSize: 12, color: '#64748B' },
  insightValueWrap: { textAlign: 'right' },
  insightValue: { fontSize: 13, fontWeight: 700, color: '#1E293B' },
  insightSub: { fontSize: 10, color: '#94A3B8', marginTop: 2 },
  savingsBlock: { background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 10px', marginTop: 2 },
  savingsBlockBad: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 10px', marginTop: 2 },
  savingsTop: { fontSize: 14, fontWeight: 800, color: '#065F46', letterSpacing: '-0.01em' },
  savingsSub: { fontSize: 10, color: '#047857', marginTop: 1 },
  warningsBlock: { fontSize: 11, color: '#92400E', background: '#FFFBEB', padding: 8, borderRadius: 6, marginTop: 4 },
  warningsList: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 },
  warning: { fontSize: 10, color: '#92400E', lineHeight: 1.4 },
  useBtn: { marginTop: 8, padding: '10px 16px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  compareFailed: { color: '#991B1B', fontSize: 13, fontWeight: 600 },
  compareFailedReason: { color: '#64748B', fontSize: 12, marginTop: 4, fontWeight: 400 },
}
