import React from 'react'

const SHARED_ITEMS = [
  { key: 'providers',    label: 'Provider Management', icon: '👩‍⚕️' },
  { key: 'profile',      label: 'Facility Profile',    icon: '🏥' },
  { key: 'subscription', label: 'Subscription',        icon: '⭐' },
]

const SHIFTS_ITEMS = [
  { key: 'shifts-dashboard',  label: 'Dashboard',           icon: '📊' },
  { key: 'schedule',          label: 'Schedule Builder',    icon: '📅' },
  { key: 'daily',             label: 'Daily View',          icon: '📍' },
  { key: 'coverage-templates',label: 'Coverage Templates',  icon: '🧩' },
  { key: 'roster',            label: 'Internal Roster',     icon: '👥' },
  { key: 'windows',           label: 'Availability Windows',icon: '🗓' },
  { key: 'requests',          label: 'Provider Requests',   icon: '✋' },
  { key: 'gaps',              label: 'Gaps & Incentives',   icon: '🔴' },
  { key: 'staffiq',           label: 'StaffIQ Insights',    icon: '🧠' },
  { key: 'staffiq-inputs',    label: 'StaffIQ Data Input',  icon: '📝' },
  { key: 'data-upload',       label: 'Data Upload',         icon: '📤' },
  { key: 'calculator',        label: 'Calculator',          icon: '🧮' },
]

const MARKETPLACE_ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',   icon: '🏠' },
  { key: 'post-shift', label: 'Post a Shift', icon: '➕' },
  { key: 'shifts',     label: 'My Shifts',   icon: '📋' },
]

function NavItem({ item, isActive, onNavigate }) {
  return (
    <button
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
}

function SectionHeader({ label }) {
  return (
    <div
      style={{
        padding: '14px 24px 6px',
        fontSize: 10,
        fontWeight: 700,
        color: '#334155',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </div>
  )
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: 'rgba(255,255,255,0.06)',
        margin: '8px 0',
      }}
    />
  )
}

export default function Sidebar({ activePage, onNavigate, facilityName, onLogout, snapMode }) {
  const isShiftsMode = snapMode === 'SHIFTS' || snapMode === 'BOTH'
  const isMarketplaceMode = snapMode === 'MARKETPLACE' || snapMode === 'BOTH'

  return (
    <aside
      style={{
        width: 240,
        background: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 56,
        left: 0,
        bottom: 0,
        zIndex: 100,
        overflow: 'hidden',
      }}
    >
      {/* Facility Name */}
      {facilityName && (
        <div
          style={{
            padding: '14px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>
            SIGNED IN AS
          </div>
          <div
            style={{
              fontSize: 13,
              color: '#CBD5E1',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {facilityName}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {/* SNAP Shifts section */}
        {isShiftsMode && (
          <>
            <SectionHeader label="SNAP Shifts" />
            {SHIFTS_ITEMS.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                isActive={activePage === item.key}
                onNavigate={onNavigate}
              />
            ))}
            <Divider />
          </>
        )}

        {/* SNAP Marketplace section */}
        {isMarketplaceMode && (
          <>
            <SectionHeader label="SNAP Marketplace" />
            {MARKETPLACE_ITEMS.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                isActive={activePage === item.key}
                onNavigate={onNavigate}
              />
            ))}
            <Divider />
          </>
        )}

        {/* Shared section */}
        <SectionHeader label="Account" />
        {SHARED_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            isActive={activePage === item.key}
            onNavigate={onNavigate}
          />
        ))}
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
