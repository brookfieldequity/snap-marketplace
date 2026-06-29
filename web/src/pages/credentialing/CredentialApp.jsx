import React, { useEffect, useState } from 'react'
import { credentialAPI } from '../../api.js'

function ForcePasswordChange({ user, onDone, onLogout }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (pw.length < 8) return setError('Password must be at least 8 characters.')
    if (pw !== pw2) return setError('Passwords do not match.')
    setLoading(true)
    try {
      await credentialAPI.changePassword(pw)
      onDone({ ...user, forcePasswordChange: false })
    } catch (err) {
      setError(err.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  const inp = { width: '100%', padding: '12px 16px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 15, color: '#0F172A', boxSizing: 'border-box', outline: 'none', background: '#fff' }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.06em' }}>SNAP</div>
          <div style={{ fontSize: 15, color: '#64748B', marginTop: 4 }}>Credentialing Dashboard</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 20, padding: '36px 32px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', marginBottom: 24, fontSize: 13, color: '#92400E', fontWeight: 600 }}>
            Welcome, {user.name}. Please set a new password to continue.
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', margin: '0 0 24px' }}>Set your password</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>New Password</label>
              <input type="password" style={inp} value={pw} onChange={e => setPw(e.target.value)} required placeholder="Minimum 8 characters" autoFocus />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" style={inp} value={pw2} onChange={e => setPw2(e.target.value)} required placeholder="Re-enter password" />
            </div>
            {error && <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', background: loading ? '#A5B4FC' : '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Saving…' : 'Set Password & Continue →'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button onClick={onLogout} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer' }}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
}
import CredentialSidebar from '../../components/CredentialSidebar.jsx'
import CredentialLoginPage from './CredentialLoginPage.jsx'
import CredentialDashboard from './CredentialDashboard.jsx'
import CredentialProviderList from './CredentialProviderList.jsx'
import CredentialProviderFile from './CredentialProviderFile.jsx'
import CredentialSettings from './CredentialSettings.jsx'
import CredentialAuditLog from './CredentialAuditLog.jsx'
import CredentialRosterSettings from './CredentialRosterSettings.jsx'

export default function CredentialApp({ onBack }) {
  const [token, setToken] = useState(() => localStorage.getItem('snapCredToken') || null)
  const [user, setUser] = useState(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [providerDetailId, setProviderDetailId] = useState(null)
  const [rosterDetailId, setRosterDetailId] = useState(null)

  // Verify stored token on mount
  useEffect(() => {
    if (!token) { setLoadingMe(false); return }
    credentialAPI.me()
      .then(u => setUser(u))
      .catch(() => {
        localStorage.removeItem('snapCredToken')
        setToken(null)
      })
      .finally(() => setLoadingMe(false))
  }, [token])

  function handleLogin(tok, u) {
    setToken(tok)
    setUser(u)
    setPage('dashboard')
    setLoadingMe(false)
  }

  function handleLogout() {
    localStorage.removeItem('snapCredToken')
    setToken(null)
    setUser(null)
    setPage('dashboard')
    setProviderDetailId(null)
  }

  function handleNavigate(dest) {
    if (dest.startsWith('provider:')) {
      setProviderDetailId(dest.replace('provider:', ''))
      setRosterDetailId(null)
      setPage('provider')
    } else if (dest.startsWith('roster:')) {
      setRosterDetailId(dest.replace('roster:', ''))
      setProviderDetailId(null)
      setPage('provider')
    } else {
      setPage(dest)
      setProviderDetailId(null)
      setRosterDetailId(null)
    }
  }

  // Loading state while verifying token
  if (loadingMe) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <div style={{ color: '#94A3B8', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  // Not logged in
  if (!token || !user) {
    return <CredentialLoginPage onLogin={handleLogin} onBack={onBack} />
  }

  // Force password change on first login
  if (user.forcePasswordChange) {
    return <ForcePasswordChange user={user} onDone={(updatedUser) => setUser(updatedUser)} onLogout={handleLogout} />
  }

  // Determine which page to show, with permission gating
  const permission = user.permission || 'BILLING'

  // BILLING users can only see providers
  const safePage = (() => {
    if (permission === 'BILLING') return 'providers'
    if (permission === 'DEPT_HEAD' && !['dashboard', 'providers'].includes(page) && page !== 'provider') return 'dashboard'
    return page
  })()

  const activeSidebarKey = safePage === 'provider' ? 'providers' :
    safePage === 'expiring' ? 'expiring' : safePage

  function renderPage() {
    switch (safePage) {
      case 'dashboard':
        return <CredentialDashboard onNavigate={handleNavigate} />

      case 'providers':
        return (
          <CredentialProviderList
            onNavigate={handleNavigate}
            permission={permission}
            filterExpiring={false}
          />
        )

      case 'expiring':
        return (
          <CredentialProviderList
            onNavigate={handleNavigate}
            permission={permission}
            filterExpiring={true}
          />
        )

      case 'provider':
        if (!providerDetailId && !rosterDetailId) {
          return <CredentialProviderList onNavigate={handleNavigate} permission={permission} filterExpiring={false} />
        }
        return (
          <CredentialProviderFile
            providerId={providerDetailId}
            rosterId={rosterDetailId}
            permission={permission}
            onBack={() => { setPage('providers'); setProviderDetailId(null); setRosterDetailId(null) }}
          />
        )

      case 'roster':
        if (permission !== 'COORDINATOR') return null
        return <CredentialRosterSettings />

      case 'audit':
        if (permission !== 'COORDINATOR') return null
        return <CredentialAuditLog />

      case 'settings':
        if (permission !== 'COORDINATOR') return null
        return <CredentialSettings />

      default:
        return <CredentialDashboard onNavigate={handleNavigate} />
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC' }}>
      <CredentialSidebar
        activePage={activeSidebarKey}
        onNavigate={handleNavigate}
        user={user}
        onLogout={handleLogout}
      />
      <main style={{ marginLeft: 240, flex: 1, minHeight: '100vh', overflowY: 'auto' }}>
        {renderPage()}
      </main>
    </div>
  )
}
