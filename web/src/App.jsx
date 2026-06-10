import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import AdminSidebar from './components/AdminSidebar.jsx'
import { facilityAPI } from './api.js'

// Facility pages
import FacilityLoginPage from './pages/FacilityLoginPage.jsx'
import FacilityRegisterPage from './pages/FacilityRegisterPage.jsx'
import FacilityClaimPage from './pages/FacilityClaimPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import PostShiftPage from './pages/PostShiftPage.jsx'
import ShiftsPage from './pages/ShiftsPage.jsx'
import ProvidersPage from './pages/ProvidersPage.jsx'
import FacilityProfilePage from './pages/FacilityProfilePage.jsx'
import SubscriptionPage from './pages/SubscriptionPage.jsx'

// SNAP Shifts pages
import SnapShiftsDashboard from './pages/shifts/SnapShiftsDashboard.jsx'
import InternalRosterPage from './pages/shifts/InternalRosterPage.jsx'
import AvailabilityWindowsPage from './pages/shifts/AvailabilityWindowsPage.jsx'
import ScheduleBuilderPage from './pages/shifts/ScheduleBuilderPage.jsx'
import DailyViewPage from './pages/shifts/DailyViewPage.jsx'
import GapsPage from './pages/shifts/GapsPage.jsx'
import RequestsPage from './pages/shifts/RequestsPage.jsx'
import StaffIQInsightsPage from './pages/shifts/StaffIQInsightsPage.jsx'
import StaffIQCalculatorPage from './pages/shifts/StaffIQCalculatorPage.jsx'
import StaffIQInputsPage from './pages/shifts/StaffIQInputsPage.jsx'
import DataUploadPage from './pages/shifts/DataUploadPage.jsx'
import CoverageTemplatesPage from './pages/shifts/CoverageTemplatesPage.jsx'

// Admin pages
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx'
import AdminProvidersPage from './pages/admin/AdminProvidersPage.jsx'
import AdminFacilitiesPage from './pages/admin/AdminFacilitiesPage.jsx'
import AdminShiftsPage from './pages/admin/AdminShiftsPage.jsx'
import AdminDisputesPage from './pages/admin/AdminDisputesPage.jsx'
import AdminMessagesPage from './pages/admin/AdminMessagesPage.jsx'
import AdminStaffIQPage from './pages/admin/AdminStaffIQPage.jsx'
import AdminLeadsPage from './pages/admin/AdminLeadsPage.jsx'
import AdminWindowsPage from './pages/admin/AdminWindowsPage.jsx'
import AdminIncentivesPage from './pages/admin/AdminIncentivesPage.jsx'
import AdminUploadsPage from './pages/admin/AdminUploadsPage.jsx'
import AdminCredentialUsersPage from './pages/admin/AdminCredentialUsersPage.jsx'
import AdminRoiPage from './pages/admin/AdminRoiPage.jsx'
import CredentialApp from './pages/credentialing/CredentialApp.jsx'

export default function App() {
  // Public claim route — short-circuits all portal / auth logic. When the
  // URL is /facility-claim/{token}, render the claim page exclusively. This
  // is what the recipient sees first after clicking the invite email link.
  // After successful claim, FacilityClaimPage stores snapFacilityToken and
  // hard-redirects to "/" so the normal facility-portal flow takes over.
  const claimMatch = typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/facility-claim\/([^/?#]+)/)
  if (claimMatch) {
    return <FacilityClaimPage token={decodeURIComponent(claimMatch[1])} />
  }

  const [facilityToken, setFacilityToken] = useState(
    () => localStorage.getItem('snapFacilityToken')
  )
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem('snapAdminToken')
  )

  // Facility-side state
  const [facilityPage, setFacilityPage] = useState('dashboard')
  const [facilityName, setFacilityName] = useState('')
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [snapMode, setSnapMode] = useState('MARKETPLACE')

  // Admin-side state
  const [adminPage, setAdminPage] = useState('overview')
  // When AdminFacilitiesPage links into AdminRoiPage with a pre-selected
  // facility, this carries the id through the page switch.
  const [adminRoiFacilityId, setAdminRoiFacilityId] = useState(null)

  // Portal selection state (when not yet logged in)
  // null | 'facility' | 'admin' | 'credential'
  const [portalChoice, setPortalChoice] = useState(
    () => localStorage.getItem('snapCredToken') ? 'credential' : null
  )

  // Load snapMode whenever facilityToken is present
  useEffect(() => {
    if (!facilityToken) return
    facilityAPI.getMe()
      .then((facility) => {
        if (facility.snapMode) setSnapMode(facility.snapMode)
        if (facility.facilityName && !facilityName) setFacilityName(facility.facilityName)
      })
      .catch(() => {
        // Silently ignore — default MARKETPLACE mode stays
      })
  }, [facilityToken])

  function handleFacilityLogin(token, name) {
    localStorage.setItem('snapFacilityToken', token)
    setFacilityToken(token)
    setFacilityName(name || '')
    setFacilityPage('dashboard')
  }

  async function handleModeSwitch(mode) {
    setSnapMode(mode)
    try {
      await facilityAPI.setMode(mode)
    } catch {
      // Silently ignore — local state already updated
    }
  }

  function handleFacilityLogout() {
    localStorage.removeItem('snapFacilityToken')
    setFacilityToken(null)
    setFacilityName('')
    setPortalChoice(null)
    setAuthMode('login')
  }

  function handleAdminLogin(token) {
    localStorage.setItem('snapAdminToken', token)
    setAdminToken(token)
    setAdminPage('overview')
  }

  function handleAdminLogout() {
    localStorage.removeItem('snapAdminToken')
    setAdminToken(null)
    setPortalChoice(null)
  }

  // ── Facility portal ─────────────────────────────────────────────────────────
  if (facilityToken) {
    const isShiftsMode = snapMode === 'SHIFTS' || snapMode === 'BOTH'
    const isMarketplaceMode = snapMode === 'MARKETPLACE' || snapMode === 'BOTH'

    return (
      <div style={{ minHeight: '100vh' }}>
        {/* ── Top navigation bar ─────────────────────────────────────────────── */}
        <header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 56,
            background: '#fff',
            borderBottom: '1px solid #E2E8F0',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          {/* Left: SNAP logo */}
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: '#6366F1',
              letterSpacing: '-0.04em',
              lineHeight: 1,
              width: 200,
            }}
          >
            SNAP
          </div>

          {/* Center: mode toggle pills */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              background: '#F1F5F9',
              borderRadius: 999,
              padding: 3,
            }}
          >
            <button
              onClick={() => handleModeSwitch('SHIFTS')}
              style={{
                padding: '6px 20px',
                borderRadius: 999,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: snapMode === 'SHIFTS' || snapMode === 'BOTH' ? '#6366F1' : 'transparent',
                color: snapMode === 'SHIFTS' || snapMode === 'BOTH' ? '#fff' : '#64748B',
              }}
            >
              SNAP Shifts
            </button>
            <button
              onClick={() => handleModeSwitch('MARKETPLACE')}
              style={{
                padding: '6px 20px',
                borderRadius: 999,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: snapMode === 'MARKETPLACE' || snapMode === 'BOTH' ? '#6366F1' : 'transparent',
                color: snapMode === 'MARKETPLACE' || snapMode === 'BOTH' ? '#fff' : '#64748B',
              }}
            >
              SNAP Marketplace
            </button>
          </div>

          {/* Right: facility name */}
          <div
            style={{
              width: 200,
              textAlign: 'right',
              fontSize: 13,
              fontWeight: 600,
              color: '#475569',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {facilityName}
          </div>
        </header>

        {/* ── Body below header ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 56 }}>
          <Sidebar
            activePage={facilityPage}
            onNavigate={setFacilityPage}
            facilityName={facilityName}
            onLogout={handleFacilityLogout}
            snapMode={snapMode}
          />
          <main style={{ flex: 1, marginLeft: 240, minHeight: 'calc(100vh - 56px)', background: '#F8FAFC' }}>
            {/* SNAP Shifts pages */}
            {isShiftsMode && facilityPage === 'shifts-dashboard' && (
              <SnapShiftsDashboard onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'roster' && (
              <InternalRosterPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'windows' && (
              <AvailabilityWindowsPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'schedule' && (
              <ScheduleBuilderPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'daily' && (
              <DailyViewPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'coverage-templates' && (
              <CoverageTemplatesPage />
            )}
            {isShiftsMode && facilityPage === 'requests' && (
              <RequestsPage />
            )}
            {isShiftsMode && facilityPage === 'gaps' && (
              <GapsPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'staffiq' && (
              <StaffIQInsightsPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'calculator' && (
              <StaffIQCalculatorPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'staffiq-inputs' && (
              <StaffIQInputsPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'data-upload' && (
              <DataUploadPage onNavigate={setFacilityPage} />
            )}

            {/* SNAP Marketplace pages */}
            {facilityPage === 'dashboard' && (
              <DashboardPage
                onNavigate={setFacilityPage}
                onFacilityNameLoaded={setFacilityName}
                snapMode={snapMode}
              />
            )}
            {facilityPage === 'post-shift' && (
              <PostShiftPage onNavigate={setFacilityPage} />
            )}
            {facilityPage === 'shifts' && (
              <ShiftsPage onNavigate={setFacilityPage} />
            )}
            {facilityPage === 'providers' && (
              <ProvidersPage />
            )}
            {facilityPage === 'profile' && (
              <FacilityProfilePage />
            )}
            {facilityPage === 'subscription' && (
              <SubscriptionPage />
            )}
          </main>
        </div>
      </div>
    )
  }

  // ── Admin panel ─────────────────────────────────────────────────────────────
  if (adminToken) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <AdminSidebar
          activePage={adminPage}
          onNavigate={setAdminPage}
          onLogout={handleAdminLogout}
        />
        <main style={{ flex: 1, marginLeft: 240, minHeight: '100vh', background: '#F8FAFC' }}>
          {adminPage === 'overview'          && <AdminOverviewPage />}
          {adminPage === 'providers'         && <AdminProvidersPage />}
          {adminPage === 'facilities'        && (
            <AdminFacilitiesPage
              onOpenRoi={(facilityId) => {
                setAdminRoiFacilityId(facilityId)
                setAdminPage('roi')
              }}
            />
          )}
          {adminPage === 'shifts'            && <AdminShiftsPage />}
          {adminPage === 'disputes'          && <AdminDisputesPage />}
          {adminPage === 'messages'          && <AdminMessagesPage />}
          {adminPage === 'staffiq-analytics' && <AdminStaffIQPage />}
          {adminPage === 'roi'               && <AdminRoiPage preselectedFacilityId={adminRoiFacilityId} />}
          {adminPage === 'leads'             && <AdminLeadsPage />}
          {adminPage === 'admin-windows'     && <AdminWindowsPage />}
          {adminPage === 'admin-incentives'  && <AdminIncentivesPage />}
          {adminPage === 'admin-uploads'     && <AdminUploadsPage />}
          {adminPage === 'credential-users' && <AdminCredentialUsersPage />}
        </main>
      </div>
    )
  }

  // ── Credentialing portal ────────────────────────────────────────────────────
  if (portalChoice === 'credential') {
    return <CredentialApp onBack={() => setPortalChoice(null)} />
  }

  // ── Portal choice / auth ────────────────────────────────────────────────────
  if (portalChoice === 'facility') {
    if (authMode === 'register') {
      return (
        <FacilityRegisterPage
          onLogin={handleFacilityLogin}
          onBack={() => setAuthMode('login')}
        />
      )
    }
    return (
      <FacilityLoginPage
        onLogin={handleFacilityLogin}
        onRegister={() => setAuthMode('register')}
        onBack={() => setPortalChoice(null)}
      />
    )
  }

  if (portalChoice === 'admin') {
    return (
      <AdminLoginPage
        onLogin={handleAdminLogin}
        onBack={() => setPortalChoice(null)}
      />
    )
  }

  // ── Landing choice ──────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 56 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: '#6366F1',
            letterSpacing: '-0.06em',
            lineHeight: 1,
          }}
        >
          SNAP
        </div>
        <div style={{ fontSize: 18, color: '#64748B', marginTop: 10, fontWeight: 400 }}>
          Healthcare Staffing Marketplace
        </div>
      </div>

      {/* Choice cards */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => setPortalChoice('credential')}
          style={{
            width: 280,
            padding: '40px 32px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 20,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(12px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(16,185,129,0.08)'
            e.currentTarget.style.borderColor = 'rgba(16,185,129,0.6)'
            e.currentTarget.style.transform = 'translateY(-4px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            e.currentTarget.style.borderColor = 'rgba(16,185,129,0.3)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F1F5F9', marginBottom: 8 }}>
            Credentialing
          </div>
          <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6 }}>
            Manage provider credentials, expirations, and passport verification for your facility.
          </div>
          <div
            style={{
              marginTop: 24,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#10B981',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Credentialing Portal →
          </div>
        </button>

        <button
          onClick={() => setPortalChoice('facility')}
          style={{
            width: 280,
            padding: '40px 32px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 20,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(12px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(99,102,241,0.12)'
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)'
            e.currentTarget.style.transform = 'translateY(-4px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>🏥</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F1F5F9', marginBottom: 8 }}>
            I'm a Facility
          </div>
          <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6 }}>
            Post shifts, manage providers, and track your cost savings vs. agency rates.
          </div>
          <div
            style={{
              marginTop: 24,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#6366F1',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Access Portal →
          </div>
        </button>

        <button
          onClick={() => setPortalChoice('admin')}
          style={{
            width: 280,
            padding: '40px 32px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(12px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
            e.currentTarget.style.transform = 'translateY(-4px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔐</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F1F5F9', marginBottom: 8 }}>
            SNAP Admin
          </div>
          <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6 }}>
            Platform administration, credentialing, analytics, and dispute resolution.
          </div>
          <div
            style={{
              marginTop: 24,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#94A3B8',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Admin Panel →
          </div>
        </button>
      </div>

      <div style={{ marginTop: 48, fontSize: 13, color: '#334155' }}>
        Are you a provider?{' '}
        <span style={{ color: '#6366F1', fontWeight: 600 }}>Download the SNAP mobile app</span>
      </div>
    </div>
  )
}
