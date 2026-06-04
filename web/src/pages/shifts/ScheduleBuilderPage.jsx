import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'
import ScheduleBuildFlow from './ScheduleBuildFlow.jsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const EMP_PREFIX = { FULL_TIME: '🔵', PER_DIEM: '🟢', LOCUMS: '🟠' }

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

  // Coverage Templates for the "Generate from template" banner shown when
  // the current month is empty. Loaded once on mount; generation pulls the
  // selected template + month and bulk-creates ScheduleDay rows server-side.
  const [coverageTemplates, setCoverageTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState(null) // success or error

  // Schedule Builder v2 — the build flow modal. selectedRunId persists
  // across navigations so we can offer the "Re-score after edits" button.
  const [showBuildFlow, setShowBuildFlow] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRunScore, setSelectedRunScore] = useState(null)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreMessage, setRescoreMessage] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sched, summ, rosterData, intel, tmplRes] = await Promise.all([
        facilityAPI.getScheduleMonth(year, month),
        facilityAPI.getScheduleSummary(year, month).catch(() => null),
        facilityAPI.getRoster().catch(() => []),
        facilityAPI.getScheduleIntelligence().catch(() => null),
        facilityAPI.getCoverageTemplates().catch(() => ({ templates: [] })),
      ])
      setScheduleData(sched)
      setSummary(summ)
      const r = Array.isArray(rosterData) ? rosterData : rosterData.roster || []
      setRoster(r)
      setIntelligence(intel)
      // Extract availabilities from schedule month response
      const av = sched?.availabilities || []
      setAvailabilities(av)
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

  async function handleGenerateFromTemplate() {
    if (!selectedTemplateId) return
    setGenerating(true)
    setGenerateMessage(null)
    try {
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

  async function handleAssign(dayId, roomNumber, rosterId) {
    const key = `${dayId}-${roomNumber}`
    setAssignLoading(p => ({ ...p, [key]: true }))
    try {
      await facilityAPI.assignProvider(dayId, roomNumber, rosterId === '' ? null : rosterId)
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
      const rows = [['Date', 'Location', 'Room', 'Provider', 'Type', 'Category']]
      const exportRows = Array.isArray(data) ? data : data.rows || []
      exportRows.forEach(r => rows.push([r.date, r.location, r.room, r.providerName || '', r.providerType || '', r.employmentCategory || '']))
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

    // 1. Availability on this date
    const isAvailable = availabilities.some(a => {
      const avDate = typeof a.date === 'string' ? a.date.substring(0, 10) : new Date(a.date).toISOString().substring(0, 10)
      return a.rosterId === provider.id && avDate === dateStr
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
          <StatBox label="Est. Cost" value={summary?.estimatedCost != null ? fmt(summary.estimatedCost) : '—'} color="#6366F1" poweredBy />
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
          <button onClick={handlePublish} disabled={publishing} style={{ padding: '10px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.7 : 1 }}>
            {publishing ? 'Publishing...' : '📢 Publish Schedule'}
          </button>
          <button onClick={handleExport} disabled={exporting} style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer', color: '#374151' }}>
            {exporting ? 'Exporting...' : '⬇️ Export CSV'}
          </button>
        </div>
      </div>

      {/* Generate-from-template banner — shown only when this month has no
          schedule rows yet AND the practice has at least one Coverage
          Template configured. After generation, the existing click-a-day
          editor takes over. */}
      {(() => {
        const days = scheduleData ? (Array.isArray(scheduleData) ? scheduleData : scheduleData.days || []) : []
        if (loading || days.length > 0 || coverageTemplates.length === 0) return null
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '14px 18px', marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🧩</span>
            <div style={{ flex: 1, fontSize: 13, color: '#064E3B', minWidth: 240 }}>
              <strong>{monthName} {year} is empty.</strong>
              <span style={{ color: '#047857' }}> Pre-fill it from one of your Coverage Templates — you can edit any day afterward.</span>
            </div>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ padding: '8px 12px', border: '1.5px solid #A7F3D0', borderRadius: 8, fontSize: 13, background: '#fff', color: '#064E3B', minWidth: 200 }}
              disabled={generating}
            >
              {coverageTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerateFromTemplate}
              disabled={generating || !selectedTemplateId}
              style={{ padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}
            >
              {generating ? 'Generating…' : `Generate ${monthName}`}
            </button>
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
        <div style={{ flex: 1, fontSize: 13, color: '#5B21B6' }}>
          <strong>StaffIQ Schedule Intelligence</strong> — Suggestions are ranked by provider availability, preferences, and cost optimization.
        </div>
        {intelligence && (
          <div style={{ display: 'flex', align: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#6366F1' }}>{intelligence.score}%</div>
              <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 600, textTransform: 'uppercase' }}>Intelligence</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#6366F1' }}>{intelligence.dataPoints}</div>
              <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 600, textTransform: 'uppercase' }}>Data Points</div>
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

              const borderColor = isToday ? '#6366F1' : (sc ? sc.border : '#E2E8F0')
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
                    <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? '#6366F1' : '#0F172A' }}>{day}</span>
                    <button
                      onClick={e => { e.stopPropagation(); setAddLocModal({ dateStr }); setLocForm({ location: '', roomsRequired: 1 }) }}
                      title="Add location"
                      style={{ fontSize: 10, padding: '2px 6px', background: '#EEF2FF', border: '1px solid #A5B4FC', borderRadius: 4, cursor: 'pointer', color: '#4F46E5', fontWeight: 700 }}
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
        <Modal title={`Schedule — ${new Date(dayDetailModal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`} onClose={() => setDayDetailModal(null)} wide>
          {detailDayRows.length === 0 ? (
            <p style={{ color: '#94A3B8' }}>No locations scheduled for this day.</p>
          ) : (
            detailDayRows.map((row) => {
              const required = row.roomsRequired || 1
              const assignments = row.assignments || []
              const assignedByRoom = Object.fromEntries(assignments.map(a => [a.roomNumber, a]))
              const filled = assignments.filter(a => a.rosterId).length
              const gap = required - filled
              const colorKey = gap === 0 ? 'green' : gap === 1 ? 'yellow' : 'red'
              const sc = STATUS_COLORS[colorKey]

              return (
                <div key={row.id} style={{ marginBottom: 20, border: `1px solid ${sc.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  {/* Location header */}
                  <div style={{ background: sc.bg, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', flex: 1 }}>{row.location}</div>
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
                              const tagStr = tags.length > 0 ? ` · ${tags.join(', ')}` : ''
                              return (
                                <option key={p.id} value={p.id}>
                                  {pi === 0 ? '⭐ ' : ''}{EMP_PREFIX[p.employmentCategory] || ''} {p.providerName}{tagStr}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={() => { setDayDetailModal(null); setAddLocModal({ dateStr: dayDetailModal }); setLocForm({ location: '', roomsRequired: 1 }) }}
              style={{ padding: '9px 18px', background: '#EEF2FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#4F46E5' }}
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
            <button onClick={handleAddLocation} disabled={savingLoc} style={{ padding: '9px 18px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: savingLoc ? 'not-allowed' : 'pointer', opacity: savingLoc ? 0.7 : 1 }}>
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
          onClose={() => setShowBuildFlow(false)}
          onSelected={({ run, message }) => {
            setShowBuildFlow(false)
            setSelectedRunId(run.id)
            setSelectedRunScore(run.staffiqScore)
            setRescoreMessage({ kind: 'success', text: message || 'Schedule applied.' })
            // Reload the calendar to show the new assignments
            load()
          }}
        />
      )}
    </div>
  )
}
