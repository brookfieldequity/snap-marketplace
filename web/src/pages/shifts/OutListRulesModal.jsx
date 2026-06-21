import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'

// Out-List Rules — admin sets the rule set once, then one-clicks the release
// order for a whole week or month. Rules are bidirectional/cross-site (a late
// site keeps you off the closer slot on adjacent days), so the auto-builder
// solves the full window at once. After running, individual days can still be
// hand-edited via the per-day Out List Builder.
//
// Props: year, month (1-12), monthName, onClose, onDone (reload parent)

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

// Mondays whose week overlaps the given month → [{ value: ISO Monday, label }].
function weeksForMonth(year, month) {
  const first = new Date(year, month - 1, 1)
  // back up to the Monday on/before the 1st (getDay: 0=Sun..6=Sat)
  const offset = (first.getDay() + 6) % 7
  const monday = new Date(year, month - 1, 1 - offset)
  const out = []
  const lastDay = new Date(year, month, 0).getDate()
  while (true) {
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
    out.push({
      value: iso(monday.getFullYear(), monday.getMonth() + 1, monday.getDate()),
      label: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    })
    monday.setDate(monday.getDate() + 7)
    // stop once the new Monday is past the month's last day
    if (monday.getMonth() !== month - 1 && monday.getDate() > 7 && monday > new Date(year, month - 1, lastDay)) break
    if (out.length > 6) break
  }
  return out
}

function Toggle({ on, onClick, label, hint }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0' }}>
      <span style={{ width: 38, height: 22, borderRadius: 12, background: on ? '#2563EB' : '#CBD5E1', position: 'relative', flexShrink: 0, transition: 'background 0.15s', marginTop: 1 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
      </span>
      <span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginTop: 2, lineHeight: 1.4 }}>{hint}</span>}
      </span>
    </button>
  )
}

export default function OutListRulesModal({ year, month, monthName, onClose, onDone }) {
  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState(null)
  const [knownSites, setKnownSites] = useState([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const weeks = weeksForMonth(year, month)
  const [scope, setScope] = useState('month')
  const [weekStart, setWeekStart] = useState(weeks[0]?.value || '')
  const [publish, setPublish] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await facilityAPI.getOutListRules()
      setRules(res.rules)
      setKnownSites(res.knownSites || [])
      setDirty(false)
    } catch (e) {
      setError(e.message || 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function patch(k, v) { setRules((r) => ({ ...r, [k]: v })); setDirty(true) }
  function toggleSite(site) {
    setRules((r) => {
      const has = (r.lateSites || []).includes(site)
      return { ...r, lateSites: has ? r.lateSites.filter((s) => s !== site) : [...(r.lateSites || []), site] }
    })
    setDirty(true)
  }

  async function saveRules() {
    setSaving(true); setError(null)
    try {
      const res = await facilityAPI.saveOutListRules(rules)
      setRules(res.rules)
      setDirty(false)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function run() {
    setRunning(true); setError(null); setResult(null)
    try {
      // Persist any pending rule edits first so the run uses them.
      if (dirty) { await facilityAPI.saveOutListRules(rules); setDirty(false) }
      const body = scope === 'week'
        ? { scope: 'week', weekStart, publish }
        : { scope: 'month', year, month, publish }
      const res = await facilityAPI.autoBuildOutList(body)
      setResult(res)
      if (onDone) onDone()
    } catch (e) {
      setError(e.message || 'Auto-build failed')
    } finally {
      setRunning(false)
    }
  }

  const sectionTitle = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>🚪 Out List Rules</h2>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>Set the rules once, then build every day's release order in one click.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>

        {loading || !rules ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94A3B8' }}>Loading…</div>
        ) : (
          <>
            {/* Late sites */}
            <div style={{ marginTop: 18 }}>
              <div style={sectionTitle}>Late sites</div>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8, lineHeight: 1.45 }}>
                Working one of these is a “late day,” so that provider won’t be the closer on the day before or after, and is nudged toward first-out on those days.
              </div>
              {knownSites.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94A3B8' }}>No sites yet — add locations to the schedule first.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {knownSites.map((site) => {
                    const on = (rules.lateSites || []).includes(site)
                    return (
                      <button key={site} onClick={() => toggleSite(site)} style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${on ? '#F59E0B' : '#CBD5E1'}`, background: on ? '#FFFBEB' : '#fff', color: on ? '#B45309' : '#475569', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                        {on ? '🌙 ' : ''}{site}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Rule toggles */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
              <div style={sectionTitle}>Fairness rules</div>
              <Toggle on={rules.lateSiteNoCloseAdjacent} onClick={() => patch('lateSiteNoCloseAdjacent', !rules.lateSiteNoCloseAdjacent)}
                label="Late site → no closing the adjacent day"
                hint="A late day at one of the sites above blocks the closer slot the day before and after." />
              <Toggle on={rules.closerFirstOutNextDay} onClick={() => patch('closerFirstOutNextDay', !rules.closerFirstOutNextDay)}
                label="Closer → first-out the next day"
                hint="Whoever closes a facility is pushed toward first-out the next day and won’t close again." />
              <Toggle on={rules.noBackToBackClosing} onClick={() => patch('noBackToBackClosing', !rules.noBackToBackClosing)}
                label="No back-to-back closing"
                hint="The same person won’t be the last-out closer two days in a row." />
            </div>

            {/* One-click run */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
              <div style={sectionTitle}>Build the out lists</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button onClick={() => setScope('month')} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${scope === 'month' ? '#2563EB' : '#CBD5E1'}`, background: scope === 'month' ? '#EFF6FF' : '#fff', color: scope === 'month' ? '#1D4ED8' : '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  All of {monthName}
                </button>
                <button onClick={() => setScope('week')} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${scope === 'week' ? '#2563EB' : '#CBD5E1'}`, background: scope === 'week' ? '#EFF6FF' : '#fff', color: scope === 'week' ? '#1D4ED8' : '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  One week
                </button>
                {scope === 'week' && (
                  <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#F8FAFC' }}>
                    {weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                Publish to the floor runner immediately
              </label>

              {result && (
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#047857' }}>
                    ✓ Built {result.assignmentsRanked} provider{result.assignmentsRanked === 1 ? '' : 's'} across {result.daysProcessed} day{result.daysProcessed === 1 ? '' : 's'}{result.published ? ' · published' : ''}.
                  </div>
                  {Array.isArray(result.warnings) && result.warnings.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11.5, color: '#92400E' }}>
                      {result.warnings.slice(0, 6).map((w, i) => <li key={i} style={{ marginTop: 2 }}>{w}</li>)}
                      {result.warnings.length > 6 && <li style={{ marginTop: 2 }}>+{result.warnings.length - 6} more…</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {error && <div style={{ color: '#DC2626', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
              <button onClick={saveRules} disabled={saving || !dirty} style={{ padding: '9px 16px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: dirty && !saving ? 'pointer' : 'not-allowed', color: '#0F172A', opacity: dirty ? 1 : 0.55 }}>
                {saving ? 'Saving…' : dirty ? 'Save rules' : 'Rules saved'}
              </button>
              <button onClick={run} disabled={running} style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1 }}>
                {running ? 'Building…' : `⚡ Build ${scope === 'week' ? 'week' : monthName} out lists`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
