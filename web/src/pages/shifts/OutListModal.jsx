import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'

// Out-List Builder — the post-publish "release order" for a single site/day.
// The coordinator ranks the day's staffed providers 1 = leaves first … last =
// closes the facility. Reorder with the ↑/↓ arrows (no drag-drop lib in this
// app), seed a sensible default with "Suggest order", then save — optionally
// publishing it so the on-site floor runner can see it on the Daily view.
//
// Props:
//   dayId    — ScheduleDay id (one site, one date)
//   title    — human label for the header (e.g. "Natick · Monday, June 22")
//   onClose  — close handler
//   onSaved  — optional callback after a successful save (parent can reload)

const EMP_PREFIX = { FULL_TIME: '🔵', PER_DIEM: '🟢', LOCUMS: '🟠' }
const ROLE_TAG = {
  CRNA_ROOM: { text: 'CRNA', bg: '#EFF6FF', color: '#1D4ED8' },
  SOLO_MD_ROOM: { text: 'Solo MD', bg: '#F5F3FF', color: '#1E3A8A' },
  SUPERVISING_MD: { text: 'Supervising MD', bg: '#F5F3FF', color: '#6D28D9' },
}

function fmtWhen(ts) {
  if (!ts) return null
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return null
  }
}

export default function OutListModal({ dayId, title, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([]) // ordered [{ assignmentId, providerName, role, ... }]
  const [suggested, setSuggested] = useState([]) // assignmentId[] in default order
  const [publishedAt, setPublishedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await facilityAPI.getOutList(dayId)
      setRows(res.assignments || [])
      setSuggested(res.suggested || [])
      setPublishedAt(res.outListPublishedAt || null)
      setDirty(false)
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [dayId])

  useEffect(() => { load() }, [load])

  function move(idx, delta) {
    const next = idx + delta
    if (next < 0 || next >= rows.length) return
    const copy = [...rows]
    ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
    setRows(copy)
    setDirty(true)
  }

  function applySuggested() {
    if (suggested.length === 0) return
    const byId = Object.fromEntries(rows.map((r) => [r.assignmentId, r]))
    const reordered = suggested.map((id) => byId[id]).filter(Boolean)
    // Append anything the suggestion didn't cover (defensive).
    rows.forEach((r) => { if (!suggested.includes(r.assignmentId)) reordered.push(r) })
    setRows(reordered)
    setDirty(true)
  }

  async function save(publish) {
    setSaving(true)
    setError(null)
    try {
      const order = rows.map((r) => r.assignmentId)
      await facilityAPI.saveOutList(dayId, order, publish)
      if (onSaved) onSaved()
      await load()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const arrowBtn = (on) => ({
    width: 26, height: 24, borderRadius: 6, border: '1px solid #CBD5E1',
    background: on ? '#fff' : '#F1F5F9', color: on ? '#374151' : '#CBD5E1',
    cursor: on ? 'pointer' : 'default', fontSize: 13, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>🚪 Out List Builder</h2>
            {title && <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{title}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}>✕</button>
        </div>

        <p style={{ fontSize: 12.5, color: '#64748B', margin: '8px 0 16px', lineHeight: 1.5 }}>
          Rank today's staff in the order they're released. <strong>#1 leaves first</strong>; the
          last person <strong>closes the facility</strong>. Publish it so your floor runner can see the order.
        </p>

        {publishedAt && !dirty && (
          <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#047857', marginBottom: 14 }}>
            ✓ Published to floor runner · {fmtWhen(publishedAt)}
          </div>
        )}
        {dirty && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#B45309', marginBottom: 14 }}>
            Unsaved changes
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94A3B8' }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: '14px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No staffed providers on this day yet. Assign people first, then set the out order.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button
                onClick={applySuggested}
                disabled={suggested.length === 0}
                style={{ background: '#EFF6FF', border: '1px solid #A5B4FC', color: '#1D4ED8', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                ✨ Suggest order
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((r, i) => {
                const tag = ROLE_TAG[r.role]
                const isLast = i === rows.length - 1
                return (
                  <div key={r.assignmentId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 10, background: '#F8FAFC' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: isLast ? '#0F172A' : '#2563EB', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {EMP_PREFIX[r.employmentCategory] || ''} {r.providerName || 'Unnamed'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <span style={{ fontSize: 10.5, color: '#94A3B8' }}>
                          {r.isSupervisor ? 'Supervisor' : `Room ${r.roomNumber}`}
                        </span>
                        {tag && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: tag.bg, color: tag.color }}>{tag.text}</span>}
                        {i === 0 && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#059669' }}>· leaves first</span>}
                        {isLast && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#0F172A' }}>· closes 🔒</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                      <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={arrowBtn(i !== 0)}>▲</button>
                      <button onClick={() => move(i, +1)} disabled={isLast} title="Move down" style={arrowBtn(!isLast)}>▼</button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              {publishedAt && (
                <button
                  onClick={() => save(false)}
                  disabled={saving}
                  title="Save the order but hide it from the floor runner"
                  style={{ padding: '9px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', color: '#374151' }}
                >
                  Unpublish
                </button>
              )}
              <button
                onClick={() => save(undefined)}
                disabled={saving}
                style={{ padding: '9px 16px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', color: '#0F172A' }}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                onClick={() => save(true)}
                disabled={saving}
                style={{ padding: '9px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : '📢 Save & publish to floor'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
