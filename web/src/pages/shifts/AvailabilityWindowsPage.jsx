import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

const STATUS_STYLE = {
  ACTIVE: { bg: '#F0FDF4', color: '#15803D', border: '#86EFAC', label: 'ACTIVE' },
  DRAFT:  { bg: '#FEFCE8', color: '#A16207', border: '#FDE68A', label: 'DRAFT' },
  CLOSED: { bg: '#F8FAFC', color: '#64748B', border: '#CBD5E1', label: 'CLOSED' },
}

const BLANK_FORM = { windowName: '', openDate: '', closeDate: '', message: '', notifyAll: true }

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 14,
  color: '#0F172A',
  background: '#F8FAFC',
  boxSizing: 'border-box',
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.CLOSED
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
      {s.label}
    </span>
  )
}

function sortWindows(windows) {
  const order = { ACTIVE: 0, DRAFT: 1, CLOSED: 2 }
  return [...windows].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
}

export default function AvailabilityWindowsPage({ onNavigate }) {
  const [windows, setWindows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)

  const [reportWindow, setReportWindow] = useState(null)
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  const [actionLoading, setActionLoading] = useState({})
  const [reminderSent, setReminderSent] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await facilityAPI.getWindows()
      setWindows(Array.isArray(data) ? data : data.windows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setShowForm(true)
  }

  function openEdit(w) {
    setEditTarget(w)
    setForm({
      windowName: w.windowName || '',
      openDate: w.openDate ? w.openDate.substring(0, 10) : '',
      closeDate: w.closeDate ? w.closeDate.substring(0, 10) : '',
      message: w.message || '',
      notifyAll: w.notifyAll !== false,
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.windowName.trim() || !form.openDate || !form.closeDate) return alert('Name, open date, and close date are required.')
    setSaving(true)
    try {
      if (editTarget) {
        await facilityAPI.updateWindow(editTarget.id, form)
      } else {
        await facilityAPI.createWindow(form)
      }
      setShowForm(false)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate(id) {
    setActionLoading((p) => ({ ...p, [id + '_activate']: true }))
    try {
      await facilityAPI.activateWindow(id)
      await load()
    } catch (e) {
      alert('Activate failed: ' + e.message)
    } finally {
      setActionLoading((p) => ({ ...p, [id + '_activate']: false }))
    }
  }

  async function handleReminder(id) {
    setActionLoading((p) => ({ ...p, [id + '_remind']: true }))
    try {
      await facilityAPI.sendWindowReminder(id)
      setReminderSent((p) => ({ ...p, [id]: true }))
    } catch (e) {
      alert('Reminder failed: ' + e.message)
    } finally {
      setActionLoading((p) => ({ ...p, [id + '_remind']: false }))
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this availability window?')) return
    setActionLoading((p) => ({ ...p, [id + '_delete']: true }))
    try {
      await facilityAPI.deleteWindow(id)
      await load()
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setActionLoading((p) => ({ ...p, [id + '_delete']: false }))
    }
  }

  async function openReport(w) {
    setReportWindow(w)
    setReport(null)
    setReportLoading(true)
    try {
      const data = await facilityAPI.getWindowReport(w.id)
      setReport(data)
    } catch (e) {
      setReport({ error: e.message })
    } finally {
      setReportLoading(false)
    }
  }

  async function sendReminderFromReport() {
    if (!reportWindow) return
    await handleReminder(reportWindow.id)
  }

  function setF(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  const sorted = sortWindows(windows)

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Availability Windows</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Collect availability from your internal roster</p>
        </div>
        <button
          onClick={openCreate}
          style={{ padding: '11px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Create Window
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading windows...</div>}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 20 }}>
          Error: {error}
        </div>
      )}

      {!loading && sorted.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>No availability windows yet.</div>
          <div style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>Create a window to start collecting availability from your providers.</div>
          <button onClick={openCreate} style={{ padding: '11px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            + Create Your First Window
          </button>
        </div>
      )}

      {/* Window cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sorted.map((w) => {
          const submitted = w._count?.submissions ?? w.submittedCount ?? 0
          const total = w.rosterCount ?? 0
          const pct = total > 0 ? Math.round((submitted / total) * 100) : 0

          return (
            <div
              key={w.id}
              style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '22px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 17, color: '#0F172A' }}>{w.windowName}</span>
                    <StatusBadge status={w.status} />
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B', marginBottom: 10 }}>
                    {w.openDate ? w.openDate.substring(0, 10) : '—'} → {w.closeDate ? w.closeDate.substring(0, 10) : '—'}
                  </div>
                  {/* Submission progress */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>
                      {submitted} of {total} submitted — {pct}%
                    </div>
                    <div style={{ background: '#F1F5F9', borderRadius: 6, height: 6, overflow: 'hidden', maxWidth: 280 }}>
                      <div style={{ background: pct === 100 ? '#10B981' : '#2563EB', height: '100%', width: `${pct}%`, borderRadius: 6, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {w.status === 'DRAFT' && (
                    <button
                      onClick={() => handleActivate(w.id)}
                      disabled={actionLoading[w.id + '_activate']}
                      style={{ padding: '7px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#15803D' }}
                    >
                      {actionLoading[w.id + '_activate'] ? '...' : '▶ Activate'}
                    </button>
                  )}
                  {w.status === 'ACTIVE' && (
                    <button
                      onClick={() => handleReminder(w.id)}
                      disabled={actionLoading[w.id + '_remind'] || reminderSent[w.id]}
                      style={{ padding: '7px 14px', background: reminderSent[w.id] ? '#F0FDF4' : '#FEFCE8', border: `1px solid ${reminderSent[w.id] ? '#86EFAC' : '#FDE68A'}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: reminderSent[w.id] ? '#15803D' : '#A16207' }}
                    >
                      {reminderSent[w.id] ? '✓ Reminder Sent' : '🔔 Send Reminder'}
                    </button>
                  )}
                  <button
                    onClick={() => openReport(w)}
                    style={{ padding: '7px 14px', background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#1D4ED8' }}
                  >
                    📊 View Report
                  </button>
                  <button
                    onClick={() => openEdit(w)}
                    style={{ padding: '7px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDelete(w.id)}
                    disabled={actionLoading[w.id + '_delete']}
                    style={{ padding: '7px 14px', background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#DC2626' }}
                  >
                    {actionLoading[w.id + '_delete'] ? '...' : '🗑️'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Create / Edit form modal */}
      {showForm && (
        <Modal title={editTarget ? 'Edit Window' : 'Create Availability Window'} onClose={() => setShowForm(false)}>
          <Field label="Window Name">
            <input style={inputStyle} value={form.windowName} onChange={(e) => setF('windowName', e.target.value)} placeholder="e.g. June 2026 Availability" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Field label="Open Date">
              <input style={inputStyle} type="date" value={form.openDate} onChange={(e) => setF('openDate', e.target.value)} />
            </Field>
            <Field label="Close Date">
              <input style={inputStyle} type="date" value={form.closeDate} onChange={(e) => setF('closeDate', e.target.value)} />
            </Field>
          </div>
          <Field label="Message to Providers">
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={form.message} onChange={(e) => setF('message', e.target.value)} placeholder="Optional message included with the availability request..." />
          </Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <input type="checkbox" id="notifyAll" checked={form.notifyAll} onChange={(e) => setF('notifyAll', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="notifyAll" style={{ fontSize: 14, color: '#374151', cursor: 'pointer', fontWeight: 500 }}>Notify all roster providers when window opens</label>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Save Window'}
            </button>
          </div>
        </Modal>
      )}

      {/* Report modal */}
      {reportWindow && (
        <Modal title={`Report — ${reportWindow.windowName}`} onClose={() => { setReportWindow(null); setReport(null) }}>
          {reportLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8' }}>Loading report...</div>}
          {report && report.error && <div style={{ color: '#DC2626', fontSize: 14 }}>Error loading report: {report.error}</div>}
          {report && !report.error && (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#0F172A' }}>{report.totalRoster ?? 0}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Total Roster</div>
                </div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#10B981' }}>{report.submitted ?? 0}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Submitted</div>
                </div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#2563EB' }}>{report.percentComplete ?? 0}%</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Complete</div>
                </div>
              </div>
              {(report.notSubmitted || []).length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                    Have not submitted ({report.notSubmitted.length})
                  </div>
                  <div style={{ background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    {report.notSubmitted.map((name, i) => (
                      <div key={i} style={{ padding: '10px 16px', borderBottom: i < report.notSubmitted.length - 1 ? '1px solid #F1F5F9' : 'none', fontSize: 14, color: '#374151' }}>
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={sendReminderFromReport}
                disabled={reminderSent[reportWindow.id]}
                style={{ width: '100%', padding: '11px', background: reminderSent[reportWindow.id] ? '#F0FDF4' : '#FEFCE8', border: `1px solid ${reminderSent[reportWindow.id] ? '#86EFAC' : '#FDE68A'}`, borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', color: reminderSent[reportWindow.id] ? '#15803D' : '#A16207' }}
              >
                {reminderSent[reportWindow.id] ? '✓ Reminder Sent to Non-Responders' : '🔔 Send Reminder to Non-Responders'}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
