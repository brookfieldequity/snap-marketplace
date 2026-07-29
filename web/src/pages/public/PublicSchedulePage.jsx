import React, { useEffect, useMemo, useState } from 'react'
import { scheduleShareAPI } from '../../api.js'

// Public, no-login per-site monthly schedule (the shareable link sent to each
// surgical center). Two switchable views — Calendar and List — both print to a
// clean PDF. Design mirrors the approved mockup.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function roleBadge(type) {
  const t = String(type || '').toUpperCase()
  if (t.includes('ANESTHESIOLOG') || t === 'MD' || t === 'PHYSICIAN') return 'MD'
  if (t.includes('CRNA')) return 'CRNA'
  if (t.includes('ASSISTANT') || t === 'AA') return 'AA'
  return type ? String(type).slice(0, 4) : ''
}

const CSS = `
.sw-wrap{max-width:880px;margin:0 auto;padding:22px 16px 64px;}
.sw-switch{display:flex;justify-content:center;margin-bottom:16px;}
.sw-seg{display:inline-flex;background:var(--sw-paper);border:1px solid var(--sw-line);border-radius:12px;padding:4px;box-shadow:var(--sw-shadow);gap:3px;}
.sw-seg button{border:none;background:transparent;color:var(--sw-ink-soft);font:inherit;font-size:13.5px;font-weight:700;padding:8px 20px;border-radius:9px;cursor:pointer;transition:all .12s;}
.sw-seg button.on{background:var(--sw-accent);color:#fff;}
.sw-sheet{background:var(--sw-paper);border:1px solid var(--sw-line);border-radius:18px;box-shadow:var(--sw-shadow);overflow:hidden;}
.sw-head{padding:24px 30px 20px;border-bottom:1px solid var(--sw-line);}
.sw-eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--sw-accent);font-weight:700;}
.sw-h1{font-size:clamp(22px,3.4vw,29px);font-weight:750;letter-spacing:-.02em;margin:7px 0 3px;line-height:1.1;color:var(--sw-ink);}
.sw-sub{color:var(--sw-ink-soft);font-size:14.5px;}
.sw-updated{margin-top:11px;display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--sw-ink-faint);}
.sw-dot{width:7px;height:7px;border-radius:999px;background:#25c26e;box-shadow:0 0 0 3px color-mix(in srgb,#25c26e 22%,transparent);}
.sw-legend{display:flex;gap:16px;flex-wrap:wrap;padding:11px 30px;border-bottom:1px solid var(--sw-line-soft);font-size:12px;color:var(--sw-ink-faint);}
.sw-legend b{color:var(--sw-ink-soft);font-weight:600;}
.sw-p{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--sw-ink);line-height:1.3;}
.sw-p::before{content:"";width:5px;height:5px;border-radius:999px;background:var(--sw-accent);flex:none;}
.sw-p .role{color:var(--sw-ink-faint);font-size:11px;font-weight:600;}
.sw-cal{padding:14px 18px 20px;overflow-x:auto;}
.sw-calinner{min-width:620px;}
.sw-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px;}
.sw-dow span{text-align:center;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sw-ink-faint);padding:2px 0;}
.sw-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
.sw-cell{min-height:98px;border:1px solid var(--sw-line);border-radius:11px;padding:8px 9px;display:flex;flex-direction:column;gap:5px;}
.sw-cell.blank{border:none;}
.sw-cell.closed{background:var(--sw-closed);border-color:transparent;}
.sw-date{font-size:14px;font-weight:750;font-variant-numeric:tabular-nums;color:var(--sw-ink);}
.sw-cell.closed .sw-date{color:var(--sw-closed-ink);}
.sw-closedlbl{font-size:12px;color:var(--sw-closed-ink);font-weight:600;margin-top:auto;}
.sw-cwho{display:flex;flex-direction:column;gap:4px;}
.sw-agenda{padding:8px 14px 16px;}
.sw-row{display:flex;align-items:center;gap:16px;padding:11px 12px;border-radius:12px;}
.sw-row+.sw-row{border-top:1px solid var(--sw-line-soft);}
.sw-dpill{flex:none;width:56px;text-align:center;}
.sw-dpill .dwd{display:block;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--sw-accent-deep);}
.sw-dpill .dnum{display:block;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.05;color:var(--sw-ink);}
.sw-rwho{flex:1;display:flex;flex-wrap:wrap;gap:8px 18px;}
.sw-rwho.empty{color:var(--sw-closed-ink);font-size:12.5px;font-weight:600;}
.sw-foot{padding:15px 30px 20px;border-top:1px solid var(--sw-line-soft);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}
.sw-prov{font-size:11.5px;color:var(--sw-ink-faint);}
.sw-prov b{color:var(--sw-accent);font-weight:750;}
.sw-disclaim{font-size:11px;color:var(--sw-ink-faint);}
.sw-actions{max-width:880px;margin:16px auto 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
.sw-btn{font-size:13px;font-weight:700;padding:9px 18px;border-radius:10px;border:1px solid var(--sw-line);background:var(--sw-paper);color:var(--sw-ink-soft);cursor:pointer;box-shadow:var(--sw-shadow);}
.sw-btn.primary{background:var(--sw-accent);color:#fff;border-color:transparent;}
@media (max-width:560px){.sw-row{gap:11px;}.sw-dpill{width:44px;}.sw-dpill .dnum{font-size:20px;}.sw-head,.sw-legend,.sw-foot{padding-left:20px;padding-right:20px;}}
@media print{
  :root{--sw-bg:#fff;--sw-paper:#fff;}
  body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .sw-switch,.sw-actions,.sw-note{display:none !important;}
  .sw-wrap{padding:0;max-width:none;}
  .sw-sheet{border:none;border-radius:0;box-shadow:none;}
  .sw-cal{overflow:visible;}.sw-calinner{min-width:0;}.sw-cell{min-height:74px;}
  .sw-head{padding:6px 0 10px;}.sw-legend,.sw-foot{padding-left:0;padding-right:0;}
  @page{margin:14mm;}
}
:root{
  --sw-bg:#eef2f5;--sw-paper:#fff;--sw-ink:#12202e;--sw-ink-soft:#4a5b6b;--sw-ink-faint:#8395a3;
  --sw-line:#e3e9ee;--sw-line-soft:#eef2f5;--sw-accent:#1f6feb;--sw-accent-deep:#134aa8;--sw-accent-soft:#e5effd;
  --sw-closed:#f5f7f9;--sw-closed-ink:#a7b4c0;--sw-shadow:0 1px 2px rgba(18,32,46,.05),0 14px 34px -18px rgba(18,32,46,.28);
}
@media (prefers-color-scheme:dark){:root{
  --sw-bg:#0c141c;--sw-paper:#131f2a;--sw-ink:#e9f0f6;--sw-ink-soft:#aebccb;--sw-ink-faint:#758697;
  --sw-line:#243440;--sw-line-soft:#1b2a35;--sw-accent:#4d94ff;--sw-accent-deep:#7fb2ff;--sw-accent-soft:#122740;
  --sw-closed:#16232e;--sw-closed-ink:#5a6b78;--sw-shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px -20px rgba(0,0,0,.7);
}}
`

function ProviderLine({ p, list }) {
  return (
    <span className="sw-p">{p.name}{p.type ? <span className="role"> {roleBadge(p.type)}</span> : null}</span>
  )
}

export default function PublicSchedulePage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('cal') // 'cal' | 'list'

  useEffect(() => {
    document.body.style.background = 'var(--sw-bg)'
    let alive = true
    scheduleShareAPI.get(token)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e.message || 'This schedule link is not available.') })
    return () => { alive = false }
  }, [token])

  const byDate = useMemo(() => {
    const m = {}
    for (const d of data?.days || []) m[d.date] = d
    return m
  }, [data])

  if (error) {
    return (
      <>
        <style>{CSS}</style>
        <div className="sw-wrap"><div className="sw-sheet"><div className="sw-head"><div className="sw-h1">Schedule not found</div><div className="sw-sub">{error}</div></div></div></div>
      </>
    )
  }
  if (!data) {
    return (<><style>{CSS}</style><div className="sw-wrap"><div className="sw-sub" style={{ textAlign: 'center', paddingTop: 40 }}>Loading…</div></div></>)
  }

  const { year, month, monthLabel, siteName, orgName, updatedAt } = data
  const pad = (n) => String(n).padStart(2, '0')
  const daysInMonth = new Date(year, month, 0).getDate()
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()

  // Calendar cells: leading blanks, then each date.
  const cells = []
  for (let i = 0; i < leading; i++) cells.push({ blank: true, key: `b${i}` })
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`
    const day = byDate[ds]
    cells.push({ key: ds, d, ds, providers: day?.providers, needs: day?.needsCoverage || 0, operating: day !== undefined })
  }

  // A spot whose provider dropped (PTO granted after publish) — shown as
  // honest "coverage being arranged", never as a name that won't show up.
  const TbdChip = ({ n }) => (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', borderRadius: 6, padding: '2px 6px', fontSize: 10.5, fontWeight: 700, marginTop: 2, display: 'inline-block' }}>
      ⏳ {n > 1 ? `${n} spots — ` : ''}coverage being arranged
    </div>
  )

  const updatedStr = updatedAt ? new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  return (
    <>
      <style>{CSS}</style>
      <div className="sw-wrap">
        <div className="sw-switch">
          <div className="sw-seg">
            <button className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>📅 Calendar</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>☰ List</button>
          </div>
        </div>

        <div className="sw-sheet">
          <div className="sw-head">
            <div className="sw-eyebrow">Anesthesia Coverage</div>
            <div className="sw-h1">{siteName}</div>
            <div className="sw-sub">Monthly provider schedule · {monthLabel} {year}</div>
            {updatedStr && <div className="sw-updated"><span className="sw-dot"></span> Current as of {updatedStr} · assignments may change</div>}
          </div>

          <div className="sw-legend">
            <span><b>MD</b> Anesthesiologist</span>
            <span><b>CRNA</b> Nurse Anesthetist</span>
            <span>Days not shown — no coverage scheduled</span>
          </div>

          {view === 'cal' ? (
            <div className="sw-cal">
              <div className="sw-calinner">
                <div className="sw-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                <div className="sw-grid">
                  {cells.map((c) => {
                    if (c.blank) return <div className="sw-cell blank" key={c.key}></div>
                    const has = (c.providers && c.providers.length > 0) || c.needs > 0
                    if (!has) return <div className="sw-cell closed" key={c.key}><span className="sw-date">{c.d}</span><div className="sw-closedlbl">{c.operating ? 'Unassigned' : '—'}</div></div>
                    return (
                      <div className="sw-cell" key={c.key}>
                        <span className="sw-date">{c.d}</span>
                        <div className="sw-cwho">
                          {(c.providers || []).map((p, i) => <ProviderLine key={i} p={p} />)}
                          {c.needs > 0 && <TbdChip n={c.needs} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="sw-agenda">
              {(data.days || []).filter((d) => (d.providers || []).length > 0 || (d.needsCoverage || 0) > 0).map((d) => {
                const dt = new Date(d.date + 'T00:00:00Z')
                return (
                  <div className="sw-row" key={d.date}>
                    <div className="sw-dpill"><span className="dwd">{DOW[dt.getUTCDay()]}</span><span className="dnum">{dt.getUTCDate()}</span></div>
                    <div className="sw-rwho">
                      {(d.providers || []).map((p, i) => <ProviderLine key={i} p={p} />)}
                      {(d.needsCoverage || 0) > 0 && <TbdChip n={d.needsCoverage} />}
                    </div>
                  </div>
                )
              })}
              {(data.days || []).filter((d) => (d.providers || []).length > 0 || (d.needsCoverage || 0) > 0).length === 0 && (
                <div className="sw-row"><div className="sw-rwho empty">No coverage published for {monthLabel} yet.</div></div>
              )}
            </div>
          )}

          <div className="sw-foot">
            <span className="sw-prov">Prepared with <b>SNAP</b>{orgName ? ` · shared by ${orgName}` : ''}</span>
            <span className="sw-disclaim">Live schedule — always current at this link.</span>
          </div>
        </div>

        <div className="sw-actions">
          <button className="sw-btn primary" onClick={() => window.print()}>⬇ Save as PDF</button>
        </div>
      </div>
    </>
  )
}
