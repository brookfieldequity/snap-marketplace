import React from 'react'

const NAV = {
  COORDINATOR: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'providers', label: 'Providers', icon: '👥' },
    { key: 'import', label: 'Add Documents', icon: '📥' },
    { key: 'cvreader', label: 'Read a CV', icon: '📄' },
    { key: 'maps', label: 'Facility Applications', icon: '📦' },
    { key: 'reports', label: 'Reports', icon: '📈' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ],
  DEPT_HEAD: [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'providers', label: 'Providers', icon: '👥' },
  ],
  BILLING: [
    { key: 'providers', label: 'Providers', icon: '👥' },
  ],
}

export default function CredentialSidebar({ activePage, onNavigate, user, onLogout, onBack, narrow = false, open = false, onClose, topOffset = 52 }) {
  const permission = user?.permission || 'BILLING'
  const items = NAV[permission] || NAV.BILLING

  // On phones the sidebar is an off-canvas drawer: picking a page closes it.
  const navigate = (key) => {
    onNavigate(key)
    if (narrow && onClose) onClose()
  }

  return (
    <>
      {/* Scrim behind the drawer (phone only) */}
      {narrow && open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', top: topOffset, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.5)', zIndex: 350 }}
        />
      )}
    <aside style={{
      position: 'fixed',
      top: narrow ? topOffset : 0,
      left: 0,
      width: 240,
      height: narrow ? undefined : '100dvh',
      bottom: narrow ? 0 : undefined,
      background: '#0F172A',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: narrow ? 400 : 100,
      transform: narrow && !open ? 'translateX(-100%)' : 'translateX(0)',
      transition: narrow ? 'transform 0.25s ease' : 'none',
      boxShadow: narrow && open ? '8px 0 30px rgba(0,0,0,0.35)' : 'none',
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em' }}>SNAP</div>
          <img src="/snappy-mascot.png" alt="" style={{ height: 34, width: 'auto', display: 'block' }} />
        </div>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginTop: 2 }}>Credentialing</div>
        <div style={{ marginTop: 8, fontSize: 11, background: 'rgba(37,99,235,0.15)', color: '#60A5FA', borderRadius: 4, padding: '2px 8px', display: 'inline-block', fontWeight: 600 }}>
          {user?.facilityName || ''}
        </div>
      </div>

      {/* Back to the facility portal (unified-login SSO context). Rendered
          only when the host app provides onBack — direct portal logins
          without a facility session don't get a dead-end button. */}
      {onBack && (
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '12px 20px',
            background: 'rgba(37,99,235,0.12)', border: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            color: '#60A5FA', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          ← Back to SNAP Shifts
        </button>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => navigate(item.key)}
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
    </>
  )
}
