import React from 'react'

const NAV_ITEMS = [
  { key: 'overview',         label: 'Overview',         icon: '📊' },
  { key: 'providers',        label: 'Providers',        icon: '👩‍⚕️' },
  { key: 'facilities',       label: 'Facilities',       icon: '🏥' },
  { key: 'credential-users', label: 'Credential Users', icon: '🔐' },
  { key: 'shifts',           label: 'Shifts',           icon: '📋' },
  { key: 'disputes',         label: 'Disputes',         icon: '⚖️' },
  { key: 'messages',         label: 'Messages',         icon: '💬' },
  { key: 'analytics',        label: 'Analytics',        icon: '📈' },
]

const SNAP_SHIFTS_ITEMS = [
  { key: 'staffiq-analytics', label: 'StaffIQ Analytics', icon: '🧠' },
  { key: 'roi',               label: 'ROI Tracker',        icon: '💰' },
  { key: 'leads',             label: 'Leads',              icon: '📬' },
  { key: 'admin-windows',     label: 'Availability Windows', icon: '🗓' },
  { key: 'admin-incentives',  label: 'Incentive Shifts',   icon: '⚡' },
  { key: 'admin-uploads',     label: 'Data Uploads',       icon: '📤' },
]

export default function AdminSidebar({ activePage, onNavigate, onLogout }) {
  return (
    <aside
      style={{
        width: 240,
        minHeight: '100vh',
        background: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '28px 24px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: '#2563EB',
              letterSpacing: '-0.04em',
              lineHeight: 1,
            }}
          >
            SNAP
          </div>
          <img src="/snappy-mascot.png" alt="" style={{ height: 40, width: 'auto', display: 'block' }} />
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 6,
            background: 'rgba(37,99,235,0.15)',
            border: '1px solid rgba(37,99,235,0.3)',
            borderRadius: 6,
            padding: '2px 8px',
          }}
        >
          <span style={{ fontSize: 10 }}>🔐</span>
          <span style={{ fontSize: 11, color: '#A5B4FC', fontWeight: 700, letterSpacing: '0.05em' }}>
            ADMIN
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.key
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '11px 24px',
                background: isActive
                  ? 'linear-gradient(90deg, rgba(37,99,235,0.2) 0%, rgba(37,99,235,0.05) 100%)'
                  : 'transparent',
                border: 'none',
                borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
                color: isActive ? '#A5B4FC' : '#64748B',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#94A3B8'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#64748B'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}

        {/* SNAP Shifts section */}
        <div
          style={{
            margin: '16px 24px 8px',
            fontSize: 10,
            fontWeight: 700,
            color: '#334155',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          SNAP Shifts
        </div>
        {SNAP_SHIFTS_ITEMS.map((item) => {
          const isActive = activePage === item.key
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '11px 24px',
                background: isActive
                  ? 'linear-gradient(90deg, rgba(37,99,235,0.2) 0%, rgba(37,99,235,0.05) 100%)'
                  : 'transparent',
                border: 'none',
                borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
                color: isActive ? '#A5B4FC' : '#64748B',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#94A3B8'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = '#64748B'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={onLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '10px 12px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            color: '#64748B',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#EF4444'
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#64748B'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          }}
        >
          <span>🚪</span>
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  )
}
