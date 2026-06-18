import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const card = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 }
const selectStyle = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A', minWidth: 280 }

export default function AdminFeatureFlagsPage() {
  const [facilities, setFacilities] = useState([])
  const [catalog, setCatalog] = useState([])
  const [facilityId, setFacilityId] = useState('')
  const [data, setData] = useState(null) // { tier, flags: { name: {enabled, source} } }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savingFlag, setSavingFlag] = useState(null)

  useEffect(() => {
    Promise.all([adminAPI.getFacilities(), adminAPI.getFlagCatalog()])
      .then(([facs, cat]) => {
        setFacilities(facs.facilities || facs || [])
        setCatalog(cat.flags || [])
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!facilityId) {
      setData(null)
      return
    }
    setLoading(true)
    adminAPI
      .getFacilityFlags(facilityId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [facilityId])

  async function setFlag(flagName, enabled) {
    setSavingFlag(flagName)
    setError('')
    try {
      const updated = await adminAPI.setFacilityFlag(facilityId, { flagName, enabled })
      setData(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingFlag(null)
    }
  }

  async function resetFlag(flagName) {
    setSavingFlag(flagName)
    try {
      const updated = await adminAPI.setFacilityFlag(facilityId, { flagName, reset: true })
      setData(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingFlag(null)
    }
  }

  // Group catalog by category
  const byCategory = catalog.reduce((acc, f) => {
    ;(acc[f.category] = acc[f.category] || []).push(f)
    return acc
  }, {})

  return (
    <div style={{ padding: '32px 40px', maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Feature Flags</h1>
      <div style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 20 }}>
        Per-facility feature access. Each flag defaults from the facility's subscription tier; set an override to force it
        on or off. Only SNAP admins see this.
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Facility</label>
        <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} style={selectStyle}>
          <option value="">— select a facility —</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {data && (
          <span style={{ fontSize: 12, color: '#64748B' }}>
            Tier: <strong style={{ color: '#1D4ED8' }}>{data.tier}</strong>
          </span>
        )}
      </div>

      {loading && <div style={{ ...card, color: '#64748B' }}>Loading…</div>}

      {data &&
        !loading &&
        Object.entries(byCategory).map(([category, flags]) => (
          <div key={category} style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              {category}
            </div>
            {flags.map((f) => {
              const state = data.flags[f.name] || { enabled: false, source: 'TIER' }
              const busy = savingFlag === f.name
              return (
                <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {f.label}
                      {f.adminOnly && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, padding: '1px 6px' }}>
                          ADMIN ONLY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{f.description}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: state.source === 'OVERRIDE' ? '#B45309' : '#94A3B8',
                      textTransform: 'uppercase',
                    }}
                  >
                    {state.source === 'OVERRIDE' ? 'Override' : 'Tier default'}
                  </span>
                  {/* Toggle */}
                  <button
                    onClick={() => setFlag(f.name, !state.enabled)}
                    disabled={busy}
                    style={{
                      width: 52,
                      height: 28,
                      borderRadius: 999,
                      border: 'none',
                      cursor: busy ? 'wait' : 'pointer',
                      background: state.enabled ? '#10B981' : '#CBD5E1',
                      position: 'relative',
                      transition: 'background 0.15s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: state.enabled ? 27 : 3,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.15s',
                      }}
                    />
                  </button>
                  {state.source === 'OVERRIDE' && (
                    <button
                      onClick={() => resetFlag(f.name)}
                      disabled={busy}
                      style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}

      {!facilityId && !loading && <div style={{ ...card, color: '#64748B' }}>Select a facility to view and manage its feature flags.</div>}
    </div>
  )
}
