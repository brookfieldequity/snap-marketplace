import React from 'react'

const NAV = {
  COORDINATOR: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'providers', label: 'Providers', icon: '👥' },
    { key: 'expiring', label: 'Expiring Soon', icon: '⚠️' },
    { key: 'roster', label: 'Roster Settings', icon: '📋' },
    { key: 'audit', label: 'Audit Log', icon: '🔍' },
    { key: 'settings', label: 'Users & Settings', icon: '⚙️' },
  ],
  DEPT_HEAD: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'providers', label: 'Providers', icon: '👥' },
  ],
  BILLING: [
    { key: 'providers', label: 'Providers', icon: '👥' },
  ],
}

export default function CredentialSidebar({ activePage, onNavigate, user, onLogout }) {
  const permission = user?.permission || 'BILLING'
  const items = NAV[permission] || NAV.BILLING

  return (
    <aside style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: 240,
      height: '100vh',
      background: '#0F172A',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em' }}>SNAP</div>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginTop: 2 }}>Credentialing</div>
        <div style={{ marginTop: 8, fontSize: 11, background: 'rgba(37,99,235,0.15)', color: '#60A5FA', borderRadius: 4, padding: '2px 8px', display: 'inline-block', fontWeight: 600 }}>
          {user?.facilityName || ''}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '11px 20px',
              background: activePage === item.key ? 'rgba(37,99,235,0.15)' : 'transparent',
              border: 'none',
              borderLeft: `3px solid ${activePage === item.key ? '#2563EB' : 'transparent'}`,
              color: activePage === item.key ? '#60A5FA' : '#64748B',
              fontSize: 13,
              fontWeight: activePage === item.key ? 700 : 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* User + logout */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4, fontWeight: 600 }}>{user?.name}</div>
        <div style={{ fontSize: 11, color: '#334155', marginBottom: 12 }}>
          {user?.permission?.replace('_', ' ')}
        </div>
        <button
          onClick={onLogout}
          style={{ width: '100%', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
