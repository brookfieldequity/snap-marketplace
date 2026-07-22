import React, { useEffect, useMemo, useRef, useState } from 'react'
import { credMapAPI } from '../../api.js'

// Cred Maps — map a facility's credentialing program once; every provider's
// packet populates from the passport. Hub (map cards + sticky-note reminders)
// plus the builder (AI-proposed items → review → confirm). Sticky notes and
// drag-and-drop reuse the Shifts request-board design language (Kalam font).

const FULFILLMENT = {
  AUTO_PASSPORT: { label: 'Auto from Passport', icon: '⚡', bg: '#DCFCE7', fg: '#166534' },
  DOCUMENT: { label: 'Document', icon: '📄', bg: '#DBEAFE', fg: '#1E40AF' },
  SIGNATURE: { label: 'Signature', icon: '✍️', bg: '#EDE9FE', fg: '#5B21B6' },
  MANUAL: { label: 'Manual', icon: '🛠️', bg: '#FEF3C7', fg: '#92400E' },
}

const OUTPUT_MODES = [
  { key: 'PDF_PACKET', label: 'Fillable PDF packet' },
  { key: 'DOC_BUNDLE', label: 'Email / document bundle' },
  { key: 'PORTAL_EXPORT', label: 'Software portal export' },
]

const CONFIDENCE_DOT = { HIGH: '#22C55E', MEDIUM: '#F59E0B', LOW: '#EF4444' }

const NOTE_COLORS = ['#FEF08A', '#FBCFE8', '#BAE6FD', '#BBF7D0', '#FED7AA']

function useKalamFont() {
  useEffect(() => {
    if (!document.getElementById('snap-kalam-font')) {
      const link = document.createElement('link')
      link.id = 'snap-kalam-font'
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap'
      document.head.appendChild(link)
    }
    if (!document.getElementById('snap-postit-kf')) {
      const style = document.createElement('style')
      style.id = 'snap-postit-kf'
      style.textContent = `@keyframes postitDeal{0%{transform:translateY(10px) rotate(0deg);opacity:0}100%{opacity:1}}`
      document.head.appendChild(style)
    }
  }, [])
}

function StatusPill({ status }) {
  const meta = {
    DRAFT: { label: 'Draft', bg: '#F1F5F9', fg: '#475569' },
    CONFIRMED: { label: 'Confirmed', bg: '#DCFCE7', fg: '#166534' },
    ARCHIVED: { label: 'Archived', bg: '#F1F5F9', fg: '#94A3B8' },
  }[status] || { label: status, bg: '#F1F5F9', fg: '#475569' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  )
}

function AutoFillBar({ stats }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>
          ⚡ {stats.autoCount} of {stats.itemCount} items auto-fill from the SNAP Passport
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#166534' }}>{stats.autoPct}%</span>
      </div>
      <div style={{ height: 8, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${stats.autoPct}%`, height: '100%', background: 'linear-gradient(90deg, #22C55E, #16A34A)', borderRadius: 999, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// ── Sticky notes ─────────────────────────────────────────────────────────────

function StickyNotesStrip({ notes, onAdd, onDone, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [color, setColor] = useState(NOTE_COLORS[0])

  async function submit() {
    if (!text.trim()) return
    await onAdd(text.trim(), color)
    setText('')
    setAdding(false)
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>📌 Reminders</span>
        <button
          onClick={() => setAdding((v) => !v)}
          style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {adding ? 'Cancel' : '+ Add note'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {adding && (
          <div style={{ width: 170, background: color, borderRadius: 4, padding: '10px 12px', boxShadow: '0 4px 10px rgba(0,0,0,0.12)' }}>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="Write a reminder…"
              rows={3}
              style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', fontFamily: "'Kalam', cursive", fontSize: 14, color: '#374151', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {NOTE_COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: color === c ? '2px solid #334155' : '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
              <button onClick={submit} style={{ fontSize: 11, fontWeight: 800, background: '#0F172A', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Stick it</button>
            </div>
          </div>
        )}
        {notes.map((n, i) => (
          <div
            key={n.id}
            style={{
              width: 170, background: n.color || '#FEF08A', borderRadius: 4, padding: '10px 12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
              transform: `rotate(${(i % 3) - 1}deg)`,
              animation: 'postitDeal 0.3s ease both',
            }}
          >
            <div style={{ fontFamily: "'Kalam', cursive", fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button title="Done" onClick={() => onDone(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, color: '#16A34A', fontWeight: 800 }}>✓</button>
              <button title="Delete" onClick={() => onDelete(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, color: '#94A3B8', fontWeight: 800 }}>×</button>
            </div>
          </div>
        ))}
        {!adding && notes.length === 0 && (
          <span style={{ fontSize: 12, color: '#94A3B8' }}>No reminders — stick one up.</span>
        )}
      </div>
    </div>
  )
}

// ── New map modal ────────────────────────────────────────────────────────────

function NewMapModal({ aiAvailable, onClose, onAnalyze, onCreate }) {
  const [mode, setMode] = useState(aiAvailable ? 'upload' : 'scratch')
  const [files, setFiles] = useState([])
  const [name, setName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function pickFiles(list) {
    const arr = Array.from(list || []).filter((f) =>
      ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)
    ).slice(0, 5)
    if (arr.length) setFiles(arr)
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      if (mode === 'upload') {
        if (files.length === 0) { setError('Drop the facility\'s blank packet first.'); setBusy(false); return }
        await onAnalyze(files, name.trim() || undefined)
      } else {
        if (!name.trim()) { setError('Give the map a name (usually the facility).'); setBusy(false); return }
        await onCreate(name.trim(), true)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setBusy(false)
    }
  }

  const tabBtn = (key, label) => (
    <button
      onClick={() => setMode(key)}
      style={{
        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: mode === key ? '#EFF6FF' : '#fff', color: mode === key ? '#2563EB' : '#64748B',
        border: 'none', borderBottom: `2px solid ${mode === key ? '#2563EB' : '#E2E8F0'}`,
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={busy ? undefined : onClose}>
      <div style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>New Cred Map</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 }}>
            Map this facility's credentialing program once — every provider's packet populates from the passport.
          </div>
        </div>
        <div style={{ display: 'flex' }}>
          {tabBtn('upload', '✨ Upload their packet')}
          {tabBtn('scratch', '📋 Standard checklist')}
        </div>
        <div style={{ padding: 24 }}>
          {busy ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: 34 }}>🔍</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>
                {mode === 'upload' ? 'Reading the packet…' : 'Setting up…'}
              </div>
              {mode === 'upload' && (
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 6 }}>
                  SNAP is finding every requirement and wiring the passport auto-fill. ~30 seconds.
                </div>
              )}
            </div>
          ) : (
            <>
              {mode === 'upload' && (
                <>
                  {!aiAvailable && (
                    <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '9px 13px', fontSize: 12.5, color: '#92400E', marginBottom: 14 }}>
                      AI packet analysis isn't configured on this server yet — use the standard checklist for now.
                    </div>
                  )}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files) }}
                    onClick={() => inputRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragOver ? '#2563EB' : '#CBD5E1'}`, borderRadius: 12,
                      background: dragOver ? '#EFF6FF' : '#F8FAFC', padding: '28px 16px',
                      textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 28 }}>📥</div>
                    {files.length > 0 ? (
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A', marginTop: 8 }}>
                        {files.map((f) => f.name).join(', ')}
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#334155', marginTop: 8 }}>
                          Drop the facility's blank application packet
                        </div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>PDF or scans · up to 5 files · 25 MB each</div>
                      </>
                    )}
                    <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={(e) => pickFiles(e.target.files)} />
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Map name (optional — SNAP will read it off the packet)"
                    style={{ width: '100%', marginTop: 14, padding: '11px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
                  />
                </>
              )}
              {mode === 'scratch' && (
                <>
                  <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
                    Starts the map with the 17 requirements on essentially every ASC application — then tailor it to this facility.
                  </div>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                    placeholder='e.g. "Beacon Harbor ASC — Medical Staff Application"'
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
                  />
                </>
              )}
              {error && <div style={{ marginTop: 12, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={onClose} style={{ flex: 1, padding: '11px 0', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={submit}
                  disabled={mode === 'upload' && !aiAvailable}
                  style={{
                    flex: 2, padding: '11px 0', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                    background: mode === 'upload' && !aiAvailable ? '#CBD5E1' : '#2563EB', color: '#fff',
                    cursor: mode === 'upload' && !aiAvailable ? 'not-allowed' : 'pointer',
                  }}
                >
                  {mode === 'upload' ? '✨ Analyze packet' : 'Create map'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Map builder ──────────────────────────────────────────────────────────────

function ItemRow({ item, taxonomy, onUpdate, onDelete, dragHandlers, dragging, dragTarget }) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [label, setLabel] = useState(item.label)
  const f = FULFILLMENT[item.fulfillment] || FULFILLMENT.MANUAL

  useEffect(() => { setLabel(item.label) }, [item.label])

  function commitLabel() {
    setEditingLabel(false)
    if (label.trim() && label.trim() !== item.label) onUpdate({ label: label.trim() })
    else setLabel(item.label)
  }

  return (
    <div
      draggable
      {...dragHandlers}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: '#fff', border: `1px solid ${dragTarget ? '#2563EB' : '#E2E8F0'}`,
        borderRadius: 10, marginBottom: 8, opacity: dragging ? 0.4 : 1,
        boxShadow: dragTarget ? '0 0 0 2px rgba(37,99,235,0.25)' : 'none',
        cursor: 'grab',
      }}
    >
      <span style={{ color: '#CBD5E1', fontSize: 14, userSelect: 'none' }}>⠿</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editingLabel ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setLabel(item.label); setEditingLabel(false) } }}
            style={{ width: '100%', fontSize: 13.5, fontWeight: 600, color: '#0F172A', border: '1px solid #2563EB', borderRadius: 6, padding: '3px 8px', outline: 'none', boxSizing: 'border-box' }}
          />
        ) : (
          <div onClick={() => setEditingLabel(true)} title="Click to edit" style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}>
            {item.aiConfidence && (
              <span title={`AI confidence: ${item.aiConfidence}`} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: CONFIDENCE_DOT[item.aiConfidence] || '#94A3B8', marginRight: 7, verticalAlign: 'middle' }} />
            )}
            {item.label}
            {!item.required && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>OPTIONAL</span>}
          </div>
        )}
        {item.notes && <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notes}</div>}
      </div>

      {item.fulfillment === 'SIGNATURE' && (
        <button
          onClick={() => onUpdate({ esignOk: !item.esignOk })}
          title={item.esignOk ? 'E-signature accepted — click if this facility demands wet ink' : 'Wet ink / notarization required — click if e-sign is OK'}
          style={{
            fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
            background: item.esignOk ? '#EDE9FE' : '#FEE2E2', color: item.esignOk ? '#5B21B6' : '#B91C1C',
            border: 'none', whiteSpace: 'nowrap',
          }}
        >
          {item.esignOk ? 'e-sign OK' : 'WET INK'}
        </button>
      )}

      <select
        value={item.fulfillment}
        onChange={(e) => onUpdate({ fulfillment: e.target.value })}
        style={{
          fontSize: 11.5, fontWeight: 700, padding: '4px 6px', borderRadius: 999, border: 'none',
          background: f.bg, color: f.fg, cursor: 'pointer', appearance: 'none', textAlign: 'center',
        }}
      >
        {Object.entries(FULFILLMENT).map(([k, v]) => (
          <option key={k} value={k}>{v.icon} {v.label}</option>
        ))}
      </select>

      <select
        value={item.canonicalType || 'OTHER'}
        onChange={(e) => onUpdate({ canonicalType: e.target.value })}
        title="Canonical requirement type — drives the passport auto-fill wiring"
        style={{ fontSize: 11.5, color: '#64748B', padding: '4px 6px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC', cursor: 'pointer', maxWidth: 150 }}
      >
        {taxonomy.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>

      <button onClick={onDelete} title="Remove item" style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: 16, cursor: 'pointer', padding: '0 2px', fontWeight: 700 }}>×</button>
    </div>
  )
}

function MapBuilder({ mapId, taxonomy, onBack, onChanged }) {
  const [map, setMap] = useState(null)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('OTHER')
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const load = () => credMapAPI.getMap(mapId).then(({ map }) => setMap(map)).catch((e) => setError(e.message))
  useEffect(() => { load() }, [mapId])

  const grouped = useMemo(() => {
    if (!map) return []
    const groups = []
    for (const item of map.items) {
      const section = item.section || 'General'
      const last = groups[groups.length - 1]
      if (last && last.section === section) last.items.push(item)
      else groups.push({ section, items: [item] })
    }
    return groups
  }, [map])

  async function patchMap(data) {
    try {
      const { map: updated } = await credMapAPI.updateMap(mapId, data)
      setMap(updated)
      onChanged()
    } catch (e) { setError(e.message) }
  }

  async function patchItem(itemId, data) {
    try {
      await credMapAPI.updateItem(mapId, itemId, data)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  async function removeItem(itemId) {
    try {
      await credMapAPI.deleteItem(mapId, itemId)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  async function addItem() {
    if (!newLabel.trim()) return
    try {
      await credMapAPI.addItem(mapId, { label: newLabel.trim(), canonicalType: newType })
      setNewLabel(''); setNewType('OTHER'); setAddOpen(false)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  // Native drag-and-drop reorder. Dropping onto an item in another section
  // moves the dragged item there AND adopts that section.
  async function handleDrop(targetItem) {
    const sourceId = dragId
    setDragId(null); setDragOverId(null)
    if (!sourceId || sourceId === targetItem.id) return
    const items = [...map.items]
    const from = items.findIndex((i) => i.id === sourceId)
    const to = items.findIndex((i) => i.id === targetItem.id)
    if (from < 0 || to < 0) return
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    setMap({ ...map, items }) // optimistic
    try {
      if ((moved.section || null) !== (targetItem.section || null)) {
        await credMapAPI.updateItem(mapId, moved.id, { section: targetItem.section })
      }
      await credMapAPI.reorderItems(mapId, items.map((i) => i.id))
      await load(); onChanged()
    } catch (e) { setError(e.message); load() }
  }

  if (!map) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>← All maps</button>
        <div style={{ color: '#94A3B8', fontSize: 14, marginTop: 20 }}>{error || 'Loading…'}</div>
      </div>
    )
  }

  const wetInkCount = map.items.filter((i) => i.fulfillment === 'SIGNATURE' && !i.esignOk).length

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← All maps</button>

      {/* Header card */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            value={map.name}
            onChange={(e) => setMap({ ...map, name: e.target.value })}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== map.name) patchMap({ name: e.target.value.trim() }) }}
            style={{ flex: 1, minWidth: 240, fontSize: 19, fontWeight: 800, color: '#0F172A', border: 'none', outline: 'none', background: 'transparent' }}
          />
          <StatusPill status={map.status} />
          {map.status === 'DRAFT' ? (
            <button onClick={() => patchMap({ status: 'CONFIRMED' })} style={{ padding: '9px 18px', background: '#16A34A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              Confirm map ✓
            </button>
          ) : (
            <button onClick={() => patchMap({ status: 'DRAFT' })} style={{ padding: '9px 14px', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              Reopen draft
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            Recredentialing every
            <input
              type="number" min={1} max={120}
              value={map.recredCycleMonths ?? ''}
              placeholder="—"
              onChange={(e) => setMap({ ...map, recredCycleMonths: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={(e) => patchMap({ recredCycleMonths: e.target.value === '' ? null : Number(e.target.value) })}
              style={{ width: 54, padding: '5px 8px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', outline: 'none' }}
            />
            months
          </label>
          <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            Output
            <select
              value={map.outputMode}
              onChange={(e) => patchMap({ outputMode: e.target.value })}
              style={{ padding: '5px 8px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', cursor: 'pointer' }}
            >
              {OUTPUT_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          {map.sourceDocName && (
            <span style={{ fontSize: 12, color: '#94A3B8' }}>📎 {map.sourceDocName}</span>
          )}
        </div>

        {map.aiNotes && (
          <div style={{ marginTop: 14, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#1E40AF' }}>
            ✨ {map.aiNotes}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <AutoFillBar stats={map.stats} />
          {wetInkCount > 0 && (
            <div style={{ fontSize: 11.5, color: '#B91C1C', fontWeight: 600, marginTop: 6 }}>
              ✒️ {wetInkCount} item{wetInkCount > 1 ? 's' : ''} require wet-ink signature — these stay manual.
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Items, grouped by section */}
      {grouped.map((g) => (
        <div key={g.section + g.items[0].id} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{g.section}</div>
          {g.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              taxonomy={taxonomy}
              dragging={dragId === item.id}
              dragTarget={dragOverId === item.id && dragId !== item.id}
              dragHandlers={{
                onDragStart: (e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move' },
                onDragEnd: () => { setDragId(null); setDragOverId(null) },
                onDragOver: (e) => { e.preventDefault(); setDragOverId(item.id) },
                onDrop: (e) => { e.preventDefault(); handleDrop(item) },
              }}
              onUpdate={(data) => patchItem(item.id, data)}
              onDelete={() => removeItem(item.id)}
            />
          ))}
        </div>
      ))}

      {/* Add item */}
      {addOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 10, padding: '10px 14px' }}>
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') setAddOpen(false) }}
            placeholder="Requirement as the facility words it…"
            style={{ flex: 1, fontSize: 13.5, border: 'none', outline: 'none', color: '#0F172A' }}
          />
          <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ fontSize: 12, color: '#64748B', padding: '5px 8px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
            {taxonomy.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <button onClick={addItem} style={{ padding: '7px 14px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)} style={{ width: '100%', padding: '11px 0', background: 'none', border: '1px dashed #CBD5E1', borderRadius: 10, color: '#64748B', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Add requirement
        </button>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CredMapPage() {
  useKalamFont()
  const [maps, setMaps] = useState(null)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [taxonomy, setTaxonomy] = useState([])
  const [notes, setNotes] = useState([])
  const [openMapId, setOpenMapId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const loadMaps = () => credMapAPI.getMaps().then((d) => { setMaps(d.maps); setAiAvailable(d.aiAvailable) }).catch((e) => setError(e.message))
  const loadNotes = () => credMapAPI.getNotes().then((d) => setNotes(d.notes)).catch(() => {})

  useEffect(() => {
    loadMaps(); loadNotes()
    credMapAPI.getTaxonomy().then((d) => setTaxonomy(d.taxonomy)).catch(() => {})
  }, [])

  async function handleAnalyze(files, name) {
    const { map } = await credMapAPI.analyzePacket(files, name)
    await loadMaps()
    setShowNew(false)
    setOpenMapId(map.id)
  }

  async function handleCreate(name, useStarter) {
    const { map } = await credMapAPI.createMap(name, useStarter)
    await loadMaps()
    setShowNew(false)
    setOpenMapId(map.id)
  }

  if (openMapId) {
    return <MapBuilder mapId={openMapId} taxonomy={taxonomy} onBack={() => { setOpenMapId(null); loadMaps() }} onChanged={() => {}} />
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>Cred Maps</h1>
          <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 4 }}>
            Map a facility's credentialing program once — every provider's packet populates from the passport, renewals included.
          </div>
        </div>
        <button onClick={() => setShowNew(true)} style={{ padding: '11px 20px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
          + New Cred Map
        </button>
      </div>

      <div style={{ margin: '20px 0 0' }}>
        <StickyNotesStrip
          notes={notes}
          onAdd={async (text, color) => { await credMapAPI.addNote({ text, color }); loadNotes() }}
          onDone={async (n) => { await credMapAPI.updateNote(n.id, { done: true }); loadNotes() }}
          onDelete={async (n) => { await credMapAPI.deleteNote(n.id); loadNotes() }}
        />
      </div>

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {maps === null ? (
        <div style={{ color: '#94A3B8', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : maps.length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>🗺️</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>No facility maps yet</div>
          <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 6, maxWidth: 440, margin: '6px auto 0' }}>
            Upload a facility's blank credentialing packet and SNAP will map their entire program in about a minute. Map it once — it works for every provider, every renewal.
          </div>
          <button onClick={() => setShowNew(true)} style={{ marginTop: 18, padding: '11px 22px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
            ✨ Map your first facility
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
          {maps.map((m) => (
            <div
              key={m.id}
              onClick={() => setOpenMapId(m.id)}
              style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '18px 20px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', lineHeight: 1.3 }}>{m.name}</div>
                <StatusPill status={m.status} />
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
                {m.stats.itemCount} requirements
                {m.recredCycleMonths ? ` · recred every ${m.recredCycleMonths} mo` : ''}
                {m._count?.packets ? ` · ${m._count.packets} packets` : ''}
              </div>
              <div style={{ marginTop: 14 }}>
                <AutoFillBar stats={m.stats} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewMapModal
          aiAvailable={aiAvailable}
          onClose={() => setShowNew(false)}
          onAnalyze={handleAnalyze}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
