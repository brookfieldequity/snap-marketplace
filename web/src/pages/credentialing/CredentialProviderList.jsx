import React, { useEffect, useState, useCallback } from 'react'
import { credentialAPI } from '../../api.js'

// Phase 3 (one source of truth): this list is a ZERO-STORAGE view. The roster
// is the marketplace's one roster (InternalRosterEntry — same list Shifts
// uses); credential status comes live from the passport backend in a single
// batch call. Nothing credential-shaped is stored marketplace-side.

const TYPE_LABELS = { ANESTHESIOLOGIST: 'Anesthesiologist', CRNA: 'CRNA', ANESTHESIA_ASSISTANT: 'Anesthesia Assistant' }
const REQUIRED_TYPES = 6 // STATE_LICENSE, DEA, BOARD_CERT, MALPRACTICE, ACLS, BLS

function passportRollup(row) {
  // → { state, color, label, completionPct, nextExpiration }
  const p = row.passport
  if (!row.npi) return { state: 'NO_NPI', color: '#94A3B8', label: 'No NPI on file' }
  if (!p) return { state: 'UNKNOWN', color: '#94A3B8', label: 'Passport unavailable' }
  if (!p.exists) {
    return row.credentialingStatus === 'INVITED'
      ? { state: 'INVITED', color: '#F59E0B', label: 'Invitation sent' }
      : { state: 'NOT_INVITED', color: '#94A3B8', label: 'Not invited' }
  }
  if (!p.hasGrant) return { state: 'NO_GRANT', color: '#F59E0B', label: 'Access not granted' }

  const missing = p.completeness?.missingRequired?.length ?? REQUIRED_TYPES
  const expSoon = p.completeness?.expiringSoon?.length ?? 0
  const anyExpired = (p.credentials || []).some((c) => c.status === 'EXPIRED')
  const dates = (p.credentials || []).map((c) => c.expirationDate).filter(Boolean).map((d) => new Date(d))
  const nextExpiration = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null
  const completionPct = Math.round(((REQUIRED_TYPES - Math.min(missing, REQUIRED_TYPES)) / REQUIRED_TYPES) * 100)

  if (anyExpired) return { state: 'GRANTED', color: '#EF4444', label: 'Expired items', completionPct, nextExpiration }
  if (expSoon > 0) return { state: 'GRANTED', color: '#F59E0B', label: `${expSoon} expiring soon`, completionPct, nextExpiration }
  if (missing > 0) return { state: 'GRANTED', color: '#F59E0B', label: `${missing} missing`, completionPct, nextExpiration }
  return { state: 'GRANTED', color: '#10B981', label: 'Complete', completionPct, nextExpiration }
}

function Badge({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: `${color}18`, color, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function CompletionBar({ pct }) {
  const color = pct === 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

export default function CredentialProviderList({ onNavigate, permission, filterExpiring }) {
  const [rows, setRows] = useState([])
  const [bridgeDown, setBridgeDown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [inviting, setInviting] = useState({}) // rosterId → true
  const [notice, setNotice] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    credentialAPI.getPortalRoster()
      .then((data) => { setRows(data.roster || []); setBridgeDown(!!data.bridgeUnconfigured) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  async function handleInvite(e, row) {
    e.stopPropagation()
    setInviting((m) => ({ ...m, [row.id]: true }))
    try {
      const r = await credentialAPI.invitePortalRoster(row.id)
      setNotice(r.ok
        ? `Invite sent to ${row.providerName}${r.delivered?.length ? ` via ${r.delivered.join(' + ')}` : ''}.`
        : `Could not invite ${row.providerName}: ${r.reason || 'unknown error'}`)
      load()
    } catch (err) {
      setNotice(`Invite failed: ${err.message}`)
    } finally {
      setInviting((m) => ({ ...m, [row.id]: false }))
    }
  }

  const enriched = rows.map((r) => ({ ...r, rollup: passportRollup(r) }))
  const filtered = enriched.filter((r) => {
    if (search && !(`${r.providerName} ${r.npi || ''}`.toLowerCase().includes(search.toLowerCase()))) return false
    if (filterExpiring) {
      const hasIssue = r.rollup.color === '#EF4444' || (r.rollup.label || '').includes('expiring')
      if (!hasIssue) return false
    }
    return true
  })

  // Billing view — name + NPI only
  if (permission === 'BILLING') {
    return (
      <div style={{ padding: '32px 40px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginBottom: 24 }}>Providers</h1>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC' }}>
              <tr>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Provider Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>NPI Number</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{p.providerName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B', fontFamily: 'monospace' }}>{p.npi || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>{filterExpiring ? 'Needs Attention' : 'Providers'}</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            {filtered.length} provider{filtered.length !== 1 ? 's' : ''} · live from your roster + each provider's credentialing passport
          </p>
        </div>
      </div>

      {bridgeDown && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400E', marginBottom: 14 }}>
          Passport connection isn't configured — roster shown without credential status.
        </div>
      )}
      {notice && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1E40AF', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontWeight: 700 }}>✕</button>
        </div>
      )}

      <input
        style={{ padding: '9px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, background: '#fff', width: 260, marginBottom: 16 }}
        placeholder="Search name or NPI…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading roster + passports…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            {rows.length === 0 ? 'No clinical providers on the roster yet — add them in the facility portal’s Internal Roster.' : 'No providers match.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <tr>
                {['Provider', 'Type', 'Passport Status', 'Completeness', 'Next Expiration', ''].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const r = p.rollup
                const clickable = r.state === 'GRANTED'
                return (
                  <tr
                    key={p.id}
                    onClick={() => clickable && onNavigate(`pfile:${p.id}:${p.npi}`)}
                    style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: clickable ? 'pointer' : 'default' }}
                    onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = '#F0F4FF' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#FAFAFA' }}
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{p.providerName}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace', marginTop: 2 }}>NPI: {p.npi || '—'}</div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{TYPE_LABELS[p.providerType] || p.providerType}</td>
                    <td style={{ padding: '14px 16px' }}><Badge color={r.color} label={r.label} /></td>
                    <td style={{ padding: '14px 16px', minWidth: 130 }}>
                      {r.state === 'GRANTED' ? <CompletionBar pct={r.completionPct} /> : <span style={{ color: '#CBD5E1', fontSize: 13 }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: r.nextExpiration ? '#374151' : '#CBD5E1' }}>
                      {r.nextExpiration ? r.nextExpiration.toLocaleDateString('en-US') : '—'}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {(r.state === 'NOT_INVITED' || r.state === 'INVITED' || r.state === 'NO_GRANT') && p.npi && (
                        <button
                          onClick={(e) => handleInvite(e, p)}
                          disabled={!!inviting[p.id]}
                          style={{ padding: '7px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: inviting[p.id] ? 0.6 : 1 }}
                        >
                          {inviting[p.id] ? 'Sending…' : r.state === 'NO_GRANT' ? 'Request access' : r.state === 'INVITED' ? 'Re-invite' : 'Invite'}
                        </button>
                      )}
                      {r.state === 'GRANTED' && <span style={{ color: '#2563EB', fontSize: 13, fontWeight: 700 }}>View →</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
