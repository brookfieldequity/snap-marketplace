import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

export default function AdminDemoPage() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [demoUrl, setDemoUrl] = useState(null)

  useEffect(() => { loadStatus() }, [])

  async function loadStatus() {
    try {
      const data = await adminAPI.getDemoStatus()
      setStatus(data)
    } catch {
      setStatus({ seeded: false })
    }
  }

  async function seed() {
    setLoading(true)
    setMsg(null)
    setDemoUrl(null)
    try {
      const data = await adminAPI.seedDemo()
      setMsg({ type: 'ok', text: `Seeded. StaffIQ score ${data.staffiqScore}, projected $${data.projectedMonthlySavings?.toLocaleString()}/mo saved. ${data.schedulingRecords} scheduling records.` })
      await loadStatus()
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Seed failed' })
    } finally {
      setLoading(false)
    }
  }

  async function launch(mode) {
    setLoading(true)
    setMsg(null)
    try {
      const data = await adminAPI.launchDemo()
      if (mode === 'tab') {
        // Stash admin token so the demo banner can restore it on exit
        const adminTok = localStorage.getItem('snapAdminToken')
        if (adminTok) sessionStorage.setItem('snapAdminTokenBackup', adminTok)
        localStorage.setItem('snapFacilityToken', data.token)
        localStorage.removeItem('snapAdminToken')
        window.location.href = '/'
      } else {
        setDemoUrl(data.url)
        await navigator.clipboard.writeText(data.url)
        setMsg({ type: 'ok', text: 'Demo link copied to clipboard (valid 24 hours).' })
      }
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Launch failed' })
    } finally {
      setLoading(false)
    }
  }

  const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 28, marginBottom: 24 }
  const btnPrimary = {
    background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  }
  const btnDanger = {
    background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  }
  const btnGold = {
    background: '#FDE68A', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div style={{ padding: 32, maxWidth: 720 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Demo Mode</h1>
      <p style={{ fontSize: 14, color: '#64748B', marginBottom: 32 }}>
        Seed a polished 10-minute sales demo — Maple Ridge ASC with real StaffIQ numbers,
        live marketplace shifts, a credentialed provider, and a gap-to-fill story.
        Reset between demos any time.
      </p>

      {/* Status card */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
          Demo Status
        </div>
        {status === null ? (
          <div style={{ color: '#94A3B8' }}>Loading...</div>
        ) : status.seeded ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#D1FAE5', color: '#065F46', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>SEEDED</span>
              <span style={{ fontSize: 14, color: '#475569' }}>Maple Ridge ASC</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
              {[
                { label: 'StaffIQ Score', val: status.staffiqScore },
                { label: 'Proj. Savings/mo', val: status.projectedMonthlySavings ? `$${status.projectedMonthlySavings.toLocaleString()}` : '—' },
                { label: 'Marketplace Shifts', val: status.shifts },
                { label: 'Scheduling Records', val: status.schedulingRecords },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{val ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: '#94A3B8', fontSize: 14 }}>Not seeded yet.</div>
        )}
      </div>

      {/* Actions */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
          Actions
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button style={status?.seeded ? btnDanger : btnPrimary} onClick={seed} disabled={loading}>
            {loading ? 'Working...' : status?.seeded ? 'Reset Demo' : 'Seed Demo'}
          </button>

          {status?.seeded && (
            <>
              <button style={btnGold} onClick={() => launch('tab')} disabled={loading}>
                Launch Demo (this tab)
              </button>
              <button style={{ ...btnGold, background: '#fff', border: '1px solid #F59E0B', color: '#92400E' }} onClick={() => launch('link')} disabled={loading}>
                Copy Demo Link
              </button>
            </>
          )}
        </div>

        {msg && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: msg.type === 'ok' ? '#F0FDF4' : '#FEF2F2',
            color: msg.type === 'ok' ? '#166534' : '#DC2626',
            border: `1px solid ${msg.type === 'ok' ? '#BBF7D0' : '#FCA5A5'}`,
          }}>
            {msg.text}
          </div>
        )}

        {demoUrl && (
          <div style={{ marginTop: 12, background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#475569', wordBreak: 'break-all' }}>
            {demoUrl}
          </div>
        )}
      </div>

      {/* Demo script */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
          10-Minute Demo Script
        </div>
        {[
          ['01', 'Open StaffIQ dashboard', 'Show the "$X/month" savings hero — projected from their current team model. That\'s what\'s on the table immediately.'],
          ['02', 'Explain the score', '"Score 87 vs. network median 88 — you\'re right at average but this 1:2 model is the reason." Point at the efficiency lever dollar breakdown.'],
          ['03', 'Show the gap story', 'Go to the internal shifts tab — one ESCALATED shift that went internal → no takers → SNAP marketplace filled it in 4 hours.'],
          ['04', 'Show the filled provider', 'Click the filled CRNA — Sarah Chen, credentialed, 4.9 stars, GOLD tier. No scrambling, no agency.'],
          ['05', 'Show live shifts', '3 open shifts right now, below agency rate. "This is your fallback runway — always there when the schedule breaks."'],
          ['06', 'Close the loop', '"How many agency shifts did you run last month?" → plug their number → show the dollar difference. That\'s their custom savings.'],
        ].map(([n, title, detail]) => (
          <div key={n} style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div style={{ minWidth: 28, height: 28, background: '#EFF6FF', borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#2563EB' }}>
              {n}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A', marginBottom: 3 }}>{title}</div>
              <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>{detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
