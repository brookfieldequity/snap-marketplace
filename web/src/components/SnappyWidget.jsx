import React, { useState, useRef, useEffect } from 'react'
import { facilityAPI } from '../api.js'

// Snappy — SNAP's in-app AI support assistant (Task #17). Floating bubble in
// the facility portal. Account-aware (the backend runs tools with the
// authenticated facility's context) and escalates to the SNAP team when it
// can't help. Friendly-professional voice, no emoji in copy.

const GREETING = {
  role: 'assistant',
  content: "Hi, I'm Snappy, your SNAP assistant. Ask me how to do something in the platform, or about your roster, sites, or schedule. If I can't help, I'll flag it for the SNAP team.",
}

export default function SnappyWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [launcherHover, setLauncherHover] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      // Send only the user/assistant turns (skip the local greeting).
      const history = next.filter((m, i) => !(i === 0 && m === GREETING))
      const res = await facilityAPI.snappyChat(history)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply || "I'm not sure how to help with that." }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Sorry, I hit a problem. You can reach the SNAP team at matt@snapmedical.app." }])
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* Launcher — the mascot floating in the corner (no container) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          onMouseEnter={() => setLauncherHover(true)}
          onMouseLeave={() => setLauncherHover(false)}
          style={{ ...styles.launcher, transform: launcherHover ? 'scale(1.06)' : 'scale(1)' }}
          title="Ask Snappy"
          aria-label="Open Snappy assistant"
        >
          <img src="/snappy-mascot.png" alt="Snappy" style={styles.launcherImg} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <img src="/snappy-mascot.png" alt="" style={styles.headerMark} />
              <div>
                <div style={styles.headerTitle}>Snappy</div>
                <div style={styles.headerSub}>SNAP assistant</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={styles.close} aria-label="Close">✕</button>
          </div>

          <div ref={scrollRef} style={styles.body}>
            {messages.map((m, i) => (
              <div key={i} style={{ ...styles.msgRow, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ ...styles.msg, ...(m.role === 'user' ? styles.msgUser : styles.msgBot) }}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div style={{ ...styles.msgRow, justifyContent: 'flex-start' }}>
                <div style={{ ...styles.msg, ...styles.msgBot, color: '#94A3B8' }}>Snappy is thinking…</div>
              </div>
            )}
          </div>

          <div style={styles.inputRow}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Snappy…"
              rows={1}
              style={styles.input}
            />
            <button onClick={send} disabled={sending || !input.trim()} style={{ ...styles.send, opacity: sending || !input.trim() ? 0.5 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const styles = {
  launcher: {
    position: 'fixed', bottom: 24, right: 24, background: 'transparent', border: 'none',
    padding: 0, cursor: 'pointer', zIndex: 900, lineHeight: 0,
    filter: 'drop-shadow(0 6px 14px rgba(15,23,42,0.30))',
    transition: 'transform 0.15s ease',
  },
  launcherImg: { width: 76, height: 'auto', display: 'block' },
  panel: {
    position: 'fixed', bottom: 24, right: 24, width: 380, maxWidth: 'calc(100vw - 32px)',
    height: 560, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 18,
    boxShadow: '0 25px 60px rgba(15,23,42,0.28)', border: '1px solid #E2E8F0',
    zIndex: 900, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: { background: '#2563EB', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerMark: { width: 38, height: 38, objectFit: 'contain', display: 'block' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontFamily: "'Dancing Script', cursive" },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  close: { background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: 4 },
  body: { flex: 1, overflowY: 'auto', padding: '16px 14px', background: '#FAFAFA', display: 'flex', flexDirection: 'column', gap: 10 },
  msgRow: { display: 'flex' },
  msg: { maxWidth: '82%', padding: '10px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  msgUser: { background: '#2563EB', color: '#fff', borderBottomRightRadius: 4 },
  msgBot: { background: '#fff', color: '#0F172A', border: '1px solid #E2E8F0', borderBottomLeftRadius: 4 },
  inputRow: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #F1F5F9', background: '#fff', alignItems: 'flex-end' },
  input: { flex: 1, resize: 'none', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: '#0F172A', outline: 'none', fontFamily: 'inherit', maxHeight: 96 },
  send: { background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
}
