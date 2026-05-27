import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../api.js'

const MOCK_PROVIDERS = [
  { id: 'p1', name: 'Dr. Lisa Park',   specialty: 'CRNA',              credentialed: true,  shiftsWorked: 14, avgRating: 4.9, preferred: true,  vip: true  },
  { id: 'p2', name: 'Dr. James Obi',   specialty: 'Anesthesiologist',  credentialed: true,  shiftsWorked: 8,  avgRating: 4.7, preferred: true,  vip: false },
  { id: 'p3', name: 'Dr. Sarah Kim',   specialty: 'CRNA',              credentialed: true,  shiftsWorked: 5,  avgRating: 4.8, preferred: false, vip: false },
  { id: 'p4', name: 'Dr. Tom Walsh',   specialty: 'CRNA',              credentialed: false, shiftsWorked: 3,  avgRating: 4.2, preferred: false, vip: false },
  { id: 'p5', name: 'Dr. Priya Nair',  specialty: 'Anesthesiologist',  credentialed: true,  shiftsWorked: 11, avgRating: 4.95,preferred: false, vip: true  },
  { id: 'p6', name: 'Dr. Marcus Chen', specialty: 'Anesthesia Assistant', credentialed: true, shiftsWorked: 2, avgRating: 4.6, preferred: false, vip: false },
]

function Stars({ rating }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span style={{ color: '#F59E0B', fontSize: 14, letterSpacing: 1 }}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(5 - full - (half ? 1 : 0))}
      <span style={{ color: '#64748B', fontSize: 12, fontWeight: 600, marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  )
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading]     = useState(true)
  const [searchTerm, setSearch]   = useState('')
  const [actionLoading, setAL]    = useState({})
  const [selectedProvider, setSP] = useState(null)

  useEffect(() => {
    facilityAPI.getProviders()
      .then(setProviders)
      .catch(() => setProviders(MOCK_PROVIDERS))
      .finally(() => setLoading(false))
  }, [])

  async function togglePreferred(provider) {
    setAL((prev) => ({ ...prev, [provider.id]: true }))
    try {
      if (provider.preferred) {
        await facilityAPI.removePreferred(provider.id)
      } else {
        await facilityAPI.addPreferred(provider.id)
      }
      setProviders((prev) =>
        prev.map((p) => p.id === provider.id ? { ...p, preferred: !p.preferred } : p)
      )
    } catch {
      alert('Action failed.')
    } finally {
      setAL((prev) => ({ ...prev, [provider.id]: false }))
    }
  }

  const filtered = providers.filter((p) =>
    !searchTerm ||
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.specialty.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div style={{ padding: '32px 40px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Providers</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Manage your provider relationships</p>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 360, marginBottom: 24 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16 }}>🔍</span>
        <input
          type="text"
          placeholder="Search providers..."
          value={searchTerm}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '11px 14px 11px 38px',
            background: '#fff',
            border: '1.5px solid #E2E8F0',
            borderRadius: 10,
            fontSize: 14,
            color: '#0F172A',
            outline: 'none',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
          onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 120px 80px 140px 120px 100px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Provider', 'Specialty', 'Credentialed', 'Shifts', 'Avg Rating', 'Preferred', 'Action'].map((h) => (
            <div key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </div>
          ))}
        </div>

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading providers...</div>
        )}

        {filtered.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.5fr 120px 80px 140px 120px 100px',
              borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
              cursor: 'pointer',
              background: '#fff',
              transition: 'background 0.1s',
            }}
            onClick={() => setSP(p)}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFE')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
          >
            {/* Name */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg, #6366F1, #7C3AED)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
              }}>
                {p.name.split(' ').map(w => w[0]).slice(1, 3).join('')}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{p.name}</div>
                {p.vip && (
                  <span style={{ background: '#F3E8FF', color: '#7C3AED', border: '1px solid #DDD6FE', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                    ✦ VIP
                  </span>
                )}
              </div>
            </div>

            {/* Specialty */}
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center' }}>
              {p.specialty}
            </div>

            {/* Credentialed */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center' }}>
              {p.credentialed ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#ECFDF5', color: '#059669', border: '1px solid #6EE7B7', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                  ✓ Verified
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F8FAFC', color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500 }}>
                  Pending
                </span>
              )}
            </div>

            {/* Shifts worked */}
            <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center' }}>
              {p.shiftsWorked}
            </div>

            {/* Rating */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center' }}>
              {p.avgRating > 0 ? <Stars rating={p.avgRating} /> : <span style={{ color: '#CBD5E1', fontSize: 13 }}>No ratings</span>}
            </div>

            {/* Preferred */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 20, cursor: 'pointer' }} title={p.preferred ? 'Preferred' : 'Not preferred'}>
                {p.preferred ? '⭐' : '☆'}
              </span>
            </div>

            {/* Action */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center' }}>
              <button
                onClick={(e) => { e.stopPropagation(); togglePreferred(p) }}
                disabled={actionLoading[p.id]}
                style={{
                  padding: '6px 12px',
                  background: p.preferred ? '#FEF2F2' : '#EEF2FF',
                  color: p.preferred ? '#DC2626' : '#6366F1',
                  border: `1px solid ${p.preferred ? '#FCA5A5' : '#A5B4FC'}`,
                  borderRadius: 7,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: actionLoading[p.id] ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.preferred ? 'Remove' : '+ Prefer'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Provider Detail Modal */}
      {selectedProvider && (
        <div
          onClick={() => setSP(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 20, padding: '36px', width: '100%', maxWidth: 480,
              boxShadow: '0 25px 60px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{selectedProvider.name}</div>
                <div style={{ fontSize: 14, color: '#64748B', marginTop: 2 }}>{selectedProvider.specialty}</div>
              </div>
              <button onClick={() => setSP(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94A3B8' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {[
                { label: 'Shifts at Your Facility', value: selectedProvider.shiftsWorked },
                { label: 'Avg Rating', value: `★ ${selectedProvider.avgRating}` },
                { label: 'Status', value: selectedProvider.credentialed ? '✓ Credentialed' : 'Pending Review' },
                { label: 'VIP', value: selectedProvider.vip ? '✦ VIP Provider' : 'Standard' },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{value}</div>
                </div>
              ))}
            </div>

            <button
              onClick={() => { togglePreferred(selectedProvider); setSP(null) }}
              style={{
                width: '100%', padding: '13px',
                background: selectedProvider.preferred ? '#FEF2F2' : '#6366F1',
                color: selectedProvider.preferred ? '#DC2626' : '#fff',
                border: selectedProvider.preferred ? '1px solid #FCA5A5' : 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {selectedProvider.preferred ? 'Remove from Preferred' : '⭐ Add to Preferred'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
