import React, { useEffect, useState, useCallback } from 'react'
import { ptoBuilderAPI } from '../../api.js'

// Admin PTO Builder (Feature B) — open an annual ranking window, set per-week
// capacity, hand out ranking links, run allocation, manage results + waitlist.

const STATUS_STYLE = {
  DRAFT:     { bg: '#F1F5F9', color: '#475569', label: 'Draft' },
  OPEN:      { bg: '#ECFDF5', color: '#047857', label: 'Open for ranking' },
  CLOSED:    { bg: '#FEF3C7', color: '#92400E', label: 'Closed' },
  ALLOCATED: { bg: '#EEF2FF', color: '#4338CA', label: 'Allocated' },
}
const weekLabel = (ws) => {
  const [y, m, d] = ws.split('-').map(Number)
  const f = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(new Date(y, m - 1, d))} – ${f(new Date(y, m - 1, d + 4))}`
}
const nextYear = new Date().getFullYear() + 1

export default function PtoBuilderPage() {
  const [windows, setWindows] = useState([])
  const [win, setWin] = useState(null)        // active window (summary)
  const [calendar, setCalendar] = useState(null)
  const [results, setResults] = useState(null)
  const [links, setLinks] = useState(null)
  const [tab, setTab] = useState('setup')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [capDraft, setCapDraft] = useState({})  // weekStart -> capacity string
  const [createForm, setCreateForm] = useState({ year: nextYear, openDate: '', closeDate: '', defaultWeeklyCapacity: 2, maxRanks: 15 })

  const loadWindows = useCallback(async () => {
    setLoading(true)
    try {
      const { windows } = await ptoBuilderAPI.getWindows()
      setWindows(windows)
      if (windows.length && !win) selectWindow(windows[0].id)
    } catch (e) { /* surfaced inline */ }
    finally { setLoading(false) }
  }, []) // eslint-disable-line

  useEffect(() => { loadWindows() }, [loadWindows])

  async function selectWindow(id) {
    const [detail, cal, res] = await Promise.all([
      ptoBuilderAPI.getWindow(id), ptoBuilderAPI.getCalendar(id), ptoBuilderAPI.getResults(id),
    ])
    setWin(detail.window)
    setCalendar(cal)
    setResults(res)
    const cap = {}
    for (const w of cal.weeks) cap[w.weekStart] = String(w.capacity)
    setCapDraft(cap)
  }

  async function refresh() { if (win) await selectWindow(win.id) }

  async function create() {
    if (!createForm.openDate || !createForm.closeDate) return alert('Set open and close dates.')
    setBusy(true)
    try {
      const w = await ptoBuilderAPI.createWindow(createForm)
      await loadWindows(); await selectWindow(w.id)
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function setStatus(status) {
    setBusy(true)
    try { await ptoBuilderAPI.setStatus(win.id, status); await refresh() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function saveCapacity() {
    setBusy(true)
    try {
      const overrides = calendar.weeks
        .filter((w) => String(w.capacity) !== capDraft[w.weekStart])
        .map((w) => ({ weekStart: w.weekStart, capacity: capDraft[w.weekStart] }))
      await ptoBuilderAPI.setCapacity(win.id, overrides)
      await refresh()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function allocate() {
    if (!confirm('Run allocation now? This (re)computes all grants and the waitlist from current rankings.')) return
    setBusy(true)
    try { const r = await ptoBuilderAPI.allocate(win.id); await refresh(); setTab('results'); alert(`Allocated ${r.granted} weeks · ${r.waitlisted} waitlisted.`) }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function cancelGrant(id) {
    if (!confirm('Cancel this granted week? The top of the waitlist will be auto-promoted.')) return
    setBusy(true); try { await ptoBuilderAPI.cancelAllocation(id); await refresh() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function promote(id) {
    setBusy(true); try { await ptoBuilderAPI.promoteAllocation(id, true); await refresh() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function loadLinks() {
    const { links } = await ptoBuilderAPI.getRankLinks(win.id); setLinks(links)
  }

  if (loading) return <Pad><div style={{ color: '#94A3B8', textAlign: 'center', padding: 50 }}>Loading…</div></Pad>

  // ── No window yet → create form ─────────────────────────────────────────────
  if (!win) {
    return (
      <Pad>
        <H1>PTO Builder</H1>
        <P>Open an annual PTO window. Eligible providers rank the weeks they want; at close you run allocation to award weeks by rank and seniority within each week's capacity.</P>
        <Card>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14, color: '#0F172A' }}>Create a window</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Lbl t="Year"><input type="number" style={inp} value={createForm.year} onChange={(e) => setCreateForm((f) => ({ ...f, year: e.target.value }))} /></Lbl>
            <Lbl t="Default weekly capacity"><input type="number" min="1" style={inp} value={createForm.defaultWeeklyCapacity} onChange={(e) => setCreateForm((f) => ({ ...f, defaultWeeklyCapacity: e.target.value }))} /></Lbl>
            <Lbl t="Ranking opens"><input type="date" style={inp} value={createForm.openDate} onChange={(e) => setCreateForm((f) => ({ ...f, openDate: e.target.value }))} /></Lbl>
            <Lbl t="Ranking closes"><input type="date" style={inp} value={createForm.closeDate} onChange={(e) => setCreateForm((f) => ({ ...f, closeDate: e.target.value }))} /></Lbl>
            <Lbl t="Weeks each provider may rank"><input type="number" min="1" max="52" style={inp} value={createForm.maxRanks} onChange={(e) => setCreateForm((f) => ({ ...f, maxRanks: e.target.value }))} /></Lbl>
          </div>
          <button onClick={create} disabled={busy} style={primaryBtn}>Create window</button>
        </Card>
      </Pad>
    )
  }

  const ss = STATUS_STYLE[win.status] || STATUS_STYLE.DRAFT
  const weeksWithBids = (calendar?.weeks || []).filter((w) => w.bids.length > 0)

  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <H1>PTO Builder · {win.year}</H1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ background: ss.bg, color: ss.color, fontSize: 12, fontWeight: 700, padding: '3px 11px', borderRadius: 20 }}>{ss.label}</span>
            <span style={{ fontSize: 13, color: '#64748B' }}>Ranks up to {win.maxRanks} weeks · default {win.defaultWeeklyCapacity}/week</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {win.status !== 'OPEN' && <button onClick={() => setStatus('OPEN')} disabled={busy} style={primaryBtn}>Open ranking</button>}
          {win.status === 'OPEN' && <button onClick={() => setStatus('CLOSED')} disabled={busy} style={warnBtn}>Close ranking</button>}
          <button onClick={allocate} disabled={busy} style={greenBtn}>▶ Run allocation</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '20px 0' }}>
        {[['setup', 'Setup'], ['weeks', `Weeks & Bids${weeksWithBids.length ? ` (${weeksWithBids.length})` : ''}`], ['links', 'Ranking Links'], ['results', 'Results']].map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); if (k === 'links' && !links) loadLinks() }}
            style={{ padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: tab === k ? '#2563EB' : '#fff', color: tab === k ? '#fff' : '#64748B', border: `1.5px solid ${tab === k ? '#2563EB' : '#E2E8F0'}` }}>{l}</button>
        ))}
      </div>

      {tab === 'setup' && (
        <Card>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12, color: '#0F172A' }}>Window settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 520 }}>
            <Lbl t="Ranking opens"><input type="date" style={inp} value={win.openDate?.slice(0, 10) || ''} onChange={(e) => ptoBuilderAPI.updateWindow(win.id, { openDate: e.target.value }).then(refresh)} /></Lbl>
            <Lbl t="Ranking closes"><input type="date" style={inp} value={win.closeDate?.slice(0, 10) || ''} onChange={(e) => ptoBuilderAPI.updateWindow(win.id, { closeDate: e.target.value }).then(refresh)} /></Lbl>
            <Lbl t="Default weekly capacity"><input type="number" min="1" style={inp} defaultValue={win.defaultWeeklyCapacity} onBlur={(e) => ptoBuilderAPI.updateWindow(win.id, { defaultWeeklyCapacity: e.target.value }).then(refresh)} /></Lbl>
            <Lbl t="Weeks rankable per provider"><input type="number" min="1" max="52" style={inp} defaultValue={win.maxRanks} onBlur={(e) => ptoBuilderAPI.updateWindow(win.id, { maxRanks: e.target.value }).then(refresh)} /></Lbl>
          </div>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 14 }}>Set per-week capacity overrides under <strong>Weeks &amp; Bids</strong>. Share the per-provider links under <strong>Ranking Links</strong> once the window is open.</p>
        </Card>
      )}

      {tab === 'weeks' && calendar && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0F172A' }}>Weeks &amp; rankings</div>
            <button onClick={saveCapacity} disabled={busy} style={primaryBtnSm}>Save capacity</button>
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginTop: 0 }}>Showing weeks providers have ranked. Capacity = how many may have PTO that week (blank cells use the default {win.defaultWeeklyCapacity}).</p>
          {weeksWithBids.length === 0 && <div style={{ color: '#94A3B8', padding: '20px 0', fontSize: 14 }}>No rankings submitted yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {weeksWithBids.map((w) => (
              <div key={w.weekStart} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14, color: '#0F172A', minWidth: 130 }}>{weekLabel(w.weekStart)}</strong>
                  <label style={{ fontSize: 12, color: '#64748B' }}>Capacity{' '}
                    <input type="number" min="0" value={capDraft[w.weekStart] ?? ''} onChange={(e) => setCapDraft((c) => ({ ...c, [w.weekStart]: e.target.value }))}
                      style={{ width: 56, padding: '5px 8px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13 }} />
                  </label>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>{w.bids.length} ranked · {w.granted.length} granted · {w.waitlist.length} waitlisted</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {w.bids.map((b, i) => {
                    const isGranted = w.granted.some((g) => g.name === b.name)
                    return (
                      <span key={i} title={`Rank #${b.rank}${b.seniorityRank != null ? ` · seniority ${b.seniorityRank}` : ''}`}
                        style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 16, border: `1px solid ${isGranted ? '#6EE7B7' : '#E2E8F0'}`, background: isGranted ? '#ECFDF5' : '#F8FAFC', color: isGranted ? '#047857' : '#475569' }}>
                        #{b.rank} {b.name}{isGranted ? ' ✓' : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'links' && (
        <Card>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: '#0F172A' }}>Per-provider ranking links</div>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 0 }}>Send each provider their private link. No login needed — they pick and rank their weeks. Open the window first so links are live.</p>
          {!links && <button onClick={loadLinks} style={primaryBtnSm}>Generate links</button>}
          {links && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {links.map((l) => {
                const url = `${window.location.origin}/pto-rank/${l.token}`
                return (
                  <div key={l.rosterEntryId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 9 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', minWidth: 160 }}>{l.name}</span>
                    {l.providerType && <span style={{ fontSize: 11, color: '#94A3B8' }}>{l.providerType}</span>}
                    <input readOnly value={url} style={{ flex: 1, fontSize: 12, color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 7, padding: '5px 8px' }} onFocus={(e) => e.target.select()} />
                    <button onClick={() => navigator.clipboard?.writeText(url)} style={primaryBtnSm}>Copy</button>
                  </div>
                )
              })}
              {links.length === 0 && <div style={{ color: '#94A3B8', fontSize: 14, padding: '12px 0' }}>No PTO-eligible providers found. Mark providers eligible on the roster.</div>}
            </div>
          )}
        </Card>
      )}

      {tab === 'results' && results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: '#0F172A' }}>Granted ({results.granted.length})</div>
            {results.granted.length === 0 && <div style={{ color: '#94A3B8', fontSize: 14 }}>Nothing granted yet — run allocation.</div>}
            {results.granted.map((a) => (
              <Row key={a.id}>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{a.rosterEntry.providerName}</span>
                <span style={{ color: '#64748B', fontSize: 13 }}>{weekLabel(a.weekStart.slice(0, 10))} · rank #{a.rank}</span>
                <button onClick={() => cancelGrant(a.id)} disabled={busy} style={{ ...miniDanger, marginLeft: 'auto' }}>Cancel</button>
              </Row>
            ))}
          </Card>
          <Card>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: '#0F172A' }}>Waitlist ({results.waitlisted.length})</div>
            {results.waitlisted.length === 0 && <div style={{ color: '#94A3B8', fontSize: 14 }}>No one waitlisted.</div>}
            {results.waitlisted.map((a) => (
              <Row key={a.id}>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{a.rosterEntry.providerName}</span>
                <span style={{ color: '#64748B', fontSize: 13 }}>{weekLabel(a.weekStart.slice(0, 10))} · rank #{a.rank} · waitlist #{a.waitlistPos}</span>
                <button onClick={() => promote(a.id)} disabled={busy} style={{ ...primaryBtnSm, marginLeft: 'auto' }}>Grant anyway</button>
              </Row>
            ))}
          </Card>
        </div>
      )}
    </Pad>
  )
}

// ── tiny presentational helpers ───────────────────────────────────────────────
const inp = { width: '100%', padding: '9px 11px', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, boxSizing: 'border-box' }
const primaryBtn = { marginTop: 16, padding: '11px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const primaryBtnSm = { padding: '7px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const greenBtn = { padding: '8px 16px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const warnBtn = { padding: '8px 16px', background: '#fff', color: '#B45309', border: '1.5px solid #FDE68A', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const miniDanger = { padding: '6px 12px', background: '#FFF5F5', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const Pad = ({ children }) => <div style={{ padding: '32px 40px', maxWidth: 1000, margin: '0 auto' }}>{children}</div>
const H1 = ({ children }) => <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>{children}</h1>
const P = ({ children }) => <p style={{ fontSize: 14, color: '#64748B', marginTop: 6, maxWidth: 640 }}>{children}</p>
const Card = ({ children }) => <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 22, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>{children}</div>
const Lbl = ({ t, children }) => <label style={{ display: 'block' }}><div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{t}</div>{children}</label>
const Row = ({ children }) => <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid #F1F5F9' }}>{children}</div>
