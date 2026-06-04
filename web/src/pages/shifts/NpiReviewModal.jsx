import React, { useState } from 'react'
import { facilityAPI } from '../../api.js'

/**
 * NPI disambiguation modal — gentle, non-blocking review queue.
 *
 * After a multi-sheet roster import, providers whose NPI couldn't be
 * auto-resolved land here. The coordinator can, per provider:
 *   - pick the correct NPPES match (multi-match case)
 *   - search again with a corrected name (no-match case)
 *   - type the NPI manually
 *   - skip ("no NPI needed" — back-office staff or handle later)
 *
 * Each resolution removes that card from the queue. Closing the modal at any
 * time is fine — the rest stay in the queue for next time.
 */

function CandidateRow({ candidate, selected, onSelect }) {
  const loc = candidate.primaryAddress
    ? `${candidate.primaryAddress.city || ''}${candidate.primaryAddress.city && candidate.primaryAddress.state ? ', ' : ''}${candidate.primaryAddress.state || ''}`
    : null
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
        border: `1.5px solid ${selected ? '#6366F1' : '#E2E8F0'}`,
        background: selected ? '#EEF2FF' : '#fff',
        borderRadius: 10, cursor: 'pointer', marginBottom: 8,
      }}
    >
      <input type="radio" checked={selected} onChange={onSelect} style={{ marginTop: 3 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
          {[candidate.firstName, candidate.middleName, candidate.lastName].filter(Boolean).join(' ')}
          {candidate.credential ? `, ${candidate.credential}` : ''}
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
          NPI {candidate.npi}
          {candidate.primaryTaxonomy ? ` · ${candidate.primaryTaxonomy}` : ''}
          {loc ? ` · ${loc}` : ''}
        </div>
      </div>
    </label>
  )
}

function ReviewCard({ row, onResolved }) {
  // candidates may be stored on the row (from import) or fetched via re-search
  const [candidates, setCandidates] = useState(row.npiLookupCandidates || [])
  const [selectedNpi, setSelectedNpi] = useState(null)
  const [manualNpi, setManualNpi] = useState('')
  const [searchName, setSearchName] = useState(row.providerName || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isNoMatch = !candidates || candidates.length === 0

  async function research() {
    setBusy(true); setErr(null)
    try {
      const result = await facilityAPI.searchNpi(searchName, 'MA')
      setCandidates(result.matches || [])
      setSelectedNpi(null)
      if (!result.matches || result.matches.length === 0) {
        setErr('Still no matches. Try a different spelling, or enter the NPI manually.')
      }
    } catch (e) {
      setErr(e.message || 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(npiValue) {
    setBusy(true); setErr(null)
    try {
      await facilityAPI.resolveNpi(row.id, { npi: npiValue })
      onResolved(row.id)
    } catch (e) {
      setErr(e.message || 'Failed to save.')
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true); setErr(null)
    try {
      await facilityAPI.resolveNpi(row.id, { exempt: true })
      onResolved(row.id)
    } catch (e) {
      setErr(e.message || 'Failed to skip.')
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 18, marginBottom: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{row.providerName}</div>
        {row.providerType && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>{row.providerType}</span>
        )}
      </div>

      {isNoMatch ? (
        <>
          <div style={{ fontSize: 13, color: '#A16207', background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', margin: '8px 0 14px' }}>
            No NPI match found in Massachusetts. This might be a typo, a non-MA provider, or a non-clinical staff member.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Corrected name"
              style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14 }}
            />
            <button onClick={research} disabled={busy} style={btnSecondary}>
              {busy ? 'Searching…' : 'Search again'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#64748B', margin: '8px 0 12px' }}>
            Found {candidates.length} provider{candidates.length !== 1 ? 's' : ''} with this name in MA. Which one is yours?
          </div>
          {candidates.map((c) => (
            <CandidateRow
              key={c.npi}
              candidate={c}
              selected={selectedNpi === c.npi}
              onSelect={() => setSelectedNpi(c.npi)}
            />
          ))}
          <button
            onClick={() => confirm(selectedNpi)}
            disabled={!selectedNpi || busy}
            style={{ ...btnPrimary, opacity: !selectedNpi || busy ? 0.5 : 1, marginTop: 4 }}
          >
            {busy ? 'Saving…' : 'Confirm selected NPI'}
          </button>
        </>
      )}

      {/* Manual NPI entry — always available */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
        <input
          value={manualNpi}
          onChange={(e) => setManualNpi(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="Or type a 10-digit NPI"
          style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={() => confirm(manualNpi)} disabled={manualNpi.length !== 10 || busy} style={{ ...btnSecondary, opacity: manualNpi.length !== 10 || busy ? 0.5 : 1 }}>
          Use this NPI
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 10 }}>{err}</div>}

      <button onClick={skip} disabled={busy} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer', marginTop: 12, textDecoration: 'underline' }}>
        No NPI needed (back-office staff or handle later)
      </button>
    </div>
  )
}

const btnPrimary = { padding: '10px 18px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const btnSecondary = { padding: '9px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

export default function NpiReviewModal({ rows, onClose, onAllResolved }) {
  const [remaining, setRemaining] = useState(rows)

  function handleResolved(id) {
    const next = remaining.filter((r) => r.id !== id)
    setRemaining(next)
    if (next.length === 0) onAllResolved?.()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 24 }}>
      <div style={{ background: '#F8FAFC', borderRadius: 16, padding: 28, width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', margin: 0 }}>Review provider NPIs</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B', lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>
          {remaining.length} provider{remaining.length !== 1 ? 's' : ''} couldn't be matched to an NPI automatically. Resolve now or close and come back later — your roster works either way.
        </p>

        {remaining.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#15803D', fontSize: 15, fontWeight: 600 }}>
            ✓ All providers resolved.
          </div>
        ) : (
          remaining.map((row) => (
            <ReviewCard key={row.id} row={row} onResolved={handleResolved} />
          ))
        )}
      </div>
    </div>
  )
}
