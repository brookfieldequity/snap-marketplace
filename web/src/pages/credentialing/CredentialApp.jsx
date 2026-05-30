import React, { useEffect, useState } from 'react'
import { credentialAPI } from '../../api.js'
import CredentialSidebar from '../../components/CredentialSidebar.jsx'
import CredentialLoginPage from './CredentialLoginPage.jsx'
import CredentialDashboard from './CredentialDashboard.jsx'
import CredentialProviderList from './CredentialProviderList.jsx'
import CredentialProviderFile from './CredentialProviderFile.jsx'
import CredentialSettings from './CredentialSettings.jsx'
import CredentialAuditLog from './CredentialAuditLog.jsx'

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
