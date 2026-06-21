import React, { useState, useEffect, useCallback } from 'react'
import { payrollAPI } from '../../api.js'

const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const ghostBtn = { padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const inputStyle = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A' }
const th = { textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#64748B', borderBottom: '1px solid #E2E8F0' }
const thL = { ...th, textAlign: 'left' }
const td = { padding: '7px 10px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9', textAlign: 'right' }
const tdL = { ...td, textAlign: 'left' }

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
function defaultPeriod() {
  const today = new Date()
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 1) % 7))
  const start = new Date(end); start.setDate(end.getDate() - 13)
  return { start: fmtDate(start), end: fmtDate(end) }
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ ...card, padding: '14px 18px', flex: '1 1 150px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || '#0F172A', marginTop: 4 }}>{value}</div>
    </div>
  )
}

export default function AgencyMetricsPage({ onNavigate }) {
  const [period, setPeriod] = useState(defaultPeriod())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    if (!period.start || !period.end) return
    setLoading(true); setError('')
    try { setData(await payrollAPI.getAgencyMetrics({ periodStart: period.start, periodEnd: period.end })) }
    catch (err) { setError(err.message || 'Failed to load'); setData(null) }
    finally { setLoading(false) }
  }, [period.start, period.end])
  useEffect(() => { load() }, [load])

  const t = data?.totals
  const providers = data?.providers || []

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 4px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>📈 Profitability</h1>
      <p style={{ fontSize: 14, color: '#64748B', marginTop: 6, marginBottom: 20 }}>
        Per-provider margin (what the facility pays you, all-in, vs. what you pay the provider), the separate
        off-site bonus bucket, and SNAP's payroll total to reconcile against Gusto.
      </p>

      <div style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
          Period start
          <input style={inputStyle} type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#475569' }}>
          Period end
          <input style={inputStyle} type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
        </label>
        <button style={ghostBtn} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {error && <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#B91C1C', marginBottom: 18 }}>{error}</div>}

      {t && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="CAPA all-in (revenue)" value={fmtMoney(t.capaAllIn)} />
            <Stat label="Payroll cost" value={fmtMoney(t.payrollCost)} />
            <Stat label="Margin" value={fmtMoney(t.capaMargin)} accent="#059669" />
            <Stat label="Margin %" value={(t.marginPct ?? 0) + '%'} accent="#059669" />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Stat label="Off-site bonus (separate)" value={fmtMoney(t.apneSiteBonus)} accent="#B45309" />
            <Stat label="Reimbursement (billed)" value={fmtMoney(t.reimbursement)} />
            <Stat label="SNAP payroll total (vs Gusto)" value={fmtMoney(t.apnePayout)} accent="#2563EB" />
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 18 }}>
            Reconciliation: <strong>{fmtMoney(data.reconciliation?.snapPayrollTotal)}</strong> should match your Gusto run total.
            A mismatch means a roster-card pay rate or a Gusto rate changed — fix the card so they agree.
          </div>
        </>
      )}

      {loading && <div style={{ color: '#64748B', fontSize: 14 }}>Loading…</div>}
      {!loading && data && providers.length === 0 && (
        <div style={{ ...card, color: '#64748B', textAlign: 'center' }}>No agency hours in this period. Import a payroll sheet on Provider Hours first.</div>
      )}

      {!loading && providers.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thL}>Provider</th>
                <th style={th}>Hours</th>
                <th style={th}>Pay rate</th>
                <th style={th}>Payroll</th>
                <th style={th}>CAPA all-in</th>
                <th style={th}>Margin</th>
                <th style={th}>Off-site bonus</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.rosterEntryId}>
                  <td style={tdL}>{p.name}{p.missingRate && <span style={{ color: '#DC2626', fontWeight: 700 }} title="No pay rate on the roster card"> ⚠️</span>}</td>
                  <td style={td}>{p.hours}</td>
                  <td style={td}>{p.payRate != null ? fmtMoney(p.payRate) : '—'}</td>
                  <td style={td}>{fmtMoney(p.payrollCost)}</td>
                  <td style={td}>{fmtMoney(p.capaAllIn)}</td>
                  <td style={{ ...td, fontWeight: 700, color: p.capaMargin >= 0 ? '#059669' : '#DC2626' }}>{fmtMoney(p.capaMargin)}</td>
                  <td style={{ ...td, color: '#B45309' }}>{p.apneSiteBonus ? fmtMoney(p.apneSiteBonus) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F8FAFC' }}>
                <td style={{ ...tdL, fontWeight: 800, borderBottom: 'none' }}>Total</td>
                <td style={{ ...td, fontWeight: 800, borderBottom: 'none' }}>{t.hours}</td>
                <td style={{ ...td, borderBottom: 'none' }}></td>
                <td style={{ ...td, fontWeight: 800, borderBottom: 'none' }}>{fmtMoney(t.payrollCost)}</td>
                <td style={{ ...td, fontWeight: 800, borderBottom: 'none' }}>{fmtMoney(t.capaAllIn)}</td>
                <td style={{ ...td, fontWeight: 800, color: '#059669', borderBottom: 'none' }}>{fmtMoney(t.capaMargin)}</td>
                <td style={{ ...td, fontWeight: 800, color: '#B45309', borderBottom: 'none' }}>{fmtMoney(t.apneSiteBonus)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
