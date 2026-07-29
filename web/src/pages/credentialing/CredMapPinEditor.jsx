import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { credMapAPI } from '../../api.js'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ── Visual pin editor — click-to-map templates ────────────────────────────────
// The facility's actual PDF on screen, the AI's suggested pins already placed.
// Click any blank → pick the passport value that belongs there → pin lands.
// Drag to nudge, × to remove, Save = the template that fills automatically for
// every provider from then on. Map once, forever.

const PAGE_WIDTH = 860 // rendered page width in CSS px

// Pickable values: the shared vocabulary plus per-entry repeating sections —
// the thing automatic overlay could never do (Education block #2 → the
// provider's actual second school).
const PIN_GROUPS = [
  ['Provider', [
    ['provider.fullName', 'Full name'], ['provider.firstName', 'First name'], ['provider.middleName', 'Middle name'],
    ['provider.lastName', 'Last name'], ['provider.suffix', 'Suffix (Jr., II)'], ['provider.profTitle', 'Prof. title / degree'],
    ['provider.npi', 'NPI'], ['provider.dateOfBirth', 'Date of birth'], ['provider.specialty', 'Specialty'],
    ['provider.email', 'Email'], ['provider.phone', 'Phone'],
  ]],
  ['Home address', [
    ['address.full', 'Full address (one line)'], ['address.street', 'Street'], ['address.city', 'City'],
    ['address.state', 'State'], ['address.zip', 'Zip'],
  ]],
  ['Licenses & credentials', [
    ['cred.STATE_LICENSE.identifier', 'State license #'], ['cred.STATE_LICENSE.expirationDate', 'State license expiry'],
    ['cred.STATE_CS_LICENSE.identifier', 'State CS license #'], ['cred.STATE_CS_LICENSE.expirationDate', 'State CS expiry'],
    ['cred.DEA.identifier', 'DEA #'], ['cred.DEA.expirationDate', 'DEA expiry'],
    ['cred.BOARD_CERTIFICATION.identifier', 'Board cert #'], ['cred.BOARD_CERTIFICATION.expirationDate', 'Board cert expiry'],
    ['cred.MALPRACTICE_INSURANCE.identifier', 'Malpractice policy #'], ['cred.MALPRACTICE_INSURANCE.expirationDate', 'Malpractice expiry'],
    ['malpractice.carrier', 'Malpractice carrier'],
    ['cred.ACLS.expirationDate', 'ACLS expiry'], ['cred.BLS.expirationDate', 'BLS expiry'],
  ]],
  ['Education (per entry)', [1, 2, 3].flatMap((n) => [
    [`edu${n}.institution`, `Education #${n} — institution`],
    [`edu${n}.level`, `Education #${n} — degree/level`],
    [`edu${n}.graduationDate`, `Education #${n} — graduation`],
  ])],
  ['Work history (per entry)', [1, 2, 3].flatMap((n) => [
    [`work${n}.employer`, `Work #${n} — employer`],
    [`work${n}.role`, `Work #${n} — role`],
    [`work${n}.dates`, `Work #${n} — dates`],
  ])],
  ['Other', [['today', "Today's date"]]],
]

const KEY_LABEL = Object.fromEntries(PIN_GROUPS.flatMap(([, opts]) => opts))

export default function CredMapPinEditor({ mapId, mapName, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [pageDims, setPageDims] = useState(null) // { w, h } in PDF points for current page
  const [fills, setFills] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [picker, setPicker] = useState(null) // { cssX, cssY, pdfX, pdfY }
  const [search, setSearch] = useState('')
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const dragRef = useRef(null) // { idx, startCssX, startCssY, origX, origY }
  const renderTaskRef = useRef(null)

  const scale = pageDims ? PAGE_WIDTH / pageDims.w : 1

  // Load plan + source PDF
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await credMapAPI.getFlatPlan(mapId)
        if (!alive) return
        setFills((data.plan.fills || []).map((f) => ({ ...f })))
        const resp = await fetch(credMapAPI.docUrl(data.sourceDocToken))
        if (!resp.ok) throw new Error('Could not load the facility form PDF')
        const buf = await resp.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: buf }).promise
        if (!alive) return
        setPdfDoc(doc)
        setNumPages(doc.numPages)
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load the editor')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [mapId])

  // Render the current page
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    ;(async () => {
      const page = await pdfDoc.getPage(pageNum)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      setPageDims({ w: base.width, h: base.height })
      const s = PAGE_WIDTH / base.width
      const viewport = page.getViewport({ scale: s * (window.devicePixelRatio || 1) })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${PAGE_WIDTH}px`
      canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch { /* stale */ } }
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      renderTaskRef.current = task
      try { await task.promise } catch { /* cancelled */ }
    })()
    return () => { cancelled = true }
  }, [pdfDoc, pageNum])

  // css ↔ pdf coordinate transforms (pdf origin bottom-left; y = text baseline)
  const toPdf = useCallback((cssX, cssY) => ({
    x: cssX / scale,
    y: pageDims ? pageDims.h - cssY / scale - 3 : 0,
  }), [scale, pageDims])
  const toCss = useCallback((f) => ({
    left: f.x * scale,
    top: pageDims ? (pageDims.h - f.y) * scale - 14 : 0,
  }), [scale, pageDims])

  function onPageClick(e) {
    if (dragRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const { x, y } = toPdf(cssX, cssY)
    setSearch('')
    setPicker({ cssX, cssY, pdfX: x, pdfY: y })
  }

  function addPin(valueKey) {
    if (!picker) return
    setFills((f) => [...f, { label: 'pin', valueKey, page: pageNum, x: picker.pdfX, y: picker.pdfY, placement: 'right' }])
    setPicker(null)
    setDirty(true)
  }

  function removePin(idx) {
    setFills((f) => f.filter((_, i) => i !== idx))
    setDirty(true)
  }

  // Pin dragging
  function onPinMouseDown(e, idx) {
    e.stopPropagation()
    e.preventDefault()
    const rect = wrapRef.current.getBoundingClientRect()
    dragRef.current = { idx, startX: e.clientX - rect.left, startY: e.clientY - rect.top, orig: { ...fills[idx] }, moved: false }
    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      if (Math.abs(cx - d.startX) + Math.abs(cy - d.startY) > 2) d.moved = true
      const dx = (cx - d.startX) / scale
      const dy = -(cy - d.startY) / scale
      setFills((f) => f.map((fill, i) => (i === d.idx ? { ...fill, x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy) } : fill)))
    }
    const onUp = () => {
      if (dragRef.current?.moved) setDirty(true)
      // Delay clearing so the page click handler sees the drag and skips.
      setTimeout(() => { dragRef.current = null }, 0)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await credMapAPI.saveFlatPlan(mapId, fills)
      setDirty(false)
      onSaved?.(res.saved)
    } catch (e) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  async function aiPreMap() {
    if (fills.length > 0 && !window.confirm('Replace the current pins with a fresh AI pre-mapping? Your manual pins will be lost.')) return
    setDetecting(true)
    setError('')
    try {
      const res = await credMapAPI.detectFlatPlan(mapId)
      setFills((res.plan.fills || []).map((f) => ({ ...f })))
      setDirty(true)
    } catch (e) { setError(e.message || 'AI pre-mapping failed') }
    finally { setDetecting(false) }
  }

  const pagePins = fills.map((f, idx) => ({ f, idx })).filter(({ f }) => f.page === pageNum)
  const pinCountByPage = useMemo(() => {
    const m = {}
    for (const f of fills) m[f.page] = (m[f.page] || 0) + 1
    return m
  }, [fills])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return PIN_GROUPS
    return PIN_GROUPS
      .map(([g, opts]) => [g, opts.filter(([, lbl]) => lbl.toLowerCase().includes(q) || g.toLowerCase().includes(q))])
      .filter(([, opts]) => opts.length > 0)
  }, [search])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 600, display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ background: '#0F172A', color: '#fff', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>🎯 Map this form — {mapName}</div>
        <div style={{ fontSize: 12, color: '#94A3B8' }}>Click any blank to pin a passport value there. Drag pins to nudge. Saved pins fill automatically for every provider.</div>
        <div style={{ flex: 1 }} />
        <button onClick={aiPreMap} disabled={detecting || loading} style={{ padding: '7px 14px', background: '#7C3AED', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
          {detecting ? 'AI mapping… (~30-60s)' : '✨ AI pre-map'}
        </button>
        <button onClick={save} disabled={saving || !dirty} style={{ padding: '7px 16px', background: dirty ? '#16A34A' : '#334155', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: dirty ? 'pointer' : 'default' }}>
          {saving ? 'Saving…' : dirty ? `💾 Save template (${fills.length} pins)` : `Saved ✓ (${fills.length} pins)`}
        </button>
        <button onClick={() => { if (!dirty || window.confirm('Close without saving your pin changes?')) onClose() }} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      {/* Page nav */}
      <div style={{ background: '#1E293B', color: '#CBD5E1', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1} style={navStyle}>‹ Prev</button>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Page {pageNum} / {numPages}</span>
        <button onClick={() => setPageNum((p) => Math.min(numPages, p + 1))} disabled={pageNum >= numPages} style={navStyle}>Next ›</button>
        <span style={{ fontSize: 11.5, color: '#64748B' }}>
          {pagePins.length} pin{pagePins.length === 1 ? '' : 's'} on this page
          {Object.keys(pinCountByPage).length > 0 && ` · pages with pins: ${Object.keys(pinCountByPage).sort((a, b) => a - b).join(', ')}`}
        </span>
        {error && <span style={{ color: '#FCA5A5', fontSize: 12, fontWeight: 700 }}>{error}</span>}
      </div>

      {/* Document */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 24 }} onClick={() => setPicker(null)}>
        {loading ? (
          <div style={{ color: '#CBD5E1', paddingTop: 60, fontSize: 14 }}>Loading the facility form…</div>
        ) : (
          <div
            ref={wrapRef}
            onClick={(e) => { e.stopPropagation(); onPageClick(e) }}
            style={{ position: 'relative', width: PAGE_WIDTH, height: pageDims ? pageDims.h * scale : 'auto', flexShrink: 0, cursor: 'crosshair', background: '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.4)', borderRadius: 4, alignSelf: 'flex-start' }}
          >
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4 }} />
            {/* Pins */}
            {pagePins.map(({ f, idx }) => (
              <div
                key={idx}
                onMouseDown={(e) => onPinMouseDown(e, idx)}
                onClick={(e) => e.stopPropagation()}
                title={`${KEY_LABEL[f.valueKey] || f.valueKey}${f.label && f.label !== 'pin' ? ` · near "${f.label.slice(0, 40)}"` : ''} — drag to move`}
                style={{
                  position: 'absolute', left: toCss(f).left, top: toCss(f).top,
                  background: 'rgba(37,99,235,0.92)', color: '#fff', borderRadius: 5,
                  padding: '1px 6px 1px 7px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                  cursor: 'grab', display: 'flex', alignItems: 'center', gap: 5,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)', userSelect: 'none', zIndex: 2,
                }}
              >
                {KEY_LABEL[f.valueKey] || f.valueKey}
                <span
                  onClick={(e) => { e.stopPropagation(); removePin(idx) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ cursor: 'pointer', opacity: 0.75, fontWeight: 800 }}
                >×</span>
              </div>
            ))}
            {/* Picker popover */}
            {picker && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: Math.min(picker.cssX, PAGE_WIDTH - 280),
                  top: Math.min(picker.cssY + 8, (pageDims ? pageDims.h * scale : 800) - 340),
                  width: 270, maxHeight: 330, background: '#fff', borderRadius: 12,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.35)', border: '1px solid #E2E8F0',
                  display: 'flex', flexDirection: 'column', zIndex: 5, cursor: 'default',
                }}
              >
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="What goes in this blank?"
                  style={{ margin: 10, padding: '8px 11px', border: '1.5px solid #C7D2FE', borderRadius: 8, fontSize: 12.5, outline: 'none' }}
                />
                <div style={{ overflowY: 'auto', padding: '0 6px 8px' }}>
                  {filteredGroups.map(([group, opts]) => (
                    <div key={group}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '7px 8px 3px' }}>{group}</div>
                      {opts.map(([key, lbl]) => (
                        <div
                          key={key}
                          onClick={() => addPin(key)}
                          style={{ padding: '6px 10px', fontSize: 12.5, color: '#0F172A', borderRadius: 7, cursor: 'pointer' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#EEF2FF' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >{lbl}</div>
                      ))}
                    </div>
                  ))}
                  {filteredGroups.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#94A3B8' }}>No matching field.</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const navStyle = { padding: '5px 12px', background: '#334155', border: 'none', borderRadius: 7, color: '#E2E8F0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
