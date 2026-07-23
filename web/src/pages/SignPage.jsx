import React, { useEffect, useRef, useState } from 'react'

// Provider e-sign page — public, token-gated (/sign/:token). The RFX bar:
// link opens → read what needs signing → tap Sign → draw on the pad → done.
// No login, no app, mobile-first. One link clears every open signature item.

const BASE = import.meta.env.VITE_API_URL || 'https://api.snapmedical.app/api'

function SignatureCanvas({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const scale = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * scale
    canvas.height = rect.height * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1e293b'
  }, [])

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasInk.current) { hasInk.current = true }
    onChange(true)
  }

  function end() { drawing.current = false }

  function clear() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false
    onChange(false)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ width: '100%', height: 160, background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 12, touchAction: 'none', display: 'block' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 12, color: '#94A3B8' }}>Sign above with your finger</span>
        <button onClick={clear} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Clear</button>
      </div>
    </div>
  )
}

// Exposed so the page can grab the PNG at submit time without lifting canvas
// state — the canvas node is queried directly.
function canvasDataUrl() {
  const canvas = document.querySelector('#sign-pad canvas')
  return canvas ? canvas.toDataURL('image/png') : null
}

export default function SignPage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [inked, setInked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null) // { signed }

  useEffect(() => {
    fetch(`${BASE}/sign/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Failed to load')
        setData(d)
        if (d.providerName) setName(d.providerName)
      })
      .catch((e) => setError(e.message))
  }, [token])

  async function submit() {
    if (!inked) { setError('Please draw your signature first.'); return }
    if (!consent) { setError('Please check the agreement box.'); return }
    if (!name.trim()) { setError('Please type your full legal name.'); return }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE}/sign/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: name.trim(), signatureDataUrl: canvasDataUrl(), consent: true }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Signing failed')
      setDone(d)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)', padding: '28px 16px 48px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.05em' }}>SNAP</span>
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 600, marginLeft: 8 }}>Credentialing</span>
        </div>
        {children}
      </div>
    </div>
  )

  if (error && !data) {
    return shell(
      <div style={{ background: '#fff', borderRadius: 20, padding: '32px 24px', boxShadow: '0 10px 40px rgba(15,23,42,0.08)', textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>⏳</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>Link problem</div>
        <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 8 }}>{error}</div>
      </div>
    )
  }

  if (!data) {
    return shell(<div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 14, paddingTop: 40 }}>Loading…</div>)
  }

  if (done || data.alreadyComplete) {
    return shell(
      <div style={{ background: '#fff', borderRadius: 20, padding: '40px 24px', boxShadow: '0 10px 40px rgba(15,23,42,0.08)', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 999, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 30 }}>✓</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: '#0F172A', marginTop: 14 }}>Complete</div>
        <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 8 }}>
          {done?.signed
            ? `Your signature was applied to ${done.signed} document${done.signed === 1 ? '' : 's'}. Your credentialing coordinator has been updated — nothing else is needed.`
            : 'Everything here is already signed. Nothing else is needed.'}
        </div>
      </div>
    )
  }

  return shell(
    <div style={{ background: '#fff', borderRadius: 20, padding: '26px 22px', boxShadow: '0 10px 40px rgba(15,23,42,0.08)' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
        {data.facilityName} needs your signature
      </div>
      <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 }}>
        Hi {data.providerName || 'there'} — review the {data.items.length === 1 ? 'document' : `${data.items.length} documents`} below, then sign once at the bottom.
      </div>

      {data.items.map((it, i) => (
        <div key={it.taskId} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#2563EB' }}>{i + 1}.</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>{it.label}</div>
            {it.section && <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{it.section}</div>}
            {it.notes && <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>{it.notes}</div>}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 18 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>Full legal name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name as it should appear"
          style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 15, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
        />
      </div>

      <div id="sign-pad" style={{ marginTop: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>Signature</label>
        <SignatureCanvas onChange={setInked} />
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{data.consentText}</span>
      </label>

      {error && <div style={{ marginTop: 12, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}

      <button
        onClick={submit}
        disabled={submitting}
        style={{ width: '100%', marginTop: 16, padding: '14px 0', background: submitting ? '#93C5FD' : '#2563EB', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15.5, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}
      >
        {submitting ? 'Applying signature…' : `Sign ${data.items.length === 1 ? 'document' : `all ${data.items.length} documents`} ✓`}
      </button>
      <div style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', marginTop: 10 }}>
        Your signature, the date, and this device are recorded for the credentialing audit trail.
      </div>
    </div>
  )
}
