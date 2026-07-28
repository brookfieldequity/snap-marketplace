import React, { useState, useEffect, useCallback } from 'react'
import { wcAPI } from '../../api.js'

// ─── WC Recovery tab (WC-RECOVERY-BRIEF.md) ───────────────────────────────────
// Entitlement-first: every case shows what MA 114.3 CMR 40.05(2) owes the
// group, the payer's EOB is just reconciliation, and underpaid cases arrive
// already armed with a staged demand packet. The lifetime "recovered $"
// counter on the dashboard is the same ledger the contingency invoice bills.

const BLUE = '#2563EB'
const DARK = '#0F172A'
const MID = '#64748B'
const RED = '#B91C1C'
const GREEN = '#15803D'
const AMBER = '#B45309'

const money = (n) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Date-only values arrive as UTC midnight — format in UTC so DOS 4/14 never
// displays as 4/13 in Eastern time.
const dstr = (d) => (d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')

const STATUS_META = {
  INGESTED:             { label: 'Ingested',        color: MID },
  ENTITLEMENT_COMPUTED: { label: 'Computed',        color: BLUE },
  UNDERPAYMENT_FLAGGED: { label: 'Underpaid',       color: RED },
  PACKET_GENERATED:     { label: 'Packet ready',    color: AMBER },
  SUBMITTED:            { label: 'Demand sent',     color: AMBER },
  RESOLVED_RECOVERED:   { label: 'Recovered',       color: GREEN },
  RESOLVED_NO_RECOVERY: { label: 'No recovery',     color: MID },
  CLOSED:               { label: 'Closed',          color: MID },
}

function Badge({ status }) {
  const m = STATUS_META[status] || { label: status, color: MID }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12,
      fontWeight: 700, color: '#fff', background: m.color, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  )
}

const card = {
  background: '#fff', borderRadius: 14, padding: 20,
  boxShadow: '0 1px 3px rgba(15,23,42,0.08)', border: '1px solid #E2E8F0',
}
const btn = (bg = BLUE) => ({
  background: bg, color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
})
const btnGhost = {
  background: '#fff', color: DARK, border: '1px solid #CBD5E1', borderRadius: 8,
  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const inp = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, width: '100%',
}
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: MID, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }
const td = { padding: '10px 12px', fontSize: 13, color: DARK, borderTop: '1px solid #F1F5F9' }

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ onNavigate, onOpenCase }) {
  const [summary, setSummary] = useState(null)
  const [workItems, setWorkItems] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    wcAPI.getSummary().then(setSummary).catch((e) => setErr(e.message))
    wcAPI.getWorkItems().then((r) => setWorkItems(r.items || [])).catch(() => {})
  }, [])

  if (err) return <Blocked message={err} />
  if (!summary) return <p style={{ color: MID }}>Loading…</p>

  const flagged = (summary.byStatus.PACKET_GENERATED || 0) + (summary.byStatus.UNDERPAYMENT_FLAGGED || 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* The number the whole product is priced on. */}
      <div style={{ ...card, background: 'linear-gradient(135deg, #0F172A, #1E293B)', border: 'none', padding: '30px 34px' }}>
        <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
          SNAP has recovered
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, color: '#fff', margin: '6px 0' }}>
          {money(summary.recoveredTotal)}
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8' }}>
          {summary.recoveryEvents} recovery event{summary.recoveryEvents === 1 ? '' : 's'} · recognized only when received
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Stat label="Open recoverable gap" value={money(summary.openGap)} color={RED} />
        <Stat label="Cases underpaid / armed" value={flagged} color={AMBER} />
        <Stat label="Demands in flight" value={summary.byStatus.SUBMITTED || 0} color={BLUE} />
        <Stat label="Total cases" value={summary.caseCount} color={DARK} />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: DARK }}>Needs a human ({workItems.length})</h3>
          <button style={btnGhost} onClick={() => onNavigate('wc-cases')}>All cases →</button>
        </div>
        {workItems.length === 0 ? (
          <p style={{ color: MID, fontSize: 13, margin: 0 }}>Nothing waiting — the engine is working every case.</p>
        ) : (
          workItems.slice(0, 8).map((w) => (
            <div key={w.id} onClick={() => onOpenCase(w.case.id)} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0',
              borderTop: '1px solid #F1F5F9', cursor: 'pointer', alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, color: DARK }}>
                <strong>{w.case.claimNumber || w.case.patientRef || w.case.id.slice(-6)}</strong>
                <span style={{ color: MID }}> — {w.note || w.type}</span>
              </div>
              {w.case.gapAmount > 0 && <span style={{ color: RED, fontWeight: 700, fontSize: 13 }}>{money(w.case.gapAmount)}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: MID, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Blocked({ message }) {
  return (
    <div style={{ ...card, borderColor: '#FECACA', background: '#FEF2F2' }}>
      <strong style={{ color: RED }}>WC Recovery unavailable:</strong>{' '}
      <span style={{ color: DARK, fontSize: 14 }}>{message}</span>
    </div>
  )
}

// ─── Cases list ───────────────────────────────────────────────────────────────

function CasesList({ onOpenCase }) {
  const [cases, setCases] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    wcAPI.getCases().then((r) => setCases(r.cases)).catch((e) => setErr(e.message))
  }, [])

  if (err) return <Blocked message={err} />
  if (!cases) return <p style={{ color: MID }}>Loading…</p>
  if (!cases.length) {
    return <div style={card}><p style={{ color: MID, margin: 0 }}>No cases yet — start by uploading the group's last 3–6 months of WC billing under <strong>Upload files</strong>.</p></div>
  }

  return (
    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Claim</th><th style={th}>Payer</th><th style={th}>DOS</th>
            <th style={th}>Entitled</th><th style={th}>Paid</th><th style={th}>Gap</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} onClick={() => onOpenCase(c.id)} style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}>
              <td style={{ ...td, fontWeight: 700 }}>{c.claimNumber || c.patientRef || c.id.slice(-6)}</td>
              <td style={td}>{c.payerName || '—'}</td>
              <td style={td}>{dstr(c.dateOfService)}</td>
              <td style={td}>{money(c.entitledAmount)}</td>
              <td style={td}>{money(c.paidAmount)}</td>
              <td style={{ ...td, color: c.gapAmount > 0 ? RED : GREEN, fontWeight: 700 }}>{money(c.gapAmount)}</td>
              <td style={td}><Badge status={c.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Case detail ──────────────────────────────────────────────────────────────

const DOC_LABELS = {
  AUDIT: 'Entitlement Audit',
  CORRECTED_CLAIM: 'Corrected Claim',
  DEMAND_LETTER: 'Demand Letter',
  PROHIBITED_PRACTICE_COMPLAINT: 'DIA Prohibited-Practice Complaint',
  DIA_CLAIM: 'DIA Claim',
  CLEAN_CLAIM: 'Clean Claim',
}

function CaseDetail({ caseId, onBack }) {
  const [c, setC] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null) // draft of anesthesia fields
  const [payAmt, setPayAmt] = useState('')

  const load = useCallback(() => {
    wcAPI.getCase(caseId).then((r) => setC(r.case)).catch((e) => setErr(e.message))
  }, [caseId])
  useEffect(load, [load])

  if (err) return <Blocked message={err} />
  if (!c) return <p style={{ color: MID }}>Loading…</p>

  const calc = c.entitlementCalc
  const lowConfidence = c.confidenceScore != null && c.confidenceScore < 0.7

  async function saveEdit() {
    setBusy(true)
    try {
      await wcAPI.updateCase(c.id, {
        ...edit,
        baseUnits: edit.baseUnits === '' ? null : Number(edit.baseUnits),
        anesthesiaMinutes: edit.anesthesiaMinutes === '' ? null : Number(edit.anesthesiaMinutes),
      })
      setEdit(null); load()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  async function markSent(docId) {
    if (!window.confirm('Confirm this packet was sent to the carrier? The case moves to "Demand sent".')) return
    setBusy(true)
    try { await wcAPI.markDocSent(c.id, docId); load() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  async function recordPayment() {
    const amt = Number(payAmt)
    if (!Number.isFinite(amt) || amt <= 0) return alert('Enter the payment amount received.')
    setBusy(true)
    try { await wcAPI.addRemittance(c.id, { paidAmount: amt }); setPayAmt(''); load() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button style={btnGhost} onClick={onBack}>← Cases</button>
        <Badge status={c.status} />
      </div>

      {c.nextAction && (
        <div style={{ ...card, borderLeft: `4px solid ${BLUE}`, padding: '12px 16px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: BLUE, textTransform: 'uppercase', letterSpacing: 0.5 }}>Next action</span>
          <div style={{ fontSize: 14, color: DARK, marginTop: 2 }}>{c.nextAction}</div>
        </div>
      )}

      {/* Entitlement vs paid — the heart of the case */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <Stat label="MA entitlement" value={money(c.entitledAmount)} color={DARK} />
        <Stat label="Paid by carrier" value={money(c.paidAmount)} color={MID} />
        <Stat label="Gap (owed)" value={money(c.gapAmount)} color={c.gapAmount > 0 ? RED : GREEN} />
      </div>

      {calc && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, color: DARK }}>Unit math — 114.3 CMR 40.05(2)</h3>
          <div style={{ fontSize: 13, color: DARK, lineHeight: 1.9 }}>
            Base units: <strong>{calc.inputsJson.baseUnits}</strong>
            {c.asaCptCode ? ` (CPT ${c.asaCptCode})` : ''} ·
            Time units: <strong>{calc.inputsJson.timeUnits}</strong> ({c.anesthesiaMinutes} min ÷ {calc.minutesPerUnit}) ·
            Modifier units: <strong>{calc.inputsJson.modifierUnits}</strong>
            <br />
            Total <strong>{calc.totalUnits}</strong> units × ${calc.conversionFactor.toFixed(2)} = <strong>{money(calc.entitledAmount)}</strong>
          </div>
          {c.underpaymentReason && c.underpaymentReason !== 'PAID_IN_FULL' && (
            <div style={{ marginTop: 8, fontSize: 13, color: RED, fontWeight: 600 }}>
              Pattern: {c.underpaymentReason.replaceAll('_', ' ').toLowerCase()}
            </div>
          )}
        </div>
      )}

      {/* Anesthesia detail confirm/edit — the human-exception path */}
      <div style={{ ...card, ...(lowConfidence ? { borderColor: '#FCD34D', background: '#FFFBEB' } : {}) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: DARK }}>
            Anesthesia detail {lowConfidence && <span style={{ color: AMBER, fontSize: 13 }}>· needs confirmation</span>}
          </h3>
          {!edit && <button style={btnGhost} onClick={() => setEdit({
            asaCptCode: c.asaCptCode || '', baseUnits: c.baseUnits ?? '', anesthesiaMinutes: c.anesthesiaMinutes ?? '',
            physicalStatus: c.physicalStatus || '', claimNumber: c.claimNumber || '', payerName: c.payerName || '',
          })}>Edit / confirm</button>}
        </div>
        {edit ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, color: MID }}>CPT<input style={inp} value={edit.asaCptCode} onChange={(e) => setEdit({ ...edit, asaCptCode: e.target.value })} /></label>
            <label style={{ fontSize: 12, color: MID }}>Base units<input style={inp} type="number" value={edit.baseUnits} onChange={(e) => setEdit({ ...edit, baseUnits: e.target.value })} /></label>
            <label style={{ fontSize: 12, color: MID }}>Minutes<input style={inp} type="number" value={edit.anesthesiaMinutes} onChange={(e) => setEdit({ ...edit, anesthesiaMinutes: e.target.value })} /></label>
            <label style={{ fontSize: 12, color: MID }}>Physical status
              <select style={inp} value={edit.physicalStatus} onChange={(e) => setEdit({ ...edit, physicalStatus: e.target.value })}>
                <option value="">None</option>
                {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: MID }}>Claim #<input style={inp} value={edit.claimNumber} onChange={(e) => setEdit({ ...edit, claimNumber: e.target.value })} /></label>
            <label style={{ fontSize: 12, color: MID }}>Payer<input style={inp} value={edit.payerName} onChange={(e) => setEdit({ ...edit, payerName: e.target.value })} /></label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button style={btn()} disabled={busy} onClick={saveEdit}>Save & recompute</button>
              <button style={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: DARK, lineHeight: 1.9 }}>
            CPT <strong>{c.asaCptCode || '—'}</strong> · Base <strong>{c.baseUnits ?? '—'}</strong> ·
            Time <strong>{c.anesthesiaMinutes ?? '—'} min</strong> · PS <strong>{c.physicalStatus || '—'}</strong> ·
            QC <strong>{(c.qualifyingCircs || []).join(', ') || '—'}</strong>
            <br />
            Claim <strong>{c.claimNumber || '—'}</strong> · Payer <strong>{c.payerName || '—'}</strong> ·
            DOS <strong>{dstr(c.dateOfService)}</strong> · DOI <strong>{dstr(c.dateOfInjury)}</strong> ·
            Employer <strong>{c.employerName || '—'}</strong>
          </div>
        )}
      </div>

      {/* Staged packets — generate ≠ send */}
      {c.documents?.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, color: DARK }}>Packet (auto-staged)</h3>
          {c.documents.map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: 13, color: DARK }}>
                <strong>{DOC_LABELS[d.type] || d.type}</strong>
                {d.status === 'SENT'
                  ? <span style={{ color: GREEN, fontWeight: 700 }}> · sent {dstr(d.sentAt)}</span>
                  : <span style={{ color: MID }}> · staged</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnGhost} onClick={() => wcAPI.openDocPdf(c.id, d.id).catch((e) => alert(e.message))}>View PDF</button>
                {d.status !== 'SENT' && d.type === 'DEMAND_LETTER' && (
                  <button style={btn(AMBER)} disabled={busy} onClick={() => markSent(d.id)}>Mark sent</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Record a received payment — the only way recovery is recognized */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: DARK }}>Record a received payment</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={{ ...inp, width: 160 }} type="number" placeholder="Amount received" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
          <button style={btn(GREEN)} disabled={busy} onClick={recordPayment}>Record</button>
          <span style={{ fontSize: 12, color: MID }}>Payments received after the demand count toward the recovery ledger.</span>
        </div>
        {c.recoveryEvents?.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 13, color: GREEN, fontWeight: 700 }}>
            Recovered on this case: {money(c.recoveryEvents.reduce((s, e) => s + e.amount, 0))}
          </div>
        )}
      </div>

      {/* Activity trail */}
      {c.activity?.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, color: DARK }}>Activity</h3>
          {c.activity.map((a) => (
            <div key={a.id} style={{ fontSize: 12, color: MID, padding: '4px 0' }}>
              {new Date(a.createdAt).toLocaleString()} — {a.action.replaceAll('_', ' ').toLowerCase()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

function Ingest({ onDone }) {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)

  async function run() {
    if (!files.length) return
    setBusy(true); setErr(null); setResult(null)
    try {
      const r = await wcAPI.ingest(files)
      setResult(r); setFiles([])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16, color: DARK }}>Upload WC billing files</h3>
        <p style={{ fontSize: 13, color: MID, marginTop: 0 }}>
          Billing-system exports (CSV/PDF), EMR anesthesia records, or payer EOBs — the reader normalizes
          whatever the group has. Start with the last 3–6 months: that batch is the baseline <em>and</em>
          immediate recovery targets.
        </p>
        <input
          type="file" multiple accept=".pdf,.csv,.txt,.tsv,.jpg,.jpeg,.png"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          style={{ fontSize: 13, margin: '8px 0' }}
        />
        <div>
          <button style={btn()} disabled={busy || !files.length} onClick={run}>
            {busy ? 'Reading…' : `Read ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {err && <Blocked message={err} />}
      {result && (
        <div style={{ ...card, borderColor: '#BBF7D0', background: '#F0FDF4' }}>
          <strong style={{ color: GREEN }}>Done.</strong>{' '}
          <span style={{ fontSize: 14, color: DARK }}>
            {result.created} new case{result.created === 1 ? '' : 's'}, {result.merged} merged,
            {' '}{result.remittances} payment{result.remittances === 1 ? '' : 's'} recorded.
            {result.notes ? ` ${result.notes}` : ''}
          </span>
          <div style={{ marginTop: 10 }}>
            <button style={btn()} onClick={onDone}>Review cases →</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

function Ledger() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { wcAPI.getLedger().then(setData).catch((e) => setErr(e.message)) }, [])

  if (err) return <Blocked message={err} />
  if (!data) return <p style={{ color: MID }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Stat label="Lifetime recovered" value={money(data.recoveredTotal)} color={GREEN} />
        <Stat label="Not yet invoiced" value={money(data.uninvoicedTotal)} color={DARK} />
        {data.contingencyPct > 0 && (
          <Stat label={`SNAP fee (${data.contingencyPct}%)`} value={money(data.uninvoicedTotal * data.contingencyPct / 100)} color={BLUE} />
        )}
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Recognized</th><th style={th}>Claim</th><th style={th}>Payer</th><th style={th}>Basis</th><th style={th}>Amount</th></tr></thead>
          <tbody>
            {data.events.length === 0 && (
              <tr><td style={{ ...td, color: MID }} colSpan={5}>No recovery recognized yet — dollars land here when a carrier pays after a demand.</td></tr>
            )}
            {data.events.map((e) => (
              <tr key={e.id}>
                <td style={td}>{dstr(e.recognizedAt)}</td>
                <td style={td}>{e.case?.claimNumber || e.case?.patientRef || '—'}</td>
                <td style={td}>{e.case?.payerName || '—'}</td>
                <td style={td}>{e.basis.replaceAll('_', ' ').toLowerCase()}</td>
                <td style={{ ...td, color: GREEN, fontWeight: 700 }}>{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function WcApp({ page, onNavigate }) {
  const [openCaseId, setOpenCaseId] = useState(null)

  // Sidebar navigation resets any open case drill-in.
  useEffect(() => { setOpenCaseId(null) }, [page])

  const openCase = (id) => { setOpenCaseId(id); onNavigate('wc-cases') }

  const TITLES = {
    'wc-dashboard': "Workers' Comp Recovery",
    'wc-cases': "Workers' comp cases",
    'wc-ingest': 'Upload files',
    'wc-ledger': 'Recovery ledger',
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22, color: DARK }}>{TITLES[page] || 'WC Recovery'}</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: MID }}>
        Workers' comp paid at the Massachusetts schedule — every case, automatically.
      </p>
      {page === 'wc-dashboard' && <Dashboard onNavigate={onNavigate} onOpenCase={openCase} />}
      {page === 'wc-cases' && (openCaseId
        ? <CaseDetail caseId={openCaseId} onBack={() => setOpenCaseId(null)} />
        : <CasesList onOpenCase={setOpenCaseId} />)}
      {page === 'wc-ingest' && <Ingest onDone={() => onNavigate('wc-cases')} />}
      {page === 'wc-ledger' && <Ledger />}
    </div>
  )
}
