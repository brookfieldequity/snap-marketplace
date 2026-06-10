import React, { useState, useEffect, useCallback } from 'react'
import { facilityAPI } from '../../api.js'

// Coordinator view of provider schedule requests (Task #21). Providers ask
// for a day off or to work a specific date/site; the coordinator accepts or
// declines. Accepted DAY_OFF requests are honored by the schedule builder
// (hard exclude); accepted WORK requests become a strong builder preference.

const TYPE_STYLE = {
  DAY_OFF: { bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5', label: 'Day off' },
  WORK:    { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Wants to work' },
}
const STATUS_STYLE = {
  PENDING:  { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', label: 'Pending' },
  ACCEPTED: { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Accepted' },
  DECLINED: { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1', label: 'Declined' },
}

function fmtDate(d) {
  return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default function RequestsPage() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('PENDING')
  const [busy, setBusy] = useState({})

  const load = useCallback(() => {
    setLoading(true)
    facilityAPI.getScheduleRequests()
      .then((r) => setRequests(r.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(id, decision) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await facilityAPI.decideScheduleRequest(id, decision)
      load()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length
  const visible = requests.filter((r) => (tab === 'ALL' ? true : r.status === tab))

  return (
    <div style={{ padding: '32px 40px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Provider Requests</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Day-off and work requests from your roster. Accepted requests are honored when you build the schedule.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { k: 'PENDING', label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
          { k: 'ACCEPTED', label: 'Accepted' },
          { k: 'DECLINED', label: 'Declined' },
          { k: 'ALL', label: 'All' },
        ].map(({ k, label }) => {
          const active = tab === k
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? '#6366F1' : '#fff',
                color: active ? '#fff' : '#64748B',
                border: `1.5px solid ${active ? '#6366F1' : '#E2E8F0'}`,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '50px 0', color: '#94A3B8' }}>Loading...</div>}

      {!loading && visible.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>✋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>No {tab === 'ALL' ? '' : tab.toLowerCase()} requests</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Requests your providers submit from the SNAP app appear here.</div>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((r) => {
            const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
            const s = STATUS_STYLE[r.status] || STATUS_STYLE.PENDING
            return (
              <div key={r.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
                      <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{t.label}</span>
                      <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{s.label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#374151', marginTop: 6 }}>
                      <strong>{fmtDate(r.date)}</strong>
                      {r.siteName ? <span style={{ color: '#64748B' }}> · {r.siteName}</span> : null}
                      {r.rosterEntry?.providerType ? <span style={{ color: '#94A3B8' }}> · {r.rosterEntry.providerType}</span> : null}
                    </div>
                    {r.note && (
                      <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, fontStyle: 'italic' }}>“{r.note}”</div>
                    )}
                  </div>

                  {r.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => decide(r.id, 'accept')}
                        disabled={busy[r.id]}
                        style={{ padding: '8px 16px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy[r.id] ? 'not-allowed' : 'pointer', opacity: busy[r.id] ? 0.6 : 1 }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => decide(r.id, 'decline')}
                        disabled={busy[r.id]}
                        style={{ padding: '8px 16px', background: '#fff', color: '#B91C1C', border: '1.5px solid #FCA5A5', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy[r.id] ? 'not-allowed' : 'pointer', opacity: busy[r.id] ? 0.6 : 1 }}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
