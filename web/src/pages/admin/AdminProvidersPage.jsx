import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const MOCK_PROVIDERS = [
  { id: 'p1', name: 'Dr. Lisa Park',    email: 'lisa.park@email.com',    specialty: 'CRNA',              credentialed: true,  vip: true,  vipPoints: 1240, licenseExpiry: '2027-03-15', shiftsBooked: 47 },
  { id: 'p2', name: 'Dr. James Obi',    email: 'j.obi@email.com',        specialty: 'Anesthesiologist',  credentialed: true,  vip: false, vipPoints: 320,  licenseExpiry: '2026-06-14', shiftsBooked: 31 },
  { id: 'p3', name: 'Dr. Sarah Kim',    email: 'sarah.kim@email.com',    specialty: 'CRNA',              credentialed: true,  vip: false, vipPoints: 180,  licenseExpiry: '2027-01-20', shiftsBooked: 18 },
  { id: 'p4', name: 'Dr. Tom Walsh',    email: 't.walsh@email.com',      specialty: 'CRNA',              credentialed: false, vip: false, vipPoints: 50,   licenseExpiry: '2026-06-22', shiftsBooked: 7  },
  { id: 'p5', name: 'Dr. Priya Nair',   email: 'priya.nair@email.com',   specialty: 'Anesthesiologist',  credentialed: true,  vip: true,  vipPoints: 2100, licenseExpiry: '2027-08-10', shiftsBooked: 64 },
  { id: 'p6', name: 'Dr. Marcus Chen',  email: 'm.chen@email.com',       specialty: 'Anesthesia Assistant', credentialed: true, vip: false, vipPoints: 90, licenseExpiry: '2026-09-05', shiftsBooked: 9 },
  { id: 'p7', name: 'Dr. Raj Patel',    email: 'raj.patel@email.com',    specialty: 'Anesthesiologist',  credentialed: true,  vip: false, vipPoints: 440,  licenseExpiry: '2026-07-07', shiftsBooked: 22 },
]

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading]     = useState(true)
  const [toggling, setToggling]   = useState({})
  const [search, setSearch]       = useState('')
  const [filterCred, setFilterCred] = useState('all')

  useEffect(() => {
    adminAPI.getProviders()
      .then(setProviders)
      .catch(() => setProviders(MOCK_PROVIDERS))
      .finally(() => setLoading(false))
  }, [])

  async function toggleCredentialed(provider) {
    setToggling((prev) => ({ ...prev, [provider.id]: true }))
    try {
      await adminAPI.updateCredentialed(provider.id, !provider.credentialed)
      setProviders((prev) =>
        prev.map((p) => p.id === provider.id ? { ...p, credentialed: !p.credentialed } : p)
      )
    } catch {
      alert('Failed to update credentialing status.')
    } finally {
      setToggling((prev) => ({ ...prev, [provider.id]: false }))
    }
  }

  const filtered = providers.filter((p) => {
    const fullName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim()
    const email = p.email || p.user?.email || ''
    const matchSearch = !search || fullName.toLowerCase().includes(search.toLowerCase()) || email.toLowerCase().includes(search.toLowerCase())
    const matchCred = filterCred === 'all' || (filterCred === 'yes' ? p.credentialed : !p.credentialed)
    return matchSearch && matchCred
  })

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Providers</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{providers.length} registered providers</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 0 300px' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔍</span>
          <input
            type="text"
            placeholder="Search name or email..."
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
        <select
          value={filterCred}
          onChange={(e) => setFilterCred(e.target.value)}
          style={{ padding: '10px 14px', background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#374151', outline: 'none', cursor: 'pointer' }}
        >
          <option value="all">All providers</option>
          <option value="yes">Credentialed</option>
          <option value="no">Pending</option>
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 100px 80px 100px 90px 100px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Name', 'Email', 'Specialty', 'Credentialed', 'VIP', 'VIP Pts', 'License', 'Shifts'].map((h) => (
            <div key={h} style={{ padding: '12px 14px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </div>
          ))}
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
            {providers.length === 0 ? 'No providers registered yet.' : 'No providers match your filters.'}
          </div>
        )}

        {filtered.map((p, i) => {
          const fullName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unknown'
          const email = p.email || p.user?.email || '—'
          const licenseExpiry = p.licenseExpiry || p.maLicenseExpiry
          const days = licenseExpiry ? daysUntil(licenseExpiry) : 9999
          const licenseRed = licenseExpiry && days < 90
          const vip = p.vip ?? p.vipStatus ?? false
          const vipPoints = p.vipPoints ?? 0
          const shiftsBooked = p.shiftsBooked ?? p._count?.bookings ?? 0
          const initial = fullName.split(' ').filter(Boolean).slice(-1)[0]?.[0] || '?'

          return (
            <div
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 2fr 1.5fr 100px 80px 100px 90px 100px',
                borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                background: i % 2 === 0 ? '#fff' : '#FAFAFA',
              }}
            >
              {/* Name */}
              <div style={{ padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #6366F1, #7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                  {initial}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fullName}
                </div>
              </div>

              {/* Email */}
              <div style={{ padding: '14px 14px', fontSize: 12, color: '#64748B', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
              </div>

              {/* Specialty */}
              <div style={{ padding: '14px 14px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center' }}>
                {p.specialty}
              </div>

              {/* Credentialed toggle */}
              <div style={{ padding: '14px 14px', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => toggleCredentialed(p)}
                  disabled={toggling[p.id]}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    background: p.credentialed ? '#ECFDF5' : '#F8FAFC',
                    color: p.credentialed ? '#059669' : '#94A3B8',
                    border: `1px solid ${p.credentialed ? '#6EE7B7' : '#E2E8F0'}`,
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: toggling[p.id] ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.credentialed ? '✓ Yes' : '○ No'}
                </button>
              </div>

              {/* VIP */}
              <div style={{ padding: '14px 14px', display: 'flex', alignItems: 'center' }}>
                {vip && (
                  <span style={{ background: '#F3E8FF', color: '#7C3AED', border: '1px solid #DDD6FE', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                    ✦ VIP
                  </span>
                )}
              </div>

              {/* VIP Points */}
              <div style={{ padding: '14px 14px', fontSize: 13, fontWeight: 700, color: vip ? '#7C3AED' : '#64748B', display: 'flex', alignItems: 'center' }}>
                {vipPoints.toLocaleString()}
              </div>

              {/* License expiry */}
              <div style={{ padding: '14px 14px', display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: licenseRed ? 700 : 400,
                    color: licenseRed ? '#DC2626' : '#64748B',
                    background: licenseRed ? '#FEF2F2' : 'transparent',
                    padding: licenseRed ? '2px 6px' : '0',
                    borderRadius: 4,
                  }}
                >
                  {licenseExpiry ? String(licenseExpiry).substring(0, 10) : '—'}
                </span>
              </div>

              {/* Shifts */}
              <div style={{ padding: '14px 14px', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center' }}>
                {shiftsBooked}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
