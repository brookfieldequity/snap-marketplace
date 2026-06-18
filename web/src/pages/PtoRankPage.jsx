import React, { useEffect, useState } from 'react'
import { ptoBuilderAPI } from '../api.js'

// Public PTO ranking page (Feature B) — reached via a signed link
// /pto-rank/{token}. No login. The provider picks the PTO weeks they want and
// orders them; rank = position in the ordered list (1 = most wanted).

function weekLabel(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number)
  const mon = new Date(y, m - 1, d)
  const fri = new Date(y, m - 1, d + 4)
  const f = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(mon)} – ${f(fri)}`
}
function monthOf(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function PtoRankPage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ranked, setRanked] = useState([]) // ordered array of weekStart strings
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ptoBuilderAPI.getRank(token)
      .then((d) => {
        setData(d)
        setRanked(d.myBids.sort((a, b) => a.rank - b.rank).map((b) => b.weekStart))
      })
      .catch((e) => setError(e.message || 'Invalid link'))
  }, [token])

  if (error) return <Centered><h2 style={{ color: '#B91C1C' }}>Link problem</h2><p style={{ color: '#64748B' }}>{error}</p></Centered>
  if (!data) return <Centered><p style={{ color: '#94A3B8' }}>Loading…</p></Centered>

  const { window: win, provider, facility, weeks, editable } = data
  const maxRanks = win.maxRanks
  const rankedSet = new Set(ranked)

  function toggle(weekStart) {
    if (!editable) return
    setSaved(false)
    if (rankedSet.has(weekStart)) {
      setRanked((r) => r.filter((w) => w !== weekStart))
    } else {
      if (ranked.length >= maxRanks) return
      setRanked((r) => [...r, weekStart])
    }
  }
  function move(i, dir) {
    setSaved(false)
    setRanked((r) => {
      const next = [...r]
      const j = i + dir
      if (j < 0 || j >= next.length) return r
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function submit() {
    setSaving(true)
    try {
      await ptoBuilderAPI.submitRank(token, ranked.map((weekStart, i) => ({ weekStart, rank: i + 1 })))
      setSaved(true)
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // Group weeks by month for the picker.
  const byMonth = {}
  for (const w of weeks) { (byMonth[monthOf(w)] = byMonth[monthOf(w)] || []).push(w) }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 700 }}>🌴 {facility.name} · {win.year} PTO Selection</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '6px 0 2px' }}>Rank your PTO weeks, {provider.name}</h1>
        <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
          Pick up to <strong>{maxRanks}</strong> weeks you'd like off, then order them — #1 is your most wanted.
          Weeks are awarded by rank and seniority within each week's limit.
        </p>
        {!editable && (
          <div style={{ marginTop: 12, background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>
            This window is {win.status === 'CLOSED' || win.status === 'ALLOCATED' ? 'closed' : 'not open yet'} — ranking is view-only.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        {/* Week picker */}
        <div>
          {Object.entries(byMonth).map(([month, wks]) => (
            <div key={month} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{month}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {wks.map((w) => {
                  const sel = rankedSet.has(w)
                  const rank = sel ? ranked.indexOf(w) + 1 : null
                  return (
                    <button key={w} onClick={() => toggle(w)} disabled={!editable || (!sel && ranked.length >= maxRanks)}
                      style={{
                        padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: editable ? 'pointer' : 'default',
                        border: `1.5px solid ${sel ? '#2563EB' : '#E2E8F0'}`, background: sel ? '#2563EB' : '#fff', color: sel ? '#fff' : '#334155',
                        opacity: (!sel && ranked.length >= maxRanks) ? 0.45 : 1,
                      }}>
                      {sel && <span style={{ fontWeight: 800 }}>#{rank} </span>}{weekLabel(w)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Ranked summary */}
        <div style={{ position: 'sticky', top: 20, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Your ranking ({ranked.length}/{maxRanks})</div>
          {ranked.length === 0 && <div style={{ fontSize: 13, color: '#94A3B8', padding: '12px 0' }}>Tap weeks on the left to add them.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {ranked.map((w, i) => (
              <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 9, padding: '7px 10px' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#2563EB', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#334155' }}>{weekLabel(w)}</span>
                {editable && <>
                  <button onClick={() => move(i, -1)} disabled={i === 0} style={miniBtn(i === 0)}>↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === ranked.length - 1} style={miniBtn(i === ranked.length - 1)}>↓</button>
                  <button onClick={() => toggle(w)} style={{ ...miniBtn(false), color: '#DC2626' }}>✕</button>
                </>}
              </div>
            ))}
          </div>
          {editable && (
            <button onClick={submit} disabled={saving} style={{ width: '100%', marginTop: 14, padding: '11px 0', background: saved ? '#10B981' : '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Submit my ranking'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function miniBtn(disabled) {
  return { width: 26, height: 26, borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', color: '#64748B', fontSize: 13, fontWeight: 700, opacity: disabled ? 0.4 : 1, flexShrink: 0 }
}
function Centered({ children }) {
  return <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: 'system-ui, sans-serif', padding: 20 }}>{children}</div>
}
