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
  const [checked, setChecked] = useState({}) // taskId -> bool
  const [answers, setAnswers] = useState({}) // questionKey -> value
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null) // { signed, remaining, answersSaved }

  useEffect(() => {
    fetch(`${BASE}/sign/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Failed to load')
        setData(d)
        if (d.providerName) setName(d.providerName)
        // Everything starts checked — uncheck to hold something back.
        setChecked(Object.fromEntries((d.items || []).map((it) => [it.taskId, true])))
        // Pre-fill any answer the provider already gave (incl. attestations
        // answered on another facility's form — the common-app payoff).
        setAnswers(Object.fromEntries((d.questions || []).map((q) => [q.questionKey, q.value || ''])))
      })
      .catch((e) => setError(e.message))
  }, [token])

  const selectedIds = Object.entries(checked).filter(([, v]) => v).map(([k]) => k)
  const questions = data?.questions || []
  const attestations = questions.filter((q) => q.source === 'ATTESTATION')
  const providerFields = questions.filter((q) => q.source === 'PROVIDER')
  const unanswered = attestations.filter((q) => !answers[q.questionKey])
  const hasDocs = (data?.items || []).length > 0
  const setAnswer = (k, v) => setAnswers((a) => ({ ...a, [k]: v }))

  async function submit() {
    if (!name.trim()) { setError('Please type your full legal name.'); return }
    if (!consent) { setError('Please check the agreement box.'); return }
    if (unanswered.length > 0) { setError(`Please answer all ${attestations.length} yes/no questions.`); return }
    if (hasDocs) {
      if (selectedIds.length === 0) { setError('Check at least one document to sign.'); return }
      if (!inked) { setError('Please draw your signature first.'); return }
    }
    setError('')
    setSubmitting(true)
    try {
      const answerList = Object.entries(answers)
        .filter(([, v]) => v !== '' && v != null)
        .map(([questionKey, value]) => ({ questionKey, value }))
      const res = await fetch(`${BASE}/sign/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: name.trim(),
          signatureDataUrl: inked ? canvasDataUrl() : undefined,
          consent: true,
          taskIds: selectedIds,
          answers: answerList,
        }),
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
          {done?.signed || done?.answersSaved
            ? `${[
                done?.signed ? `Your signature was applied to ${done.signed} document${done.signed === 1 ? '' : 's'}` : '',
                done?.answersSaved ? `${done.answersSaved} answer${done.answersSaved === 1 ? '' : 's'} saved` : '',
              ].filter(Boolean).join(' · ')}. Your coordinator has been updated — and your answers are saved, so the next facility's application starts pre-filled.`
            : 'Everything here is already done. Nothing else is needed.'}
        </div>
        {done?.remaining > 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, fontSize: 12.5, color: '#92400E' }}>
            {done.remaining} document{done.remaining === 1 ? '' : 's'} left unsigned — no problem. {done.remaining === 1 ? 'It stays' : 'They stay'} pending and your coordinator can send you a fresh link whenever you're ready.
          </div>
        )}
      </div>
    )
  }

  return shell(
    <div style={{ background: '#fff', borderRadius: 20, padding: '26px 22px', boxShadow: '0 10px 40px rgba(15,23,42,0.08)' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
        {data.facilityName}
      </div>
      <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 }}>
        Hi {data.providerName || 'there'} — confirm your information, answer a few questions, and sign. It takes a minute, and your answers carry over to your next application.
      </div>

      {/* What SNAP already has, verified — read-only. */}
      {(data.review || []).length > 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
            ✓ From your verified SNAP passport
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
            {data.review.map((r) => (
              <div key={r.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: '#64748B' }}>{r.label}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: '#16A34A', marginTop: 8 }}>SNAP fills these automatically — no need to re-enter them.</div>
        </div>
      )}

      {/* The gaps: yes/no attestations + provider-only fields, answered once. */}
      {attestations.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
            A few questions {unanswered.length > 0 && <span style={{ color: '#DC2626' }}>· {unanswered.length} left</span>}
          </div>
          {attestations.map((q) => {
            const v = answers[q.questionKey]
            return (
              <div key={q.questionKey} style={{ padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: '#0F172A', lineHeight: 1.4 }}>{q.label}</div>
                {q.explain && <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>{q.explain}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {['NO', 'YES'].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswer(q.questionKey, opt)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                        border: v === opt ? '1.5px solid #2563EB' : '1.5px solid #E2E8F0',
                        background: v === opt ? (opt === 'YES' ? '#FEF3C7' : '#EFF6FF') : '#fff',
                        color: v === opt ? '#0F172A' : '#64748B',
                      }}
                    >
                      {opt === 'YES' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {providerFields.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {providerFields.map((q) => (
            <div key={q.questionKey} style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 5 }}>{q.label}</label>
              {q.type === 'longtext' ? (
                <textarea
                  value={answers[q.questionKey] || ''}
                  onChange={(e) => setAnswer(q.questionKey, e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
              ) : (
                <input
                  value={answers[q.questionKey] || ''}
                  onChange={(e) => setAnswer(q.questionKey, e.target.value)}
                  type={q.type === 'date' ? 'text' : 'text'}
                  placeholder={q.type === 'date' ? 'MM/DD/YYYY' : ''}
                  style={{ width: '100%', padding: '11px 13px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14.5, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documents to sign, if any. */}
      {hasDocs && (
        <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '14px 0 8px' }}>
          {data.items.length === 1 ? 'Document to sign' : `${data.items.length} documents to sign`}
        </div>
      )}

      {data.items.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={() => setChecked(Object.fromEntries(data.items.map((it) => [it.taskId, selectedIds.length !== data.items.length])))}
            style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
          >
            {selectedIds.length === data.items.length ? 'Uncheck all' : 'Check all'}
          </button>
        </div>
      )}

      {data.items.map((it) => (
        <div key={it.taskId} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: checked[it.taskId] ? '#F8FAFC' : '#fff', border: `1px solid ${checked[it.taskId] ? '#BFDBFE' : '#E2E8F0'}`, borderRadius: 10, marginBottom: 8, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={!!checked[it.taskId]}
            onChange={(e) => setChecked((c) => ({ ...c, [it.taskId]: e.target.checked }))}
            style={{ marginTop: 3, width: 17, height: 17, accentColor: '#2563EB' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: checked[it.taskId] ? '#0F172A' : '#94A3B8' }}>{it.label}</div>
            {it.section && <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{it.section}</div>}
            {it.notes && <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>{it.notes}</div>}
            {data.sourceDoc && (
              <a
                href={`${BASE}/sign/${encodeURIComponent(token)}/document`}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#2563EB', textDecoration: 'none', marginTop: 4 }}
              >
                📄 Review the form ↗
              </a>
            )}
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

      {hasDocs && (
        <div id="sign-pad" style={{ marginTop: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>Signature</label>
          <SignatureCanvas onChange={setInked} />
        </div>
      )}

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{data.consentText}</span>
      </label>

      {error && <div style={{ marginTop: 12, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}

      {(() => {
        const blocked = submitting || unanswered.length > 0 || (hasDocs && selectedIds.length === 0)
        const label = submitting ? 'Submitting…'
          : unanswered.length > 0 ? `Answer ${unanswered.length} more question${unanswered.length === 1 ? '' : 's'}`
          : hasDocs
            ? (selectedIds.length === 0 ? 'Check a document to sign'
              : selectedIds.length === data.items.length
                ? `Submit & sign ${data.items.length === 1 ? 'document' : `all ${data.items.length}`} ✓`
                : `Submit & sign ${selectedIds.length} of ${data.items.length} ✓`)
            : 'Submit my answers ✓'
        return (
          <button
            onClick={submit}
            disabled={blocked}
            style={{ width: '100%', marginTop: 16, padding: '14px 0', background: blocked && !submitting ? '#CBD5E1' : submitting ? '#93C5FD' : '#2563EB', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15.5, fontWeight: 800, cursor: submitting ? 'wait' : blocked ? 'not-allowed' : 'pointer' }}
          >
            {label}
          </button>
        )
      })()}
      <div style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', marginTop: 10 }}>
        {hasDocs ? 'Your signature, the date, and this device are recorded for the credentialing audit trail.'
          : 'Your answers, name, and consent are recorded for the credentialing audit trail.'}
      </div>
    </div>
  )
}
