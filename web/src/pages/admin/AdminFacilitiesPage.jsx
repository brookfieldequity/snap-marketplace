import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const TIER_COLORS = {
  BASIC:        { bg: '#EEF2FF', text: '#4F46E5', border: '#A5B4FC' },
  PROFESSIONAL: { bg: '#F3E8FF', text: '#7C3AED', border: '#DDD6FE' },
  ENTERPRISE:   { bg: '#0F172A', text: '#fff',    border: '#334155' },
}

const MOCK_FACILITIES = [
  { id: 'f1', facilityName: 'Boston Surgery Center',      zipCode: '02101',      subscriptionTier: 'PROFESSIONAL', totalShifts: 47, email: 'admin@bsc.com' },
  { id: 'f2', facilityName: 'North Shore Surgical',       zipCode: '01970',       subscriptionTier: 'BASIC',         totalShifts: 12, email: 'info@nss.com' },
  { id: 'f3', facilityName: 'Metro Anesthesia Partners',  zipCode: '02139',   subscriptionTier: 'ENTERPRISE',    totalShifts: 98, email: 'ops@map.com' },
  { id: 'f4', facilityName: 'South Shore Ambulatory',     zipCode: '02184',   subscriptionTier: 'BASIC',         totalShifts: 8,  email: 'admin@ssa.com' },
  { id: 'f5', facilityName: 'Brigham Specialty Center',   zipCode: '02101',      subscriptionTier: 'PROFESSIONAL',  totalShifts: 33, email: 'contact@bsc2.com' },
  { id: 'f6', facilityName: 'Cape Cod Surgical',          zipCode: '02601',     subscriptionTier: 'BASIC',         totalShifts: 6,  email: 'ccs@email.com' },
  { id: 'f7', facilityName: 'Worcester Regional ASC',     zipCode: '01601',   subscriptionTier: 'PROFESSIONAL',  totalShifts: 28, email: 'admin@wrasc.com' },
]

const TIER_PRICES = { BASIC: '$750', PROFESSIONAL: '$2,000', ENTERPRISE: '$5,000' }

export default function AdminFacilitiesPage() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [updating, setUpdating]     = useState({})
  const [search, setSearch]         = useState('')

  useEffect(() => {
    adminAPI.getFacilities()
      .then(setFacilities)
      .catch(() => setFacilities(MOCK_FACILITIES))
      .finally(() => setLoading(false))
  }, [])

  async function handleTierChange(facilityId, newTier) {
    setUpdating((prev) => ({ ...prev, [facilityId]: true }))
    try {
      await adminAPI.updateSubscription(facilityId, newTier)
      setFacilities((prev) =>
        prev.map((f) => f.id === facilityId ? { ...f, subscriptionTier: newTier } : f)
      )
    } catch {
      alert('Failed to update subscription.')
    } finally {
      setUpdating((prev) => ({ ...prev, [facilityId]: false }))
    }
  }

  const filtered = facilities.filter((f) =>
    !search ||
    f.facilityName.toLowerCase().includes(search.toLowerCase()) ||
    f.zipCode.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Facilities</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{facilities.length} registered facilities</p>
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        {['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].map((tier) => {
          const cfg = TIER_COLORS[tier]
          const count = facilities.filter((f) => f.subscriptionTier === tier).length
          return (
            <div
              key={tier}
              style={{
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                borderRadius: 12,
                padding: '12px 20px',
                minWidth: 140,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: cfg.text, letterSpacing: '0.05em', marginBottom: 4 }}>
                {tier}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: cfg.text }}>
                {count}
              </div>
              <div style={{ fontSize: 12, color: cfg.text, opacity: 0.7 }}>{TIER_PRICES[tier]}/mo</div>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 20 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔍</span>
        <input
          type="text"
          placeholder="Search facilities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px 10px 36px',
            background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10,
            fontSize: 14, color: '#0F172A', outline: 'none',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
          onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1.5fr 80px 180px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Facility Name', 'City', 'Tier', 'Shifts', 'Update Tier'].map((h) => (
            <div key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </div>
          ))}
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading...</div>}

        {filtered.map((f, i) => {
          const cfg = TIER_COLORS[f.subscriptionTier] || TIER_COLORS.BASIC
          return (
            <div
              key={f.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2.5fr 1fr 1.5fr 80px 180px',
                borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                alignItems: 'center',
              }}
            >
              {/* Name */}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{f.facilityName}</div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{f.email}</div>
              </div>

              {/* City */}
              <div style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{f.zipCode}</div>

              {/* Tier badge */}
              <div style={{ padding: '14px 16px' }}>
                <span
                  style={{
                    background: cfg.bg,
                    color: cfg.text,
                    border: `1px solid ${cfg.border}`,
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {f.subscriptionTier}
                </span>
              </div>

              {/* Shifts */}
              <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                {f.totalShifts}
              </div>

              {/* Update tier */}
              <div style={{ padding: '14px 16px' }}>
                <select
                  value={f.subscriptionTier}
                  onChange={(e) => handleTierChange(f.id, e.target.value)}
                  disabled={updating[f.id]}
                  style={{
                    padding: '7px 10px',
                    background: updating[f.id] ? '#F8FAFC' : '#fff',
                    border: '1.5px solid #E2E8F0',
                    borderRadius: 8,
                    fontSize: 13,
                    color: '#374151',
                    cursor: updating[f.id] ? 'not-allowed' : 'pointer',
                    outline: 'none',
                    width: '100%',
                  }}
                >
                  {['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].map((t) => (
                    <option key={t} value={t}>{t} — {TIER_PRICES[t]}/mo</option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
