import React, { useState, useEffect, useCallback } from 'react'
import { credentialAPI } from '../../api.js'

const CREDENTIAL_TYPES = [
  { value: 'CRNA',                  label: 'CRNA' },
  { value: 'ANESTHESIOLOGIST',      label: 'Anesthesiologist' },
  { value: 'ANESTHESIA_ASSISTANT',  label: 'Anesthesia Assistant' },
]

const MATCH_COLORS = { LINKED: '#10B981', INVITED: '#F59E0B', NOT_INVITED: '#94A3B8' }
const MATCH_LABELS = { LINKED: 'Linked', INVITED: 'Invited', NOT_INVITED: 'Not Invited' }

function MatchBadge({ status }) {
  const color = MATCH_COLORS[status] || '#94A3B8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', borderRadius: 999, background: `${color}18`, color, fontSize: 12, fontWeight: 700 }}>
      {MATCH_LABELS[status] || status}
    </span>
  )
}


function guessCredType(taxonomy) {
  const t = (taxonomy || '').toLowerCase()
  if (t.includes('nurse anesthetist') || t.includes('crna')) return 'CRNA'
  if (t.includes('anesthesiologist assistant'))               return 'ANESTHESIA_ASSISTANT'
  if (t.includes('anesthesiology') || t.includes('anesthesiologist')) return 'ANESTHESIOLOGIST'
  return 'CRNA'
}

const EMPTY_FORM = { firstName: '', lastName: '', npiNumber: '', credentialType: 'CRNA' }

export default function CredentialRosterSettings() {
  const [roster, setRoster]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [adding, setAdding]         = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [inviting, setInviting]     = useState(null)
  const [removing, setRemoving]     = useState(null)

  // NPI search state
  const [searching, setSearching]   = useState(false)
  const [candidates, setCandidates] = useState(null)  // null = not searched yet
  const [searchErr, setSearchErr]   = useState('')

  const load = useCallback(() => {
    setLoading(true)
    credentialAPI.getRoster()
      .then(setRoster)
      .catch(() => setError('Failed to load roster'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    // Clear candidates when the user edits name fields
    if (k === 'firstName' || k === 'lastName') setCandidates(null)
  }

  async function handleSearch() {
    if (!form.firstName.trim() && !form.lastName.trim()) {
      setSearchErr('Enter at least a last name to search.')
      return
    }
    setSearching(true)
    setSearchErr('')
    setCandidates(null)
    try {
      const data = await credentialAPI.searchNpi(form.firstName, form.lastName)
      const results = data.matches || []
      setCandidates(results)
      if (results.length === 0) setSearchErr('No active providers found. Try a different spelling or use first initial only.')
    } catch {
      setSearchErr('NPI Registry search failed. You can enter the NPI manually below.')
    } finally {
      setSearching(false)
    }
  }

  function handlePickCandidate(c) {
    setForm({
      firstName:      c.firstName,
      lastName:       c.lastName,
      npiNumber:      c.npi,
      credentialType: guessCredType(c.primaryTaxonomy),
    })
    setCandidates(null)
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.firstName.trim() || !form.lastName.trim() || !form.npiNumber.trim()) {
      setError('First name, last name, and NPI are required.')
      return
    }
    setAdding(true)
    try {
      await credentialAPI.addRosterEntry({
        firstName:      form.firstName.trim(),
        lastName:       form.lastName.trim(),
        npiNumber:      form.npiNumber.trim(),
        credentialType: form.credentialType,
      })
      setForm(EMPTY_FORM)
      setCandidates(null)
      setSuccess('Provider added to roster.')
      load()
    } catch (err) {
      setError(err.message || 'Failed to add provider.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id, name) {
    if (!window.confirm(`Remove ${name} from the roster?`)) return
    setRemoving(id)
    try {
      await credentialAPI.removeRosterEntry(id)
      load()
    } catch {
      setError('Failed to remove provider.')
    } finally {
      setRemoving(null)
    }
  }

  async function handleInvite(entry) {
    setInviting(entry.id)
    setError('')
    try {
      await credentialAPI.inviteRosterEntry(entry.id)
      setSuccess(`Invitation sent to ${entry.firstName} ${entry.lastName}.`)
      load()
    } catch (err) {
      setError(err.message || 'Failed to send invitation.')
    } finally {
      setInviting(null)
    }
  }

  const inputStyle = {
    padding: '9px 12px',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    fontSize: 13,
    color: '#0F172A',
    background: '#fff',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  const npiReady = form.npiNumber.trim().length > 0

  return (
    <div style={{ padding: '32px 40px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Roster Settings</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Search by name to find a provider in the NPI Registry, then add them to your roster.</p>
      </div>

      {/* Add provider form */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px', marginBottom: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>Add Provider</div>

        {/* Step 1 — name search */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Step 1 — Search NPI Registry
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>First Name</div>
              <input
                style={inputStyle}
                placeholder="First name or initial"
                value={form.firstName}
                onChange={e => setField('firstName', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Last Name *</div>
              <input
                style={inputStyle}
                placeholder="Last name"
                value={form.lastName}
                onChange={e => setField('lastName', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching}
              style={{ padding: '9px 20px', background: searching ? '#93C5FD' : '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: searching ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {searching ? 'Searching…' : '🔍 Find Provider'}
            </button>
          </div>

          {searchErr && <div style={{ fontSize: 13, color: '#F59E0B', marginTop: 8 }}>{searchErr}</div>}

          {/* Candidate list */}
          {candidates !== null && candidates.length > 0 && (
            <div style={{ marginTop: 12, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
              {candidates.map((c, i) => (
                <button
                  key={c.npi}
                  type="button"
                  onClick={() => handlePickCandidate(c)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '11px 16px',
                    background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                    borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#FAFAFA'}
                >
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {c.firstName} {c.lastName}
                      {c.credential && <span style={{ fontWeight: 400, color: '#64748B' }}>, {c.credential}</span>}
                    </span>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      {c.primaryTaxonomy}{c.location ? ` · ${c.location}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#94A3B8' }}>NPI {c.npi}</span>
                    <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 600 }}>Select →</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step 2 — confirm + add */}
        <form onSubmit={handleAdd}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Step 2 — Confirm &amp; Add
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>First Name *</div>
              <input style={inputStyle} placeholder="First name" value={form.firstName} onChange={e => setField('firstName', e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Last Name *</div>
              <input style={inputStyle} placeholder="Last name" value={form.lastName} onChange={e => setField('lastName', e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>NPI Number *</div>
              <input
                style={{ ...inputStyle, background: npiReady ? '#F0FDF4' : '#fff', borderColor: npiReady ? '#86EFAC' : '#E2E8F0' }}
                placeholder="Auto-filled from search"
                value={form.npiNumber}
                onChange={e => setField('npiNumber', e.target.value)}
                maxLength={10}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Credential Type</div>
              <select style={inputStyle} value={form.credentialType} onChange={e => setField('credentialType', e.target.value)}>
                {CREDENTIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {error   && <div style={{ fontSize: 13, color: '#EF4444', marginBottom: 12 }}>{error}</div>}
          {success && <div style={{ fontSize: 13, color: '#10B981', marginBottom: 12 }}>{success}</div>}

          <button
            type="submit"
            disabled={adding || !npiReady}
            style={{ padding: '10px 24px', background: adding || !npiReady ? '#CBD5E1' : '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: adding || !npiReady ? 'not-allowed' : 'pointer' }}
          >
            {adding ? 'Adding…' : '+ Add to Roster'}
          </button>
          {!npiReady && <span style={{ marginLeft: 12, fontSize: 12, color: '#94A3B8' }}>Search above to auto-fill NPI, or type it manually</span>}
        </form>
      </div>

      {/* Current roster */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Current Roster</div>
          <div style={{ fontSize: 13, color: '#94A3B8' }}>{roster.length} provider{roster.length !== 1 ? 's' : ''}</div>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading…</div>
        ) : roster.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            No providers on the roster yet. Add one above to get started.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Provider</th>
                <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NPI</th>
                <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                <th style={{ padding: '12px 20px' }} />
              </tr>
            </thead>
            <tbody>
              {roster.map((entry, i) => (
                <tr key={entry.id} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{entry.lastName}, {entry.firstName}</div>
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: '#64748B', fontFamily: 'monospace' }}>{entry.npiNumber}</td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{entry.credentialType?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '14px 20px' }}><MatchBadge status={entry.matchStatus} /></td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {entry.matchStatus === 'NOT_INVITED' && (
                        <button
                          onClick={() => handleInvite(entry)}
                          disabled={inviting === entry.id}
                          style={{ padding: '6px 14px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 6, color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          {inviting === entry.id ? 'Sending…' : 'Invite'}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(entry.id, `${entry.firstName} ${entry.lastName}`)}
                        disabled={removing === entry.id}
                        style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        {removing === entry.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
