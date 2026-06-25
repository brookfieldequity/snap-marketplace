import React, { useState, useEffect } from 'react'
import { payrollAPI } from '../../api.js'

const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const ghostBtn = { padding: '8px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CLASS_LABEL = { W2: 'W-2', CONTRACTOR: '1099' }
const COL = '1.4fr 0.7fr 0.7fr 0.7fr 0.9fr 1fr 1fr 1fr 1fr 180px'

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function PayrollHistoryPage({ onNavigate }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // editingId → current invoice number string being edited
  const [editing, setEditing] = useState({})
  // id of run pending delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    payrollAPI
      .getRuns()
      .then((res) => setRuns(res.runs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function redownload(run) {
    try {
      const { run: full } = await payrollAPI.getRun(run.id)
      downloadCsv(full.csvContent || '', full.fileName || `${run.id}.csv`)
    } catch (e) {
      setError(e.message)
    }
  }

  function startEdit(run) {
    setEditing((prev) => ({ ...prev, [run.id]: run.invoiceNumber || '' }))
    setConfirmDelete(null)
  }

  function cancelEdit(id) {
    setEditing((prev) => { const n = { ...prev }; delete n[id]; return n })
  }

  async function saveEdit(run) {
    setSaving(run.id)
    try {
      const { run: updated } = await payrollAPI.updateRun(run.id, { invoiceNumber: editing[run.id] })
      setRuns((prev) => prev.map((r) => r.id === run.id ? { ...r, invoiceNumber: updated.invoiceNumber } : r))
      cancelEdit(run.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  async function deleteRun(id) {
    setSaving(id)
    try {
      await payrollAPI.deleteRun(id)
      setRuns((prev) => prev.filter((r) => r.id !== id))
      setConfirmDelete(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Payroll History</h1>
          <div style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Every payroll run you've exported. Edit the invoice # or delete a run.</div>
        </div>
        <button style={ghostBtn} onClick={() => onNavigate('payroll')}>
          ← Back to Builder
        </button>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: '#64748B' }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={{ ...card, color: '#64748B' }}>No payroll runs yet. Build and export one from the Payroll Builder.</div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '10px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div>Pay Period</div>
            <div>System</div>
            <div>Class</div>
            <div>Providers</div>
            <div>Hours</div>
            <div>Base Gross</div>
            <div>Bonus</div>
            <div>Reimb.</div>
            <div>Exported By</div>
            <div></div>
          </div>

          {runs.map((run) => {
            const isEditing = run.id in editing
            const isConfirming = confirmDelete === run.id
            const isBusy = saving === run.id

            return (
              <React.Fragment key={run.id}>
                <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '12px 16px', borderBottom: isEditing || isConfirming ? 'none' : '1px solid #F1F5F9', alignItems: 'center', fontSize: 13, background: isEditing || isConfirming ? '#FAFBFF' : '#fff' }}>
                  <div>
                    <div style={{ color: '#0F172A', fontWeight: 600 }}>
                      {run.periodStart?.slice(0, 10)} — {run.periodEnd?.slice(0, 10)}
                    </div>
                    {run.invoiceNumber && !isEditing && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Inv #{run.invoiceNumber}</div>
                    )}
                  </div>
                  <div style={{ color: '#64748B' }}>{run.system}</div>
                  <div style={{ color: '#64748B' }}>{CLASS_LABEL[run.payClass] || run.payClass}</div>
                  <div style={{ color: '#64748B' }}>{run.providerCount}</div>
                  <div style={{ color: '#64748B' }}>{run.totalHours}</div>
                  <div style={{ color: '#059669', fontWeight: 700 }}>{fmtMoney(run.totalGross)}</div>
                  <div style={{ color: run.totalBonus > 0 ? '#7C3AED' : '#94A3B8', fontWeight: run.totalBonus > 0 ? 700 : 400 }}>
                    {run.totalBonus > 0 ? fmtMoney(run.totalBonus) : '—'}
                  </div>
                  <div style={{ color: run.totalReimbursement > 0 ? '#0369A1' : '#94A3B8', fontWeight: run.totalReimbursement > 0 ? 700 : 400 }}>
                    {run.totalReimbursement > 0 ? fmtMoney(run.totalReimbursement) : '—'}
                  </div>
                  <div style={{ color: '#64748B', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {run.exportedByName || '—'}
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{run.exportedAt?.slice(0, 10)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button style={ghostBtn} onClick={() => redownload(run)} disabled={isBusy} title="Re-download CSV">
                      ↓
                    </button>
                    {!isEditing && !isConfirming && (
                      <>
                        <button style={ghostBtn} onClick={() => startEdit(run)} disabled={isBusy} title="Edit invoice number">
                          ✎
                        </button>
                        <button
                          style={{ ...ghostBtn, color: '#DC2626', borderColor: '#FCA5A5' }}
                          onClick={() => { setConfirmDelete(run.id); cancelEdit(run.id) }}
                          disabled={isBusy}
                          title="Delete run"
                        >
                          ✕
                        </button>
                      </>
                    )}
                    {isEditing && (
                      <>
                        <button style={{ ...ghostBtn, background: '#2563EB', color: '#fff', borderColor: '#2563EB' }} onClick={() => saveEdit(run)} disabled={isBusy}>
                          {isBusy ? '…' : 'Save'}
                        </button>
                        <button style={ghostBtn} onClick={() => cancelEdit(run.id)} disabled={isBusy}>Cancel</button>
                      </>
                    )}
                    {isConfirming && (
                      <>
                        <button style={{ ...ghostBtn, background: '#DC2626', color: '#fff', borderColor: '#DC2626' }} onClick={() => deleteRun(run.id)} disabled={isBusy}>
                          {isBusy ? '…' : 'Delete'}
                        </button>
                        <button style={ghostBtn} onClick={() => setConfirmDelete(null)} disabled={isBusy}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Edit panel */}
                {isEditing && (
                  <div style={{ padding: '0 16px 14px', borderBottom: '1px solid #F1F5F9', background: '#FAFBFF', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Invoice #</label>
                    <input
                      autoFocus
                      value={editing[run.id]}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [run.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(run); if (e.key === 'Escape') cancelEdit(run.id) }}
                      placeholder="e.g. INV-2024-001"
                      style={{ padding: '6px 10px', border: '1.5px solid #CBD5E1', borderRadius: 7, fontSize: 13, width: 220, outline: 'none' }}
                    />
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>Press Enter to save, Esc to cancel</span>
                  </div>
                )}

                {/* Delete confirmation panel */}
                {isConfirming && (
                  <div style={{ padding: '0 16px 14px', borderBottom: '1px solid #F1F5F9', background: '#FFF8F8', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>Delete this payroll run?</span>
                    <span style={{ fontSize: 12, color: '#64748B' }}>The stored CSV and all line items will be permanently removed.</span>
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
