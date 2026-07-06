import React, { useState, useEffect, useCallback } from 'react'
import { payrollAPI } from '../../api.js'

// ── Shared styles (match the SNAP Shifts light theme) ──────────────────────────
const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const primaryBtn = { padding: '10px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const inputStyle = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A' }
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: '#64748B', borderBottom: '1px solid #E2E8F0' }
const td = { padding: '8px 10px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// Default period = most recent completed two-week window ending last Saturday
// (mirrors the Payroll Builder so the two stay aligned).
function defaultPeriod() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() - ((today.getDay() + 1) % 7))
  const start = new Date(end)
  start.setDate(end.getDate() - 13)
  return { start: fmtDate(start), end: fmtDate(end) }
}

export default function AgencyInvoicePage({ onNavigate }) {
  const [period, setPeriod] = useState(defaultPeriod())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [invoices, setInvoices] = useState(null)
  const [downloading, setDownloading] = useState('')

  // Saved exports (history) — every download freezes a snapshot server-side.
  const [runs, setRuns] = useState([])
  const [runBusy, setRunBusy] = useState('') // run id being downloaded/deleted
  const [editingRun, setEditingRun] = useState(null) // run id whose invoice # is being edited
  const [invoiceNoDraft, setInvoiceNoDraft] = useState('')

  const load = useCallback(async () => {
    if (!period.start || !period.end) return
    setLoading(true)
    setError('')
    try {
      const data = await payrollAPI.getAgencyInvoice({ periodStart: period.start, periodEnd: period.end })
      setInvoices(data.invoices || [])
    } catch (err) {
      setError(err.message || 'Failed to load invoice')
      setInvoices(null)
    } finally {
      setLoading(false)
    }
  }, [period.start, period.end])

  useEffect(() => { load() }, [load])

  const loadRuns = useCallback(async () => {
    try {
      const res = await payrollAPI.getAgencyInvoiceRuns()
      setRuns(res.runs || [])
    } catch {
      // History is non-critical — leave the list as-is on failure.
    }
  }, [])
  useEffect(() => { loadRuns() }, [loadRuns])

  async function download(inv) {
    setDownloading(inv.employerId || inv.employerName || 'x')
    try {
      await payrollAPI.downloadAgencyInvoice({
        periodStart: period.start,
        periodEnd: period.end,
        employerId: inv.employerId,
        fileName: `${(inv.employerName || 'agency').replace(/[^a-z0-9]+/gi, '-')}-invoice-${period.start}.xlsx`,
      })
      loadRuns() // the export just added a history row
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setDownloading('')
    }
  }

  async function downloadRun(run) {
    setRunBusy(run.id)
    try {
      await payrollAPI.downloadAgencyInvoiceRun({ id: run.id, fileName: run.fileName })
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setRunBusy('')
    }
  }

  async function deleteRun(run) {
    if (!window.confirm(`Delete the saved invoice "${run.fileName}" from history? The exported file you downloaded is unaffected.`)) return
    setRunBusy(run.id)
    try {
      await payrollAPI.deleteAgencyInvoiceRun(run.id)
      setRuns((rs) => rs.filter((r) => r.id !== run.id))
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setRunBusy('')
    }
  }

  async function saveInvoiceNumber(run) {
    try {
      await payrollAPI.updateAgencyInvoiceRun(run.id, { invoiceNumber: invoiceNoDraft })
      setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, invoiceNumber: invoiceNoDraft.trim() || null } : r)))
    } catch (err) {
      setError(err.message || 'Failed to save invoice number')
    } finally {
      setEditingRun(null)
      setInvoiceNoDraft('')
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '8px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>🧾 Agency Invoice</h1>
      </div>
      <p style={{ fontSize: 14, color: '#64748B', marginTop: 0, marginBottom: 20 }}>
        What you owe each staffing agency this period: hours worked × each provider's all-in cost rate.
        Malpractice and margin are baked into the rate, so nothing is added on top.
      </p>

      {/* Period selector */}
      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
          Period start
          <input style={inputStyle} type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
          Period end
          <input style={inputStyle} type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
        </label>
        <button style={ghostBtn} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#B91C1C', marginBottom: 20 }}>{error}</div>
      )}

      {loading && <div style={{ color: '#64748B', fontSize: 14 }}>Building invoice…</div>}

      {!loading && invoices && invoices.length === 0 && (
        <div style={{ ...card, color: '#64748B', textAlign: 'center' }}>
          No agency-billable hours in this period. (Only 1099/agency providers with hours worked
          and an all-in cost rate on their roster card appear here.)
        </div>
      )}

      {!loading && invoices && invoices.map((inv) => (
        <div key={inv.employerId || inv.employerName} style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{inv.employerName || 'Agency'}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)} · {inv.providerCount} providers</div>
            </div>
            <button style={downloading ? { ...primaryBtn, background: '#CBD5E1', cursor: 'wait' } : primaryBtn} onClick={() => download(inv)} disabled={!!downloading}>
              {downloading ? 'Preparing…' : '⬇ Download .xlsx'}
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Payee</th>
                <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                <th style={{ ...th, textAlign: 'right' }}>All-in rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.rosterEntryId}>
                  <td style={td}>{l.contractorType}</td>
                  <td style={td}>{l.payeeName}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.hours}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(l.capaRate)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, borderBottom: 'none' }} colSpan={4}>
                  <span style={{ fontWeight: 800, color: '#0F172A' }}>Total</span>
                </td>
                <td style={{ ...td, borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: '#2563EB', fontSize: 15 }}>{fmtMoney(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {/* ── Invoice history — every export is frozen exactly as billed ── */}
      <div style={{ ...card, marginTop: 8, marginBottom: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Invoice History</div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
          Each export is saved exactly as generated — re-downloads match the file you sent, even if hours or rates changed afterward. Saved invoices can be renumbered or deleted here.
        </div>
        {runs.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No saved invoices yet — click “Download .xlsx” above and the export will be recorded here automatically.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Exported</th>
                <th style={th}>Agency</th>
                <th style={th}>Period</th>
                <th style={th}>Invoice #</th>
                <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td style={td}>{new Date(run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={td}>{run.employerName || 'Agency'}</td>
                  <td style={td}>{fmtDate(run.periodStart)} → {fmtDate(run.periodEnd)}</td>
                  <td style={td}>
                    {editingRun === run.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input
                          style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, width: 110 }}
                          value={invoiceNoDraft}
                          autoFocus
                          onChange={(e) => setInvoiceNoDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveInvoiceNumber(run); if (e.key === 'Escape') { setEditingRun(null); setInvoiceNoDraft('') } }}
                        />
                        <button style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }} onClick={() => saveInvoiceNumber(run)}>Save</button>
                      </span>
                    ) : (
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: run.invoiceNumber ? '#0F172A' : '#94A3B8', padding: 0, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                        title="Edit invoice number"
                        onClick={() => { setEditingRun(run.id); setInvoiceNoDraft(run.invoiceNumber || '') }}
                      >
                        {run.invoiceNumber || 'add #'}
                      </button>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{run.hours}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(run.total)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...ghostBtn, padding: '5px 12px', fontSize: 12, marginRight: 6, opacity: runBusy === run.id ? 0.5 : 1 }}
                      disabled={!!runBusy}
                      onClick={() => downloadRun(run)}
                    >
                      ⬇ Download
                    </button>
                    <button
                      style={{ ...ghostBtn, padding: '5px 12px', fontSize: 12, color: '#B91C1C', borderColor: '#FCA5A5', opacity: runBusy === run.id ? 0.5 : 1 }}
                      disabled={!!runBusy}
                      onClick={() => deleteRun(run)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
