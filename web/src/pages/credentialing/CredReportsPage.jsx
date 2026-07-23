import React, { useEffect, useMemo, useState } from 'react'
import { credentialAPI } from '../../api.js'

// Reports — pick the specific providers a facility credentials (usually a
// handful), pick the columns you need, export one spreadsheet. The
// credentialer's hand-built roster sheet, generated and always current.

function download(base64, mime, filename) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([arr], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function CredReportsPage() {
  const [roster, setRoster] = useState([])
  const [fields, setFields] = useState([])
  const [pickedNpis, setPickedNpis] = useState(new Set())
  const [pickedFields, setPickedFields] = useState(new Set())
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('xlsx')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    credentialAPI.getPortalRoster().then((d) => setRoster((d.roster || []).filter((r) => r.npi))).catch(() => {})
    credentialAPI.getReportFields().then((d) => {
      setFields(d.fields || [])
      // Sensible defaults so a first export isn't empty.
      setPickedFields(new Set(['name', 'npi', 'stateLicense', 'stateLicenseExp', 'dea', 'deaExp']))
    }).catch(() => {})
  }, [])

  const filtered = useMemo(() =>
    roster.filter((r) => !query.trim() || (r.providerName || '').toLowerCase().includes(query.trim().toLowerCase())),
  [roster, query])

  const toggle = (set, setter, key) => {
    const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); setter(next)
  }

  async function generate() {
    setBusy(true); setError('')
    try {
      const res = await credentialAPI.buildReport([...pickedNpis], [...pickedFields].filter((k) => fields.some((f) => f.key === k)), format)
      download(res.base64, res.mime, res.filename)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  // Keep chosen columns in catalog order.
  const orderedPickedFields = fields.filter((f) => pickedFields.has(f.key))

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>Reports</h1>
      <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 4, marginBottom: 22 }}>
        Pick the providers and the columns you need — SNAP compiles one always-current spreadsheet you can send to any facility.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        {/* Providers */}
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>1 · Pick providers <span style={{ color: '#94A3B8', fontWeight: 600 }}>({pickedNpis.size})</span></div>
            <button onClick={() => setPickedNpis(pickedNpis.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.npi)))} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              {pickedNpis.size === filtered.length && filtered.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search providers…" style={{ width: '100%', padding: '8px 11px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none', marginBottom: 8 }} />
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {filtered.length === 0 ? <div style={{ fontSize: 13, color: '#94A3B8', padding: 12 }}>No providers.</div> : filtered.map((r) => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', cursor: 'pointer', borderTop: '1px solid #F8FAFC' }}>
                <input type="checkbox" checked={pickedNpis.has(r.npi)} onChange={() => toggle(pickedNpis, setPickedNpis, r.npi)} style={{ width: 16, height: 16, accentColor: '#2563EB' }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A' }}>{r.providerName}</span>
                <span style={{ fontSize: 11.5, color: '#94A3B8', fontFamily: 'monospace' }}>{r.providerType || ''}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Columns */}
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>2 · Pick columns <span style={{ color: '#94A3B8', fontWeight: 600 }}>({pickedFields.size})</span></div>
          <div style={{ maxHeight: 388, overflowY: 'auto' }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={pickedFields.has(f.key)} onChange={() => toggle(pickedFields, setPickedFields, f.key)} style={{ width: 16, height: 16, accentColor: '#2563EB' }} />
                <span style={{ fontSize: 13, color: '#334155' }}>{f.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: '#64748B' }}>
          {pickedNpis.size} provider{pickedNpis.size === 1 ? '' : 's'} × {orderedPickedFields.length} column{orderedPickedFields.length === 1 ? '' : 's'}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          {[['xlsx', 'Excel'], ['csv', 'CSV']].map(([k, label]) => (
            <button key={k} onClick={() => setFormat(k)} style={{ padding: '8px 16px', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer', background: format === k ? '#2563EB' : '#fff', color: format === k ? '#fff' : '#64748B' }}>{label}</button>
          ))}
        </div>
        <button onClick={generate} disabled={busy || pickedNpis.size === 0 || pickedFields.size === 0} style={{ padding: '11px 24px', background: (busy || !pickedNpis.size || !pickedFields.size) ? '#CBD5E1' : '#16A34A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 800, cursor: (busy || !pickedNpis.size || !pickedFields.size) ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Building…' : '⬇ Export report'}
        </button>
      </div>
      {error && <div style={{ marginTop: 12, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}
    </div>
  )
}
