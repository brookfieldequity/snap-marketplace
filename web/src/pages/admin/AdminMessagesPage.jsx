import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const FLAG_REASON_COLORS = {
  'Off-platform contact solicitation': { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E' },
  'Circumvention attempt':             { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B' },
  'Circumvention — recurring contract solicitation': { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B' },
}

// Map the real /admin/messages/flagged row (sender is always a provider; no
// flagReason/senderType/flagCount in the data) to what this card renders.
function normalizeMessage(m) {
  const s = m.sender
  return {
    id: m.id,
    senderName: (s ? `${s.firstName || ''} ${s.lastName || ''}`.trim() : '') || 'Provider',
    senderType: 'PROVIDER',
    facilityName: m.facility?.name || '—',
    message: m.body || '',
    date: m.createdAt ? String(m.createdAt).slice(0, 10) : '',
    time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
    flagReason: null,
  }
}

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [dismissed, setDismissed] = useState(new Set())

  useEffect(() => {
    adminAPI.getFlaggedMessages()
      .then((rows) => setMessages((rows || []).map(normalizeMessage)))
      .catch(() => setMessages([])) // empty state, never fake messages
      .finally(() => setLoading(false))
  }, [])

  const visible = messages.filter((m) => !dismissed.has(m.id))

  function dismiss(id) {
    setDismissed((prev) => new Set([...prev, id]))
  }

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          Flagged Messages
          {visible.length > 0 && (
            <span style={{ marginLeft: 12, background: '#FEF2F2', color: '#DC2626', fontSize: 14, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid #FCA5A5' }}>
              {visible.length} flagged
            </span>
          )}
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Messages flagged by the platform's circumvention detection system
        </p>
      </div>

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading messages...</div>}

      {!loading && visible.length === 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#15803D', marginBottom: 4 }}>No flagged messages</div>
          <div style={{ fontSize: 14, color: '#16A34A' }}>All communications look good.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {visible.map((msg) => {
          const cfg = FLAG_REASON_COLORS[msg.flagReason] || { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E' }
          const isProvider = msg.senderType === 'PROVIDER'

          return (
            <div
              key={msg.id}
              style={{
                background: '#fff',
                border: '1px solid #E2E8F0',
                borderLeft: '4px solid #EF4444',
                borderRadius: 16,
                padding: '24px 28px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: isProvider ? 'linear-gradient(135deg, #1E3A8A, #2563EB)' : 'linear-gradient(135deg, #0F172A, #334155)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {msg.senderName.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
                        {msg.senderName}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>
                        <span
                          style={{
                            background: isProvider ? '#F3E8FF' : '#F8FAFC',
                            color: isProvider ? '#1E3A8A' : '#475569',
                            border: `1px solid ${isProvider ? '#DDD6FE' : '#E2E8F0'}`,
                            borderRadius: 4,
                            padding: '1px 6px',
                            fontSize: 10,
                            fontWeight: 700,
                            marginRight: 6,
                          }}
                        >
                          {msg.senderType}
                        </span>
                        {msg.facilityName} · {msg.date} at {msg.time}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {msg.flagCount > 1 && (
                    <span
                      style={{
                        background: '#FEF2F2',
                        color: '#DC2626',
                        border: '1px solid #FCA5A5',
                        borderRadius: 20,
                        padding: '3px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      🚩 Flagged {msg.flagCount}×
                    </span>
                  )}
                  <button
                    onClick={() => dismiss(msg.id)}
                    style={{
                      padding: '6px 14px',
                      background: '#fff',
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#64748B',
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                  <button
                    style={{
                      padding: '6px 14px',
                      background: '#EF4444',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Warn User
                  </button>
                </div>
              </div>

              {/* Flag reason — only when the platform recorded one */}
              {msg.flagReason && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: cfg.bg,
                    border: `1px solid ${cfg.border}`,
                    borderRadius: 8,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: cfg.text,
                    marginBottom: 14,
                  }}
                >
                  🚩 {msg.flagReason}
                </div>
              )}

              {/* Message body */}
              <div
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 10,
                  padding: '16px 18px',
                  fontSize: 14,
                  color: '#374151',
                  lineHeight: 1.65,
                  fontStyle: 'italic',
                  position: 'relative',
                }}
              >
                <span style={{ color: '#CBD5E1', fontSize: 24, position: 'absolute', top: 10, left: 14 }}>"</span>
                <span style={{ marginLeft: 16 }}>{msg.message}</span>
                <span style={{ color: '#CBD5E1', fontSize: 24 }}>"</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
