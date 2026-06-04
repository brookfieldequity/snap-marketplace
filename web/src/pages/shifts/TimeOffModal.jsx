import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

/**
 * Time off / PTO manager for one roster member. Coordinator-entered (v1).
 * Adding time off makes the Schedule Builder hard-exclude this provider on
 * those dates and grays them out in the day editor — so they can't be
 * scheduled while off.
 */
export default function TimeOffModal({ member, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await facilityAPI.getTimeOff()
      setRows((data.timeOff || []).filter((t) => t.rosterEntryId === member.id))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [member.id])

  async function add() {
    setError(null)
    if (!start) return setError('Pick a start date.')
    setSaving(true)
    try {
      await facilityAPI.addTimeOff(member.id, { startDate: start, endDate: end || start, reason: reason || null })
      setStart(''); setEnd(''); setReason('')
      await load()
      onChanged && onChanged()
    } catch (e) {
      setError(e.message || 'Could not add.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    try {
      await facilityAPI.deleteTimeOff(id)
      setRows((rs) => rs.filter((r) => r.id !== id))
      onChanged && onChanged()
    } catch (e) {
      setError(e.message || 'Could not remove.')
    }
  }

  const fmt = (d) => (d || '').substring(0, 10)

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.header}>
          <h2 style={S.title}>Time Off — {member.providerName}</h2>
          <button onClick={onClose} style={S.close}>✕</button>
        </div>

        <div style={S.addRow}>
          <label style={S.lbl}>Start
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={S.input} />
          </label>
          <label style={S.lbl}>End
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={S.input} />
          </label>
          <label style={{ ...S.lbl, flex: 1 }}>Reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PTO, conference…" style={{ ...S.input, width: '100%' }} />
          </label>
          <button onClick={add} disabled={saving} style={S.addBtn}>{saving ? 'Adding…' : '+ Add'}</button>
        </div>
        {error && <div style={S.err}>{error}</div>}

        <div style={{ marginTop: 16 }}>
          {loading ? (
            <div style={S.muted}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={S.muted}>No time off scheduled.</div>
          ) : (
            rows.map((t) => (
              <div key={t.id} style={S.item}>
                <div style={{ fontSize: 13, color: '#0F172A' }}>
                  <strong>{fmt(t.startDate)}</strong>
                  {fmt(t.endDate) !== fmt(t.startDate) ? ` → ${fmt(t.endDate)}` : ''}
                  {t.reason ? <span style={{ color: '#64748B' }}> · {t.reason}</span> : ''}
                </div>
                <button onClick={() => remove(t.id)} style={S.del}>Remove</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 24 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { fontSize: 19, fontWeight: 800, color: '#0F172A', margin: 0 },
  close: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B', lineHeight: 1 },
  addRow: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  lbl: { fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', flexDirection: 'column', gap: 3 },
  input: { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 13, color: '#0F172A' },
  addBtn: { padding: '9px 16px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  err: { color: '#DC2626', fontSize: 12, marginTop: 8 },
  muted: { color: '#94A3B8', fontSize: 13, padding: '8px 0' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #F1F5F9' },
  del: { background: 'none', border: 'none', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
}
