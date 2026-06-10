import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'
import ScheduleBuildFlow from './ScheduleBuildFlow.jsx'
import StaffIQRecommendations from './StaffIQRecommendations.jsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const EMP_PREFIX = { FULL_TIME: '🔵', PER_DIEM: '🟢', LOCUMS: '🟠' }

// Care-team coverage model label from a ScheduleDay.supervisionRatio.
// null = legacy/role-agnostic (no badge); 0 = MD-only; 3/4 = team ratio.
function coverageLabel(ratio) {
  if (ratio === 0) return { text: 'MD only', bg: '#F5F3FF', color: '#1E3A8A' }
  if (ratio === 3) return { text: 'Team 1:3', bg: '#ECFDF5', color: '#059669' }
  if (ratio === 4) return { text: 'Team 1:4', bg: '#ECFDF5', color: '#059669' }
  return null
}

// Per-room role tag (from ScheduleAssignment.role).
const ROLE_TAG = {
  CRNA_ROOM: { text: 'CRNA', bg: '#EFF6FF', color: '#1D4ED8' },
  SOLO_MD_ROOM: { text: 'Solo MD', bg: '#F5F3FF', color: '#1E3A8A' },
}

// Supervising MDs are stored at roomNumber >= 900 (mirrors scheduleBuilder.js).
const SUPERVISOR_ROOM_BASE = 900

function fmt(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate() }
function getFirstDayOfWeek(year, month) { const d = new Date(year, month - 1, 1).getDay(); return (d + 6) % 7 }

const inputStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC', boxSizing: 'border-box',
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: wide ? 720 : 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StatBox({ label, value, color = '#0F172A', poweredBy }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '14px 20px', minWidth: 110 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{value}</div>
      {poweredBy && <div style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic', marginTop: 2 }}>Powered by StaffIQ™</div>}
    </div>
  )
}

// Baseline-vs-SNAP cost comparison. Coordinator sets the industry-standard
// cost per room/day once (persists on the facility). The panel then renders
// in three progressive stages keyed off the LIVE summary endpoint — not a
// build snapshot — so every room add/remove and every assignment edit moves
// the numbers:
//   1. Rooms exist, no assignments → show the baseline only
//   2. Rooms + assignments         → show baseline + SNAP labor cost + delta
//   3. No rooms yet                → "Add rooms to see…" copy
// summary is { totalShifts, estimatedCost, defaultRateProviders } from
// GET /api/schedule/summary.
function CostComparisonPanel({ rate, summary, onSaveRate, saving, onEditSiteRates }) {
  const hasRate = rate != null && rate > 0
  const [editing, setEditing] = useState(!hasRate)
  const [val, setVal] = useState(hasRate ? String(rate) : '')

  const roomDays = summary?.totalShifts || 0
  const snapCost = summary?.estimatedCost || 0
  // The backend now sums baseline per-site (applying overrides from
  // FacilitySiteRate). Fall back to rate × roomDays when the summary is
  // missing the field (older response shape).
  const baseline = summary?.baselineCost != null
    ? summary.baselineCost
    : (hasRate ? rate * roomDays : 0)
  const savings = baseline - snapCost
  const pct = baseline > 0 ? Math.round((savings / baseline) * 100) : 0
  const good = savings >= 0
  const hasAssignments = snapCost > 0
  const defaultRateCount = summary?.defaultRateProviders || 0
  const siteBreakdown = summary?.siteBreakdown || []
  const overrideCount = siteBreakdown.filter((s) => s.hasOverride).length
  const multiSite = siteBreakdown.length > 1

  async function save() {
    const num = parseFloat(val)
    if (!num || num <= 0) return
    await onSaveRate(num)
    setEditing(false)
  }

  const cell = (label, value, sub, color, big) => (
    <div style={{ flex: 1, minWidth: 150, padding: '12px 16px', background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 22, fontWeight: 800, color, letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>💵 Cost vs. your manual process</div>
        {hasRate && !editing && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button onClick={() => { setVal(String(rate)); setEditing(true) }} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Default {fmt(rate)}/room/day · edit
            </button>
            {onEditSiteRates && (
              <button onClick={onEditSiteRates} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Per-site rates{overrideCount > 0 ? ` (${overrideCount})` : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Industry cost per room, per day</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: 10, color: '#94A3B8' }}>$</span>
              <input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="1500" style={{ ...inputStyle, width: 170, paddingLeft: 22 }} />
            </div>
            <button onClick={save} disabled={saving} style={{ padding: '10px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {hasRate && <button onClick={() => setEditing(false)} style={{ padding: '10px 16px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, maxWidth: 580 }}>
            Your fully-loaded cost to staff one anesthetizing location for one day under your current/agency process. SNAP compares it to what each built schedule actually costs.
          </div>
        </div>
      ) : roomDays === 0 ? (
        <div style={{ fontSize: 13, color: '#64748B' }}>
          Add rooms to this month (via a coverage template or the day editor) to see your manual-process cost{hasRate ? ` at ${fmt(rate)}/room/day` : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
            {cell(
              'Your manual process',
              fmt(baseline),
              multiSite
                ? `${roomDays} room-days across ${siteBreakdown.length} sites`
                : `${roomDays} room-days × ${fmt(rate)}`,
              '#475569'
            )}
            {hasAssignments
              ? cell('SNAP schedule', fmt(snapCost), 'this month · all-in', '#2563EB')
              : cell('SNAP schedule', '—', 'build the schedule to compute', '#94A3B8')
            }
            {hasAssignments
              ? cell(good ? 'You save / month' : 'Over baseline', fmt(Math.abs(savings)), `${Math.abs(pct)}% ${good ? 'below' : 'above'} your process`, good ? '#059669' : '#DC2626', true)
              : cell('Savings', '—', 'available after build', '#94A3B8', true)
            }
          </div>
          {multiSite && siteBreakdown.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#64748B', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {siteBreakdown.map((s) => (
                <span key={s.siteName}>
                  <strong style={{ color: '#0F172A' }}>{s.siteName}</strong> · {s.roomDays} rd × {fmt(s.rateUsed)}{!s.hasOverride && <span style={{ color: '#94A3B8' }}> (default)</span>}
                </span>
              ))}
            </div>
          )}
          {hasAssignments && defaultRateCount > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
              ⚠️ <strong>{defaultRateCount} provider{defaultRateCount !== 1 ? 's' : ''}</strong> in this schedule {defaultRateCount !== 1 ? 'are' : 'is'} using estimated rates — enter their real pay in the roster to refine this savings number.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Given an array of scheduleDay rows for one date, compute fill stats
function getDayStats(dayRows) {
  let totalRooms = 0
  let filledRooms = 0
  let assignedProviders = 0

  dayRows.forEach(row => {
    const required = row.roomsRequired || 1
    totalRooms += required
    const assignments = row.assignments || []
    assignments.forEach(a => {
      assignedProviders++
      if (a.rosterId) filledRooms++
    })
    // Count empty rooms (no assignment row at all)
    const assignedRooms = new Set(assignments.map(a => a.roomNumber))
    for (let r = 1; r <= required; r++) {
      if (!assignedRooms.has(r)) {
        // room exists but no assignment
      } else if (assignments.find(a => a.roomNumber === r && a.rosterId)) {
        // already counted above
      }
    }
    // Recalculate: filled = assignments with a rosterId
    filledRooms = 0
  })

  // Recalculate cleanly
  filledRooms = 0
  assignedProviders = 0
  dayRows.forEach(row => {
    const assignments = row.assignments || []
    assignments.forEach(a => {
      if (a.rosterId) { filledRooms++; assignedProviders++ }
    })
  })

  return { totalRooms, filledRooms, assignedProviders }
}

function getDayColor(dayRows) {
  if (!dayRows || dayRows.length === 0) return null
  const { totalRooms, filledRooms, assignedProviders } = getDayStats(dayRows)
  if (totalRooms === 0) return null
  const gap = totalRooms - filledRooms
  if (assignedProviders > totalRooms) return 'blue'   // overstaffed
  if (gap === 0) return 'green'
  if (gap === 1) return 'yellow'
  return 'red'
}

const STATUS_COLORS = {
  green:  { border: '#86EFAC', bg: '#F0FDF4', text: '#16A34A', label: 'Fully Covered' },
  yellow: { border: '#FCD34D', bg: '#FFFBEB', text: '#D97706', label: '1 Room Short' },
  red:    { border: '#FCA5A5', bg: '#FEF2F2', text: '#DC2626', label: 'Gaps Exist' },
  blue:   { border: '#93C5FD', bg: '#EFF6FF', text: '#2563EB', label: 'Review Coverage' },
}

// Modal for setting/clearing per-site baseline rates. Lists every site
// the current schedule touches (sourced from summary.siteBreakdown) plus
// any other sites that already have an override on file.
function SiteRatesModal({ siteBreakdown, defaultRate, onClose, onDirty }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const { rates } = await facilityAPI.getSiteRates()
        // Union: every site on the current schedule + every site with an
        // existing override (so older overrides for retired sites stay
        // editable instead of silently lingering).
        const overrideMap = new Map(rates.map((r) => [r.siteName, r.ratePerDay]))
        const sched = new Map((siteBreakdown || []).map((s) => [s.siteName, s]))
        const allNames = new Set([...overrideMap.keys(), ...sched.keys()])
        const seeded = [...allNames].sort().map((siteName) => ({
          siteName,
          val: overrideMap.has(siteName) ? String(overrideMap.get(siteName)) : '',
          hasOverride: overrideMap.has(siteName),
          roomDays: sched.get(siteName)?.roomDays || 0,
        }))
        setRows(seeded)
      } catch (e) {
        alert('Failed to load site rates: ' + (e.message || 'Unknown'))
      } finally {
        setLoading(false)
      }
    })()
  }, [siteBreakdown])

  function updateVal(siteName, v) {
    setRows((rs) => rs.map((r) => (r.siteName === siteName ? { ...r, val: v } : r)))
  }

  async function saveRow(row) {
    const num = parseFloat(row.val)
    if (!Number.isFinite(num) || num < 0) {
      alert('Enter a positive number, or click Clear to revert to the default.')
      return
    }
    setSavingKey(row.siteName)
    try {
      await facilityAPI.setSiteRate(row.siteName, num)
      setRows((rs) => rs.map((r) => (r.siteName === row.siteName ? { ...r, hasOverride: true } : r)))
      onDirty && onDirty()
    } catch (e) {
      alert('Save failed: ' + (e.message || 'Unknown'))
    } finally {
      setSavingKey(null)
    }
  }

  async function clearRow(row) {
    setSavingKey(row.siteName)
    try {
      await facilityAPI.deleteSiteRate(row.siteName)
      setRows((rs) => rs.map((r) => (r.siteName === row.siteName ? { ...r, val: '', hasOverride: false } : r)))
      onDirty && onDirty()
    } catch (e) {
      alert('Clear failed: ' + (e.message || 'Unknown'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Modal title="Per-site baseline rates" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#64748B', marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
        Override the default ${defaultRate || 0}/room/day for individual sites. The "manual process" baseline in the cost
        panel sums each site's room-days × its rate. Leave blank or click <strong>Clear</strong> to fall back to the default.
      </p>
      {loading ? (
        <div style={{ fontSize: 13, color: '#94A3B8' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748B' }}>No sites yet. Generate a schedule or add rooms to populate this list.</div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((row) => (
            <div key={row.siteName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{row.siteName}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>
                  {row.roomDays > 0 ? `${row.roomDays} room-days this month` : 'not on current schedule'}
                  {row.hasOverride ? ' · override active' : ' · using default'}
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: 8, color: '#94A3B8' }}>$</span>
                <input
                  type="number"
                  value={row.val}
                  onChange={(e) => updateVal(row.siteName, e.target.value)}
                  placeholder={String(defaultRate || '1500')}
                  style={{ ...inputStyle, width: 110, paddingLeft: 20 }}
                />
              </div>
              <button onClick={() => saveRow(row)} disabled={savingKey === row.siteName} style={{ padding: '8px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: savingKey === row.siteName ? 'default' : 'pointer', opacity: savingKey === row.siteName ? 0.6 : 1 }}>
                {savingKey === row.siteName ? '…' : 'Save'}
              </button>
              <button onClick={() => clearRow(row)} disabled={!row.hasOverride || savingKey === row.siteName} style={{ padding: '8px 12px', background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: (!row.hasOverride || savingKey === row.siteName) ? 'not-allowed' : 'pointer', opacity: !row.hasOverride ? 0.4 : 1 }}>
                Clear
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={{ padding: '9px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Done
        </button>
      </div>
    </Modal>
  )
}

export default function ScheduleBuilderPage({ onNavigate }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [scheduleData, setScheduleData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [addLocModal, setAddLocModal] = useState(null)
  const [locForm, setLocForm] = useState({ location: '', roomsRequired: 1 })
  const [savingLoc, setSavingLoc] = useState(false)

  const [dayDetailModal, setDayDetailModal] = useState(null) // dateStr
  const [assignLoading, setAssignLoading] = useState({})
  const [editingLocation, setEditingLocation] = useState(null)
  const [deletingLocation, setDeletingLocation] = useState(null)
  const [publishing, setPublishing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [intelligence, setIntelligence] = useState(null)
  const [availabilities, setAvailabilities] = useState([]) // from schedule month response
  const [timeOff, setTimeOff] = useState([]) // PTO ranges from schedule month response

  // Coverage Templates for the "Generate from template" banner shown when
  // the current month is empty. Loaded once on mount; generation pulls the
  // selected template + month and bulk-creates ScheduleDay rows server-side.
  const [coverageTemplates, setCoverageTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [generateMessage, setGenerateMessage] = useState(null) // success or error

  // Schedule Builder v2 — the build flow modal. selectedRunId persists
  // across navigations so we can offer the "Re-score after edits" button.
  const [showBuildFlow, setShowBuildFlow] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRunScore, setSelectedRunScore] = useState(null)
  const [selectedRunRecs, setSelectedRunRecs] = useState(null)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreMessage, setRescoreMessage] = useState(null)
  // Facility (for the industry-baseline rate) + the selected build's insights
  // (roomDays + totalCost) that drive the cost-comparison panel.
  const [facility, setFacility] = useState(null)
  const [selectedRunInsights, setSelectedRunInsights] = useState(null)
  const [savingRate, setSavingRate] = useState(false)
  const [showSiteRates, setShowSiteRates] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sched, summ, rosterData, intel, tmplRes, me] = await Promise.all([
        facilityAPI.getScheduleMonth(year, month),
        facilityAPI.getScheduleSummary(year, month).catch(() => null),
        facilityAPI.getRoster().catch(() => []),
        facilityAPI.getScheduleIntelligence().catch(() => null),
        facilityAPI.getCoverageTemplates().catch(() => ({ templates: [] })),
        facilityAPI.getMe().catch(() => null),
      ])
      setScheduleData(sched)
      setSummary(summ)
      if (me) setFacility(me)
      const r = Array.isArray(rosterData) ? rosterData : rosterData.roster || []
      setRoster(r)
      setIntelligence(intel)
      // Extract availabilities from schedule month response
      const av = sched?.availabilities || []
      setAvailabilities(av)
      setTimeOff(sched?.timeOff || [])
      const templates = tmplRes?.templates || []
      setCoverageTemplates(templates)
      // Default the dropdown selection to the practice's default template, or
      // the first one in the list. Coordinator can always pick a different one.
      if (!selectedTemplateId && templates.length > 0) {
        const def = templates.find((t) => t.isDefault) || templates[0]
        setSelectedTemplateId(def.id)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  async function handleRescore() {
    if (!selectedRunId) return
    setRescoring(true)
    setRescoreMessage(null)
    try {
      const res = await facilityAPI.rescoreBuildRun(selectedRunId)
      setSelectedRunScore(res.score)
      if (res.staffiqRecommendations !== undefined) setSelectedRunRecs(res.staffiqRecommendations)
      if (res.insights) setSelectedRunInsights(res.insights)
      const delta = res.delta || 0
      const sign = delta > 0 ? '+' : ''

      // Lead with cost — it means more to coordinators than the StaffIQ score.
      let costText = ''
      if (res.newCost != null) {
        const fmt = (n) => `$${Math.round(n).toLocaleString()}`
        if (res.costDelta != null && res.costDelta !== 0) {
          const up = res.costDelta > 0
          // A cost increase is bad (red-ish phrasing), a decrease is a saving.
          costText = `Estimated cost: ${fmt(res.newCost)} (${up ? '+' : '−'}${fmt(Math.abs(res.costDelta))} ${up ? 'more' : 'saved'} vs last build). `
        } else {
          costText = `Estimated cost: ${fmt(res.newCost)}. `
        }
      }

      setRescoreMessage({
        kind: 'success',
        text: `${costText}StaffIQ score: ${res.score} (${sign}${delta}).`,
      })
    } catch (err) {
      setRescoreMessage({ kind: 'error', text: err.message || 'Re-score failed.' })
    } finally {
      setRescoring(false)
    }
  }

  async function handleSaveRate(num) {
    setSavingRate(true)
    try {
      const updated = await facilityAPI.updateMe({ industryRoomRatePerDay: num })
      setFacility(updated)
    } catch (e) {
      alert('Could not save the industry rate: ' + (e.message || 'Unknown error'))
    } finally {
      setSavingRate(false)
    }
  }

  // Clear any build the coordinator had selected — it no longer matches the
  // schedule once the month is wiped or regenerated from a different template.
  function resetSelectedRun() {
    setSelectedRunId(null)
    setSelectedRunScore(null)
    setSelectedRunRecs(null)
    setSelectedRunInsights(null)
  }

  function monthDays() {
    return scheduleData ? (Array.isArray(scheduleData) ? scheduleData : scheduleData.days || []) : []
  }

  async function handleGenerateFromTemplate() {
    if (!selectedTemplateId) return
    const hasDays = monthDays().length > 0
    // Generating onto an existing month is a full replace (the month is cleared
    // first so a different template doesn't leave stale locations behind).
    if (hasDays && !window.confirm(`This will replace the current ${monthName} ${year} schedule with the selected template. Continue?`)) return
    setGenerating(true)
    setGenerateMessage(null)
    try {
      if (hasDays) {
        await facilityAPI.clearScheduleMonth(year, month)
        resetSelectedRun()
      }
      const res = await facilityAPI.generateScheduleFromTemplate(year, month, selectedTemplateId)
      const s = res.summary || {}
      setGenerateMessage({
        kind: 'success',
        text: `Generated ${s.rowsCreated || 0} new schedule rows across ${s.locations?.length || 0} locations${
          s.rowsUpdated ? `, updated ${s.rowsUpdated} existing` : ''
        }${s.holidaysSkipped ? `. Skipped ${s.holidaysSkipped} holiday day(s).` : '.'}`,
      })
      // Reload to pull the freshly-materialized days into the calendar view.
      await load()
    } catch (e) {
      setGenerateMessage({ kind: 'error', text: e.message || 'Generate failed.' })
    } finally {
      setGenerating(false)
    }
  }

  async function handleClearMonth() {
    if (!window.confirm(`Clear the entire ${monthName} ${year} schedule? This removes all days and assignments for the month.`)) return
    setClearing(true)
    setGenerateMessage(null)
    try {
      const res = await facilityAPI.clearScheduleMonth(year, month)
      resetSelectedRun()
      setGenerateMessage({
        kind: 'success',
        text: `Cleared ${res.daysDeleted || 0} day(s) and ${res.assignmentsDeleted || 0} assignment(s). ${monthName} is now empty.`,
      })
      await load()
    } catch (e) {
      setGenerateMessage({ kind: 'error', text: e.message || 'Clear failed.' })
    } finally {
      setClearing(false)
    }
  }

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  async function handleAddLocation() {
    if (!locForm.location.trim()) return alert('Location name is required.')
    setSavingLoc(true)
    try {
      await facilityAPI.upsertScheduleDay({ date: addLocModal.dateStr, location: locForm.location, roomsRequired: Number(locForm.roomsRequired) })
      setAddLocModal(null)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSavingLoc(false)
    }
  }

  async function handleEditRooms(row, delta) {
    const next = (row.roomsRequired || 1) + delta
    if (next < 1) return
    setEditingLocation(row.id)
    try {
      const dateStr = row.date?.slice(0, 10)
      await facilityAPI.upsertScheduleDay({ date: dateStr, location: row.location, roomsRequired: next })
      await load()
    } catch (e) {
      alert('Update failed: ' + e.message)
    } finally {
      setEditingLocation(null)
    }
  }

  async function handleDeleteLocation(row) {
    if (!window.confirm(`Remove "${row.location}" from this day? All room assignments will be cleared.`)) return
    setDeletingLocation(row.id)
    try {
      await facilityAPI.deleteScheduleDay(row.id)
      await load()
      // If this was the last location, close the modal
      const remaining = detailDayRows.filter(r => r.id !== row.id)
      if (remaining.length === 0) setDayDetailModal(null)
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeletingLocation(null)
    }
  }

  async function handleAssign(dayId, roomNumber, rosterId, role) {
    const key = `${dayId}-${roomNumber}`
    setAssignLoading(p => ({ ...p, [key]: true }))
    try {
      await facilityAPI.assignProvider(dayId, roomNumber, rosterId === '' ? null : rosterId, role)
      await load()
    } catch (e) {
      alert('Assignment failed: ' + e.message)
    } finally {
      setAssignLoading(p => ({ ...p, [key]: false }))
    }
  }

  async function handlePublish() {
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })
    if (!window.confirm(`Publish the ${monthName} ${year} schedule? Providers will be notified.`)) return
    setPublishing(true)
    try {
      await facilityAPI.publishSchedule(year, month)
      alert('Schedule published successfully!')
    } catch (e) {
      alert('Publish failed: ' + e.message)
    } finally {
      setPublishing(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await facilityAPI.exportSchedule(year, month)
      const rows = [['Date', 'Location', 'Room', 'Role', 'Provider', 'Type', 'Category']]
      const exportRows = Array.isArray(data) ? data : data.rows || []
      exportRows.forEach(r => rows.push([r.date, r.location, r.room, r.role || '', r.providerName || '', r.providerType || '', r.employmentCategory || '']))
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `schedule-${year}-${String(month).padStart(2, '0')}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  // Score a roster provider for a given date/location using preference data
  function scoreProvider(provider, dateStr, locationName) {
    const date = new Date(dateStr + 'T12:00:00')
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
    let score = 0
    const tags = []

    // 1. Availability on this date (only rows explicitly marked available)
    const isAvailable = availabilities.some(a => {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      return a.rosterId === provider.id && avDate === dateStr && a.available
    })
    if (isAvailable) { score += 40; tags.push('Available') }

    // 2. Preferred day
    const prefDays = Array.isArray(provider.preferredDays) ? provider.preferredDays : []
    if (prefDays.includes(dayName)) { score += 20; tags.push('Preferred Day') }

    // 3. Location ranking
    const rankings = Array.isArray(provider.locationRankings) ? provider.locationRankings : []
    const locIdx = rankings.findIndex(l => l.toLowerCase() === locationName.toLowerCase())
    if (locIdx === 0) { score += 15; tags.push('Top Location') }
    else if (locIdx === 1) { score += 10; tags.push('Preferred Location') }
    else if (locIdx > 1) { score += 5 }

    // 4. Employment category (FT > PD > Locums)
    const catScore = { FULL_TIME: 10, PER_DIEM: 6, LOCUMS: 3 }
    score += catScore[provider.employmentCategory] || 0

    // 5. Lower cost (invert: lower hourly = higher score)
    const rate = provider.hourlyRate || (provider.annualRate ? provider.annualRate / 2080 : 999)
    score += Math.max(0, 10 - Math.floor(rate / 20))

    return { score, tags }
  }

  function rankedRoster(dateStr, locationName) {
    return [...roster]
      .map(p => ({ ...p, _rank: scoreProvider(p, dateStr, locationName) }))
      .sort((a, b) => b._rank.score - a._rank.score)
  }

  // Editing guardrail: who's already working somewhere that day (rosterId →
  // location label), so the coordinator can't accidentally double-book across
  // locations. Supervising MDs count too (they're working). Built from every
  // location's assignments for the open day.
  function assignedThatDay(dateStr) {
    const map = {}
    for (const row of (daysByDate[dateStr] || [])) {
      for (const a of (row.assignments || [])) {
        if (a.rosterId) map[a.rosterId] = row.location
      }
    }
    return map
  }

  // Who can't work that day → rosterId → reason label. Covers explicit
  // unavailability (ProviderAvailability.available === false) and PTO /
  // time-off ranges covering the date. Providers with no signal are
  // "unknown" and stay selectable (no false positives).
  function unavailableThatDay(dateStr) {
    const map = new Map()
    for (const a of availabilities) {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      if (avDate === dateStr && a.available === false && a.rosterId) map.set(a.rosterId, 'unavailable')
    }
    for (const t of timeOff) {
      const s = (typeof t.startDate === 'string' ? t.startDate : new Date(t.startDate).toISOString()).substring(0, 10)
      const e = (typeof t.endDate === 'string' ? t.endDate : new Date(t.endDate).toISOString()).substring(0, 10)
      if (dateStr >= s && dateStr <= e && t.rosterEntryId) map.set(t.rosterEntryId, 'time off')
    }
    return map
  }

  // Task #20: provider availability notes for a date → [{ name, note }].
  // Surfaced at the top of the day editor so the coordinator sees context
  // like "can work after 10am" or "Natick only" before assigning.
  function notesThatDay(dateStr) {
    const out = []
    for (const a of availabilities) {
      if (!a.note) continue
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      if (avDate === dateStr) {
        out.push({ name: a.rosterEntry?.providerName || 'A provider', note: a.note })
      }
    }
    return out
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })

  // Group schedule days by date — a date can have multiple location rows
  const daysByDate = {}
  if (scheduleData) {
    const days = Array.isArray(scheduleData) ? scheduleData : scheduleData.days || []
    days.forEach(d => {
      const key = d.date?.slice(0, 10)
      if (!daysByDate[key]) daysByDate[key] = []
      daysByDate[key].push(d)
    })
  }

  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function padDate(d) { return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` }

  const detailDayRows = dayDetailModal ? (daysByDate[dayDetailModal] || []) : []

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={prevMonth} style={{ padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }}>‹</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', minWidth: 160, textAlign: 'center' }}>{monthName} {year}</div>
          <button onClick={nextMonth} style={{ padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#374151' }}>›</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <StatBox label="Total Shifts" value={summary?.totalShifts ?? '—'} />
          <StatBox label="Filled" value={summary?.filled ?? '—'} color="#10B981" />
          <StatBox label="Remaining" value={summary?.remaining ?? '—'} color="#EF4444" />
          {/* "Est. Cost" = your industry baseline (rate × room-days). Lights
              up as soon as rooms exist on the calendar, regardless of whether
              a build has been run. The post-build SNAP labor cost lives in
              the Cost-vs-manual-process panel below. */}
          <StatBox
            label="Est. Cost"
            value={
              facility?.industryRoomRatePerDay > 0 && summary?.totalShifts > 0
                ? fmt(facility.industryRoomRatePerDay * summary.totalShifts)
                : '—'
            }
            color="#2563EB"
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowBuildFlow(true)}
            style={{
              padding: '10px 20px',
              background: '#10B981',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🚀 Build the Schedule
          </button>
          <button onClick={handlePublish} disabled={publishing} style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.7 : 1 }}>
            {publishing ? 'Publishing...' : '📢 Publish Schedule'}
          </button>
          <button onClick={handleExport} disabled={exporting} style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer', color: '#374151' }}>
            {exporting ? 'Exporting...' : '⬇️ Export CSV'}
          </button>
        </div>
      </div>

      {facility && (
        <CostComparisonPanel
          rate={facility.industryRoomRatePerDay}
          summary={summary}
          onSaveRate={handleSaveRate}
          saving={savingRate}
          onEditSiteRates={() => setShowSiteRates(true)}
        />
      )}
      {showSiteRates && (
        <SiteRatesModal
          siteBreakdown={summary?.siteBreakdown || []}
          defaultRate={facility?.industryRoomRatePerDay}
          onClose={() => setShowSiteRates(false)}
          onDirty={() => load()}
        />
      )}

      {/* Generate-from-template banner — shown only when this month has no
          schedule rows yet AND the practice has at least one Coverage
          Template configured. After generation, the existing click-a-day
          editor takes over. */}
      {(() => {
        if (loading || coverageTemplates.length === 0) return null
        const hasDays = monthDays().length > 0
        const busy = generating || clearing
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 18px', marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🧩</span>
            <div style={{ flex: 1, fontSize: 13, color: '#064E3B', minWidth: 240 }}>
              {hasDays ? (
                <>
                  <strong>Switch templates or rebuild {monthName} {year}.</strong>
                  <span style={{ color: '#047857' }}> Generating replaces this month with the selected template — you can edit any day afterward.</span>
                </>
              ) : (
                <>
                  <strong>{monthName} {year} is empty.</strong>
                  <span style={{ color: '#047857' }}> Pre-fill it from one of your Coverage Templates — you can edit any day afterward.</span>
                </>
              )}
            </div>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ padding: '8px 12px', border: '1.5px solid #A7F3D0', borderRadius: 8, fontSize: 13, background: '#fff', color: '#064E3B', minWidth: 200 }}
              disabled={busy}
            >
              {coverageTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerateFromTemplate}
              disabled={busy || !selectedTemplateId}
              style={{ padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
            >
              {generating ? 'Generating…' : hasDays ? `Replace ${monthName}` : `Generate ${monthName}`}
            </button>
            {hasDays && (
              <button
                onClick={handleClearMonth}
                disabled={busy}
                style={{ padding: '10px 16px', background: '#fff', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
              >
                {clearing ? 'Clearing…' : '🗑️ Clear month'}
              </button>
            )}
          </div>
        )
      })()}
      {generateMessage && (
        <div
          style={{
            background: generateMessage.kind === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${generateMessage.kind === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: generateMessage.kind === 'success' ? '#065F46' : '#991B1B',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>{generateMessage.text}</span>
          <button
            onClick={() => setGenerateMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Schedule Intelligence banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
        <span style={{ fontSize: 16 }}>🧠</span>
        <div style={{ flex: 1, fontSize: 13, color: '#172554' }}>
          <strong>StaffIQ Schedule Intelligence</strong> — Suggestions are ranked by provider availability, preferences, and cost optimization.
        </div>
        {intelligence && (
          <div style={{ display: 'flex', align: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2563EB' }}>{intelligence.score}%</div>
              <div style={{ fontSize: 10, color: '#1E3A8A', fontWeight: 600, textTransform: 'uppercase' }}>Intelligence</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2563EB' }}>{intelligence.dataPoints}</div>
              <div style={{ fontSize: 10, color: '#1E3A8A', fontWeight: 600, textTransform: 'uppercase' }}>Data Points</div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([key, c]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: c.bg, border: `2px solid ${c.border}` }} />
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>{c.label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#fff', border: '2px solid #E2E8F0' }} />
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>No schedule</span>
        </div>
      </div>

      {/* Build-run banner — shown after coordinator selects a build, lets
          them re-score after edits */}
      {selectedRunId && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#F0F9FF',
            border: '1px solid #BAE6FD',
            borderRadius: 10,
            padding: '12px 18px',
            marginBottom: 16,
            color: '#075985',
          }}
        >
          <span style={{ fontSize: 18 }}>🚀</span>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong>StaffIQ score: {selectedRunScore ?? '—'}</strong>
            <span style={{ marginLeft: 8, color: '#0369A1' }}>
              Edit any cell, then re-score to see how your changes moved the needle.
            </span>
          </div>
          <button
            onClick={handleRescore}
            disabled={rescoring}
            style={{
              padding: '8px 16px',
              background: '#0EA5E9',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: rescoring ? 'not-allowed' : 'pointer',
            }}
          >
            {rescoring ? 'Re-scoring…' : 'Re-score'}
          </button>
        </div>
      )}
      {selectedRunId && selectedRunRecs?.totalProjectedSavings > 0 && (
        <div style={{ marginBottom: 16 }}>
          <StaffIQRecommendations recommendations={selectedRunRecs} />
        </div>
      )}
      {rescoreMessage && (
        <div
          style={{
            background: rescoreMessage.kind === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${rescoreMessage.kind === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: rescoreMessage.kind === 'success' ? '#065F46' : '#991B1B',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{rescoreMessage.text}</span>
          <button
            onClick={() => setRescoreMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px', color: '#DC2626', marginBottom: 16 }}>
          Error loading schedule: {error}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading schedule...</div>}

      {!loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '6px 0' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} style={{ minHeight: 100, background: 'transparent' }} />

              const dateStr = padDate(day)
              const dayRows = daysByDate[dateStr] || []
              const hasSchedule = dayRows.length > 0
              const colorKey = getDayColor(dayRows)
              const sc = colorKey ? STATUS_COLORS[colorKey] : null
              const { totalRooms, filledRooms } = hasSchedule ? getDayStats(dayRows) : { totalRooms: 0, filledRooms: 0 }
              const isToday = day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()

              const borderColor = isToday ? '#2563EB' : (sc ? sc.border : '#E2E8F0')
              const bgColor = isToday ? '#F5F3FF' : (sc ? sc.bg : '#fff')

              return (
                <div
                  key={dateStr}
                  onClick={() => hasSchedule && setDayDetailModal(dateStr)}
                  style={{
                    background: bgColor,
                    border: `2px solid ${borderColor}`,
                    borderRadius: 10,
                    minHeight: 100,
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: hasSchedule ? 'pointer' : 'default',
                    transition: 'box-shadow 0.12s ease',
                  }}
                  onMouseEnter={e => { if (hasSchedule) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
                >
                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? '#2563EB' : '#0F172A' }}>{day}</span>
                    <button
                      onClick={e => { e.stopPropagation(); setAddLocModal({ dateStr }); setLocForm({ location: '', roomsRequired: 1 }) }}
                      title="Add location"
                      style={{ fontSize: 10, padding: '2px 6px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 4, cursor: 'pointer', color: '#1D4ED8', fontWeight: 700 }}
                    >+</button>
                  </div>

                  {/* Shift summary */}
                  {hasSchedule ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: sc ? sc.text : '#0F172A', marginBottom: 4 }}>
                        {filledRooms}/{totalRooms} rooms filled
                      </div>
                      {dayRows.map((row, ri) => {
                        const filled = (row.assignments || []).filter(a => a.rosterId).length
                        const required = row.roomsRequired || 1
                        return (
                          <div key={ri} style={{ fontSize: 9, color: '#475569', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.location}: {filled}/{required}
                          </div>
                        )
                      })}
                      <div style={{ marginTop: 'auto', paddingTop: 4, fontSize: 9, color: '#94A3B8', fontStyle: 'italic' }}>
                        Tap to edit
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 9, color: '#CBD5E1', textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
                      No schedule
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Day Detail Modal */}
      {dayDetailModal && (
        <Modal title={(() => {
          const curDay = parseInt(dayDetailModal.slice(8, 10), 10)
          const prev = curDay > 1 ? padDate(curDay - 1) : null
          const next = curDay < daysInMonth ? padDate(curDay + 1) : null
          const label = new Date(dayDetailModal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          const arrow = (on) => ({ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: on ? '#F8FAFC' : '#F1F5F9', color: on ? '#374151' : '#CBD5E1', fontSize: 18, lineHeight: 1, cursor: on ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => prev && setDayDetailModal(prev)} disabled={!prev} title="Previous day" style={arrow(!!prev)}>‹</button>
              <span>{label}</span>
              <button onClick={() => next && setDayDetailModal(next)} disabled={!next} title="Next day" style={arrow(!!next)}>›</button>
            </span>
          )
        })()} onClose={() => setDayDetailModal(null)} wide>
          {/* Task #20: provider availability notes for this date */}
          {(() => {
            const notes = notesThatDay(dayDetailModal)
            if (notes.length === 0) return null
            return (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  📝 Provider notes for this day
                </div>
                {notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#78350F', marginTop: i === 0 ? 0 : 4 }}>
                    <strong>{n.name}:</strong> {n.note}
                  </div>
                ))}
              </div>
            )
          })()}
          {detailDayRows.length === 0 ? (
            <p style={{ color: '#94A3B8' }}>No locations scheduled for this day.</p>
          ) : (
            (() => { const _assignedToday = assignedThatDay(dayDetailModal); const _unavailToday = unavailableThatDay(dayDetailModal); return detailDayRows.map((row) => {
              const required = row.roomsRequired || 1
              const assignments = row.assignments || []
              const assignedByRoom = Object.fromEntries(assignments.map(a => [a.roomNumber, a]))
              // Supervising MDs are stored at roomNumber >= 900 (role
              // SUPERVISING_MD); they're not OR rooms, so exclude them from
              // the fill count and surface them in their own section.
              const supervisors = assignments.filter(a => a.role === 'SUPERVISING_MD' && a.rosterId)
              const filled = assignments.filter(a => a.rosterId && a.role !== 'SUPERVISING_MD').length
              const gap = required - filled
              const colorKey = gap === 0 ? 'green' : gap === 1 ? 'yellow' : 'red'
              const sc = STATUS_COLORS[colorKey]
              const cov = coverageLabel(row.supervisionRatio)

              return (
                <div key={row.id} style={{ marginBottom: 20, border: `1px solid ${sc.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  {/* Location header */}
                  <div style={{ background: sc.bg, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.location}
                      {cov && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: cov.bg, color: cov.color }}>
                          {cov.text}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {/* Room count adjuster */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={() => handleEditRooms(row, -1)}
                          disabled={required <= 1 || editingLocation === row.id}
                          title="Remove a room"
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: required <= 1 ? 'not-allowed' : 'pointer', fontSize: 16, lineHeight: 1, color: '#374151', opacity: required <= 1 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >−</button>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', minWidth: 22, textAlign: 'center' }}>{required}</span>
                        <button
                          onClick={() => handleEditRooms(row, +1)}
                          disabled={editingLocation === row.id}
                          title="Add a room"
                          style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >+</button>
                        <span style={{ fontSize: 11, color: '#64748B', marginLeft: 2 }}>rooms</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: sc.text }}>{filled}/{required} filled</div>
                      {/* Delete location */}
                      <button
                        onClick={() => handleDeleteLocation(row)}
                        disabled={deletingLocation === row.id}
                        title="Remove this location"
                        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', cursor: 'pointer', color: '#EF4444', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: deletingLocation === row.id ? 0.5 : 1 }}
                      >🗑</button>
                    </div>
                  </div>

                  {/* Room rows */}
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Array.from({ length: required }, (_, ri) => {
                      const roomNum = ri + 1
                      const assignment = assignedByRoom[roomNum]
                      const assignedRosterId = assignment?.rosterId || ''
                      const aKey = `${row.id}-${roomNum}`
                      const isLoading = assignLoading[aKey]

                      return (
                        <div key={roomNum} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, fontSize: 12, fontWeight: 600, color: '#475569', flexShrink: 0 }}>Room {roomNum}</div>
                          {!assignedRosterId && (
                            <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700, flexShrink: 0 }}>⬜ Unfilled</div>
                          )}
                          {assignment?.role && ROLE_TAG[assignment.role] && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: ROLE_TAG[assignment.role].bg, color: ROLE_TAG[assignment.role].color, flexShrink: 0 }}>
                              {ROLE_TAG[assignment.role].text}
                            </span>
                          )}
                          {assignedRosterId && assignment?.rosterEntry && (
                            <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700, flexShrink: 0 }}>
                              {EMP_PREFIX[assignment.rosterEntry.employmentCategory]} {assignment.rosterEntry.providerName}
                            </div>
                          )}
                          <select
                            value={assignedRosterId}
                            disabled={isLoading}
                            onChange={e => {
                              const newId = e.target.value
                              // Record feedback: what rank was selected
                              if (newId) {
                                const ranked = rankedRoster(dayDetailModal, row.location)
                                const selectedIdx = ranked.findIndex(p => p.id === newId)
                                facilityAPI.recordScheduleFeedback({
                                  rosterId: newId,
                                  shiftDate: dayDetailModal,
                                  facilityLocation: row.location,
                                  wasSuggested: selectedIdx >= 0,
                                  suggestionRank: selectedIdx >= 0 ? selectedIdx + 1 : null,
                                  wasSelected: true,
                                }).catch(() => {})
                              }
                              handleAssign(row.id, roomNum, newId)
                            }}
                            style={{ ...inputStyle, fontSize: 13, padding: '7px 10px', flex: 1 }}
                          >
                            <option value="">— Unassigned —</option>
                            {rankedRoster(dayDetailModal, row.location).map((p, pi) => {
                              const tags = p._rank.tags
                              // Disable anyone who can't actually be put here:
                              // already working elsewhere that day, or marked
                              // unavailable. The person currently in THIS room
                              // stays selectable (it's their own slot).
                              const elsewhere = _assignedToday[p.id] && p.id !== assignedRosterId
                              const offReason = _unavailToday.get(p.id)
                              const blocked = elsewhere || !!offReason
                              const reason = elsewhere
                                ? ` — at ${_assignedToday[p.id]}`
                                : offReason
                                  ? ` — ${offReason}`
                                  : ''
                              const tagStr = !blocked && tags.length > 0 ? ` · ${tags.join(', ')}` : ''
                              return (
                                <option key={p.id} value={p.id} disabled={blocked}>
                                  {blocked ? '🚫 ' : pi === 0 ? '⭐ ' : ''}{EMP_PREFIX[p.employmentCategory] || ''} {p.providerName}{reason}{tagStr}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      )
                    })}

                    {/* Supervising anesthesiologists (team model). Auto-computed
                        from the care-team build — 1 MD per supervisionRatio CRNAs. */}
                    {(supervisors.length > 0 || (row.supervisionRatio === 3 || row.supervisionRatio === 4)) && (
                      <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #CBD5E1' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Supervising anesthesiologists ({supervisors.length})
                          {row.supervisionRatio ? ` · 1:${row.supervisionRatio}` : ''}
                        </div>
                        {(() => {
                          // Editable supervisor slots: one selector per assigned
                          // supervising MD (change/remove), plus one empty slot to
                          // add another. Supervisors live at roomNumber >= 900 and
                          // carry role SUPERVISING_MD. Only anesthesiologists can
                          // supervise. Reuse an emptied slot's room before minting a
                          // new one so rooms don't accumulate.
                          const filledSups = assignments.filter(a => a.role === 'SUPERVISING_MD' && a.rosterId)
                          const allSupRooms = assignments.filter(a => a.role === 'SUPERVISING_MD').map(a => a.roomNumber)
                          const emptySup = assignments.find(a => a.role === 'SUPERVISING_MD' && !a.rosterId)
                          const addRoom = emptySup
                            ? emptySup.roomNumber
                            : (allSupRooms.length ? Math.max(...allSupRooms) + 1 : SUPERVISOR_ROOM_BASE)
                          const mds = rankedRoster(dayDetailModal, row.location).filter(p => p.providerType === 'ANESTHESIOLOGIST')
                          const slots = [
                            ...filledSups.map(s => ({ roomNumber: s.roomNumber, currentId: s.rosterId, existing: true })),
                            { roomNumber: addRoom, currentId: '', existing: false },
                          ]
                          if (mds.length === 0) {
                            return <div style={{ fontSize: 11, color: '#94A3B8' }}>No anesthesiologists on your roster to assign as supervisors.</div>
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {slots.map((slot) => {
                                const key = `${row.id}-${slot.roomNumber}`
                                const isLoading = assignLoading[key]
                                return (
                                  <select
                                    key={slot.roomNumber}
                                    value={slot.currentId}
                                    disabled={isLoading}
                                    onChange={(e) => handleAssign(row.id, slot.roomNumber, e.target.value, 'SUPERVISING_MD')}
                                    style={{ ...inputStyle, fontSize: 13, padding: '7px 10px', borderColor: slot.currentId ? '#DDD6FE' : '#FCA5A5' }}
                                  >
                                    <option value="">{slot.existing ? '— Remove supervisor —' : '+ Add supervising anesthesiologist'}</option>
                                    {mds.map((p) => {
                                      const elsewhere = _assignedToday[p.id] && p.id !== slot.currentId
                                      const offReason = _unavailToday.get(p.id)
                                      const blocked = elsewhere || !!offReason
                                      const reason = elsewhere ? ` — at ${_assignedToday[p.id]}` : offReason ? ` — ${offReason}` : ''
                                      return (
                                        <option key={p.id} value={p.id} disabled={blocked}>
                                          {blocked ? '🚫 ' : ''}{EMP_PREFIX[p.employmentCategory] || ''} {p.providerName}{reason}
                                        </option>
                                      )
                                    })}
                                  </select>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )
            }) })()
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={() => { setDayDetailModal(null); setAddLocModal({ dateStr: dayDetailModal }); setLocForm({ location: '', roomsRequired: 1 }) }}
              style={{ padding: '9px 18px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1D4ED8' }}
            >
              + Add Another Location
            </button>
          </div>
        </Modal>
      )}

      {/* Add Location Modal */}
      {addLocModal && (
        <Modal title={`Add Location — ${addLocModal.dateStr}`} onClose={() => setAddLocModal(null)}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Location Name</label>
            <input style={inputStyle} value={locForm.location} onChange={e => setLocForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. OR Suite 1, Cardiac OR" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rooms Required</label>
            <input style={inputStyle} type="number" min="1" max="20" value={locForm.roomsRequired} onChange={e => setLocForm(p => ({ ...p, roomsRequired: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setAddLocModal(null)} style={{ padding: '9px 18px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
            <button onClick={handleAddLocation} disabled={savingLoc} style={{ padding: '9px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: savingLoc ? 'not-allowed' : 'pointer', opacity: savingLoc ? 0.7 : 1 }}>
              {savingLoc ? 'Saving...' : 'Save Location'}
            </button>
          </div>
        </Modal>
      )}

      {/* Schedule Builder v2 — Build the Schedule flow */}
      {showBuildFlow && (
        <ScheduleBuildFlow
          year={year}
          month={month}
          industryRoomRate={facility?.industryRoomRatePerDay}
          onClose={() => setShowBuildFlow(false)}
          onSelected={({ run, message }) => {
            setShowBuildFlow(false)
            setSelectedRunId(run.id)
            setSelectedRunScore(run.staffiqScore)
            setSelectedRunRecs(run.staffiqRecommendations || null)
            setSelectedRunInsights(run.insights || null)
            setRescoreMessage({ kind: 'success', text: message || 'Schedule applied.' })
            // Reload the calendar to show the new assignments
            load()
          }}
        />
      )}
    </div>
  )
}
