import React, { useState, useEffect, lazy, Suspense } from 'react'
import { facilityAPI, authAPI, credentialAPI } from './api.js'
import useIsNarrow from './lib/useIsNarrow.js'

// ── Eager imports — everything a first paint can need ─────────────────────────
// Public token pages (no login; the SMS/email link IS the first impression) and
// the login/landing screens stay in the entry bundle so they render instantly.
import AvailabilityPage from './pages/public/AvailabilityPage.jsx'
import RoomCountPage from './pages/public/RoomCountPage.jsx'
import FacilityClaimPage from './pages/FacilityClaimPage.jsx'
import PtoRankPage from './pages/PtoRankPage.jsx'
import SmsTermsPage from './pages/SmsTermsPage.jsx'
import FacilityLoginPage from './pages/FacilityLoginPage.jsx'
import FacilityRegisterPage from './pages/FacilityRegisterPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import Sidebar from './components/Sidebar.jsx'
import SnappyWidget from './components/SnappyWidget.jsx'
import AdminSidebar from './components/AdminSidebar.jsx'

// ── Lazy imports — portal pages load on demand (code-splitting) ────────────────
// Each page becomes its own chunk fetched the first time it renders, so a
// provider opening /avail/:token never downloads the portals. If a fetch fails
// because a deploy replaced the old hashed chunks, reload once to pick up the
// new build (the auto-updater in lib/autoUpdate.js usually gets there first).
const lazyPage = (loader) => lazy(() =>
  loader()
    .then((m) => { sessionStorage.removeItem('snapChunkReload'); return m })
    .catch((err) => {
      if (!sessionStorage.getItem('snapChunkReload')) {
        sessionStorage.setItem('snapChunkReload', '1')
        window.location.reload()
      }
      throw err
    })
)

// Facility marketplace pages
const DashboardPage       = lazyPage(() => import('./pages/DashboardPage.jsx'))
const PostShiftPage       = lazyPage(() => import('./pages/PostShiftPage.jsx'))
const ShiftsPage          = lazyPage(() => import('./pages/ShiftsPage.jsx'))
const ProvidersPage       = lazyPage(() => import('./pages/ProvidersPage.jsx'))
const FacilityProfilePage = lazyPage(() => import('./pages/FacilityProfilePage.jsx'))
const SubscriptionPage    = lazyPage(() => import('./pages/SubscriptionPage.jsx'))

// SNAP Shifts pages
const SnapShiftsDashboard      = lazyPage(() => import('./pages/shifts/SnapShiftsDashboard.jsx'))
const InternalRosterPage       = lazyPage(() => import('./pages/shifts/InternalRosterPage.jsx'))
const AvailabilityWindowsPage  = lazyPage(() => import('./pages/shifts/AvailabilityWindowsPage.jsx'))
const FacilityAvailabilityPage = lazyPage(() => import('./pages/shifts/FacilityAvailabilityPage.jsx'))
const RoomCountRequestsPage    = lazyPage(() => import('./pages/shifts/RoomCountRequestsPage.jsx'))
const ScheduleBuilderPage      = lazyPage(() => import('./pages/shifts/ScheduleBuilderPage.jsx'))
const DailyViewPage            = lazyPage(() => import('./pages/shifts/DailyViewPage.jsx'))
const GapsPage                 = lazyPage(() => import('./pages/shifts/GapsPage.jsx'))
const RequestsPage             = lazyPage(() => import('./pages/shifts/RequestsPage.jsx'))
const StaffIQInsightsPage      = lazyPage(() => import('./pages/shifts/StaffIQInsightsPage.jsx'))
const StaffIQCalculatorPage    = lazyPage(() => import('./pages/shifts/StaffIQCalculatorPage.jsx'))
const StaffIQInputsPage        = lazyPage(() => import('./pages/shifts/StaffIQInputsPage.jsx'))
const DataUploadPage           = lazyPage(() => import('./pages/shifts/DataUploadPage.jsx'))
const CoverageTemplatesPage    = lazyPage(() => import('./pages/shifts/CoverageTemplatesPage.jsx'))
const PtoPage                  = lazyPage(() => import('./pages/shifts/PtoPage.jsx'))

// SNAP Ops pages
const PayrollBuilderPage  = lazyPage(() => import('./pages/shifts/PayrollBuilderPage.jsx'))
const PayrollHistoryPage  = lazyPage(() => import('./pages/shifts/PayrollHistoryPage.jsx'))
const AgencyInvoicePage   = lazyPage(() => import('./pages/shifts/AgencyInvoicePage.jsx'))
const HourEntryPage       = lazyPage(() => import('./pages/shifts/HourEntryPage.jsx'))
const AgencyMetricsPage   = lazyPage(() => import('./pages/shifts/AgencyMetricsPage.jsx'))

// Admin pages
const AdminOverviewPage        = lazyPage(() => import('./pages/admin/AdminOverviewPage.jsx'))
const AdminProvidersPage       = lazyPage(() => import('./pages/admin/AdminProvidersPage.jsx'))
const AdminFacilitiesPage      = lazyPage(() => import('./pages/admin/AdminFacilitiesPage.jsx'))
const AdminShiftsPage          = lazyPage(() => import('./pages/admin/AdminShiftsPage.jsx'))
const AdminDisputesPage        = lazyPage(() => import('./pages/admin/AdminDisputesPage.jsx'))
const AdminMessagesPage        = lazyPage(() => import('./pages/admin/AdminMessagesPage.jsx'))
const AdminStaffIQPage         = lazyPage(() => import('./pages/admin/AdminStaffIQPage.jsx'))
const AdminLeadsPage           = lazyPage(() => import('./pages/admin/AdminLeadsPage.jsx'))
const AdminWindowsPage         = lazyPage(() => import('./pages/admin/AdminWindowsPage.jsx'))
const AdminIncentivesPage      = lazyPage(() => import('./pages/admin/AdminIncentivesPage.jsx'))
const AdminUploadsPage         = lazyPage(() => import('./pages/admin/AdminUploadsPage.jsx'))
const AdminCredentialUsersPage = lazyPage(() => import('./pages/admin/AdminCredentialUsersPage.jsx'))
const AdminRoiPage             = lazyPage(() => import('./pages/admin/AdminRoiPage.jsx'))
const AdminMarketplaceFeesPage = lazyPage(() => import('./pages/admin/AdminMarketplaceFeesPage.jsx'))
const AdminFeatureFlagsPage    = lazyPage(() => import('./pages/admin/AdminFeatureFlagsPage.jsx'))
const AdminDemoPage            = lazyPage(() => import('./pages/admin/AdminDemoPage.jsx'))
const AdminInvoicesPage        = lazyPage(() => import('./pages/admin/AdminInvoicesPage.jsx'))

// Credentialing portal
const CredentialApp = lazyPage(() => import('./pages/credentialing/CredentialApp.jsx'))

// Shown while a lazily loaded portal page's chunk is fetched (usually <100ms).
function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, color: '#94A3B8', fontSize: 14 }}>
      Loading…
    </div>
  )
}

export default function App() {
  // Public claim route — short-circuits all portal / auth logic. When the
  // URL is /facility-claim/{token}, render the claim page exclusively. This
  // is what the recipient sees first after clicking the invite email link.
  // After successful claim, FacilityClaimPage stores snapFacilityToken and
  // hard-redirects to "/" so the normal facility-portal flow takes over.
  // Public provider availability self-submission — /avail/:token
  // No login required; the token in the URL is the credential.
  const availMatch = typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/avail\/([^/?#]+)/)
  if (availMatch) {
    return <AvailabilityPage token={decodeURIComponent(availMatch[1])} />
  }

  // Public facility room-count self-submission — /rooms/:token
  // No login required; the token in the URL is the credential.
  const roomsMatch = typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/rooms\/([^/?#]+)/)
  if (roomsMatch) {
    return <RoomCountPage token={decodeURIComponent(roomsMatch[1])} />
  }

  const claimMatch = typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/facility-claim\/([^/?#]+)/)
  if (claimMatch) {
    return <FacilityClaimPage token={decodeURIComponent(claimMatch[1])} />
  }

  // Public messaging-policy page — no login. This is the URL supplied to
  // carriers for SMS (toll-free / A2P) opt-in verification.
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/sms-terms') {
    return <SmsTermsPage />
  }

  // Public PTO ranking route — /pto-rank/{token}. No login: a provider clicks
  // the signed link from their coordinator and ranks their PTO weeks. The
  // token carries the windowId + rosterEntryId (see ptoBuilder route).
  const rankMatch = typeof window !== 'undefined' &&
    window.location.pathname.match(/^\/pto-rank\/([^/?#]+)/)
  if (rankMatch) {
    return <PtoRankPage token={decodeURIComponent(rankMatch[1])} />
  }

  const [facilityToken, setFacilityToken] = useState(() => {
    // Handle ?demoToken=... deep link from the admin "Copy Demo Link" button
    const params = new URLSearchParams(window.location.search)
    const demoTok = params.get('demoToken')
    if (demoTok) {
      localStorage.setItem('snapFacilityToken', demoTok)
      const url = new URL(window.location.href)
      url.searchParams.delete('demoToken')
      window.history.replaceState({}, '', url.toString())
      return demoTok
    }
    return localStorage.getItem('snapFacilityToken')
  })
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem('snapAdminToken')
  )
  const [facilityIsDemo, setFacilityIsDemo] = useState(false)

  // Phone/tablet layout: portal sidebars become off-canvas drawers behind a
  // hamburger button. Desktop (≥860px) renders exactly as before.
  const narrow = useIsNarrow()
  const [navOpen, setNavOpen] = useState(false)

  // Facility-side state. facilityPage starts null: the landing page is chosen
  // by the tab-reconcile effect AFTER capabilities load, so a Shifts facility
  // lands on the Shifts dashboard instead of flashing the marketplace one.
  const [facilityPage, setFacilityPage] = useState(null)
  // True once /facilities/me has answered (or failed) — the tab default must
  // wait for the real snapMode, not the MARKETPLACE placeholder.
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [facilityName, setFacilityName] = useState('')
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [snapMode, setSnapMode] = useState('MARKETPLACE')
  // Effective feature flags for this facility ({ flagName: boolean }). Drives
  // which nav items / pages render. Defaults to empty (everything gated off)
  // until loaded.
  const [featureFlags, setFeatureFlags] = useState({})
  // The active top-level capability tab: 'shifts' | 'marketplace' | 'ops'.
  // null until capabilities (snapMode + flags) load, then reconciled below.
  const [activeTab, setActiveTab] = useState(null)

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
    setCapsLoaded(false)
    facilityAPI.getMe()
      .then((facility) => {
        if (facility.snapMode) setSnapMode(facility.snapMode)
        // The /facilities/me payload exposes the name as `name` (Prisma field);
        // `facilityName` never existed, so on reload the header went blank.
        const resolvedName = facility.name || facility.facilityName
        if (resolvedName && !facilityName) setFacilityName(resolvedName)
        if (facility.isDemo) setFacilityIsDemo(true)
      })
      .catch(() => {
        // Silently ignore — default MARKETPLACE mode stays
      })
      .finally(() => setCapsLoaded(true))
    facilityAPI.getFeatureFlags()
      .then((res) => setFeatureFlags(res.enabled || {}))
      .catch(() => {
        // Silently ignore — flags stay off (features hidden) on failure
      })
  }, [facilityToken])

  // Top-level capability tabs (header toggle), derived from snapMode + flags.
  // SNAP Ops = practice management (payroll), gated by the payroll_builder flag.
  const TAB_META = {
    shifts:      { label: 'SNAP Shifts',      page: 'shifts-dashboard' },
    marketplace: { label: 'SNAP Marketplace', page: 'dashboard' },
    ops:         { label: 'SNAP Ops',         page: 'hour-entry' },
    credentialing: { label: 'Credentialing',  page: null }, // SSO into the portal, not a facility page
  }
  const availableTabs = [
    (snapMode === 'SHIFTS' || snapMode === 'BOTH') && 'shifts',
    (snapMode === 'MARKETPLACE' || snapMode === 'BOTH') && 'marketplace',
    featureFlags.payroll_builder && 'ops',
    'credentialing', // backend enforces facility-ADMIN on exchange
  ].filter(Boolean)

  // Once capabilities load, pick the landing tab: SNAP Shifts first when the
  // facility has it (availableTabs order), marketplace otherwise. Waiting for
  // capsLoaded avoids locking in the MARKETPLACE placeholder before /me answers.
  useEffect(() => {
    if (!facilityToken || !capsLoaded || availableTabs.length === 0) return
    if (!activeTab || !availableTabs.includes(activeTab)) {
      const t = availableTabs[0]
      setActiveTab(t)
      setFacilityPage(TAB_META[t].page)
    } else if (!facilityPage) {
      setFacilityPage(TAB_META[activeTab].page)
    }
  }, [facilityToken, capsLoaded, snapMode, featureFlags]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switch the header tab: change the visible capability and jump to its home page.
  function navigateTab(tab) {
    // Phase 4 unified login: "Credentialing" isn't a facility page — it SSO-
    // exchanges the facility session for a portal session and opens the portal.
    if (tab === 'credentialing') {
      credentialAPI.ssoExchange()
        .then(({ token }) => {
          localStorage.setItem('snapCredToken', token)
          setPortalChoice('credential')
        })
        .catch((err) => {
          alert(err.status === 403
            ? 'The credentialing portal requires facility-admin access.'
            : `Could not open the credentialing portal: ${err.message}`)
        })
      return
    }
    setActiveTab(tab)
    setFacilityPage(TAB_META[tab].page)
  }

  function handleFacilityLogin(token, name) {
    localStorage.setItem('snapFacilityToken', token)
    setFacilityToken(token)
    setFacilityName(name || '')
    // Landing page is chosen by the tab-reconcile effect once /me loads
    // (Shifts dashboard for Shifts/BOTH facilities, marketplace otherwise).
    setActiveTab(null)
    setFacilityPage(null)
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
    authAPI.logout(localStorage.getItem('snapFacilityToken')) // revoke server session (best-effort)
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
    authAPI.logout(localStorage.getItem('snapAdminToken')) // revoke server session (best-effort)
    localStorage.removeItem('snapAdminToken')
    setAdminToken(null)
    setPortalChoice(null)
  }

  // When the server says a session died (expired, revoked, password reset),
  // drop that portal's token and return to login — no half-broken UI making
  // failing API calls with a dead token.
  useEffect(() => {
    const onExpired = (e) => {
      const aud = e.detail?.audience
      if (aud === 'PROVIDER') return // mobile app's concern, not the web portals
      const map = { FACILITY: 'snapFacilityToken', ADMIN: 'snapAdminToken', CREDENTIAL: 'snapCredToken' }
      if (aud && map[aud]) {
        localStorage.removeItem(map[aud])
      } else {
        Object.values(map).forEach((k) => localStorage.removeItem(k))
      }
      window.location.href = '/'
    }
    window.addEventListener('snap:session-expired', onExpired)
    return () => window.removeEventListener('snap:session-expired', onExpired)
  }, [])

  // ── Facility portal ─────────────────────────────────────────────────────────
  // Unified login: the credentialing portal renders ON TOP of an active
  // facility session (the header's Credentialing tab does the SSO exchange
  // then sets portalChoice). Must be checked BEFORE the facility branch or
  // the tab appears to do nothing. Back returns to the facility portal.
  if (portalChoice === 'credential') {
    return (
      <Suspense fallback={<PageLoader />}>
        <CredentialApp onBack={() => setPortalChoice(null)} />
      </Suspense>
    )
  }

  if (facilityToken) {
    const isShiftsMode = snapMode === 'SHIFTS' || snapMode === 'BOTH'
    const isMarketplaceMode = snapMode === 'MARKETPLACE' || snapMode === 'BOTH'
    const isOpsMode = !!featureFlags.payroll_builder

    const demoBannerH = facilityIsDemo ? 36 : 0

    return (
      <div style={{ minHeight: '100vh' }}>
        {/* Demo mode banner — visible above the fixed header */}
        {facilityIsDemo && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 36,
            background: '#FDE68A', color: '#78350F', zIndex: 300,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 20px',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
            borderBottom: '1px solid #F59E0B',
          }}>
            <span />
            <span>DEMO MODE — Maple Ridge ASC — seeded data only</span>
            <button
              onClick={() => {
                const backup = sessionStorage.getItem('snapAdminTokenBackup')
                localStorage.removeItem('snapFacilityToken')
                if (backup) {
                  localStorage.setItem('snapAdminToken', backup)
                  sessionStorage.removeItem('snapAdminTokenBackup')
                }
                window.location.href = '/'
              }}
              style={{
                background: '#92400E', color: '#FDE68A', border: 'none',
                borderRadius: 6, padding: '4px 12px', fontSize: 11,
                fontWeight: 800, cursor: 'pointer', letterSpacing: '0.04em',
              }}
            >
              Exit Demo →
            </button>
          </div>
        )}
        {/* ── Top navigation bar ─────────────────────────────────────────────── */}
        <header
          style={{
            position: 'fixed',
            top: demoBannerH,
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
          {/* Left: hamburger (phone) + SNAP wordmark + mascot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: narrow ? 'auto' : 200 }}>
            {narrow && (
              <button
                onClick={() => setNavOpen((v) => !v)}
                aria-label="Menu"
                style={{
                  width: 38, height: 38, border: '1px solid #E2E8F0', borderRadius: 9,
                  background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155',
                }}
              >
                ☰
              </button>
            )}
            <span style={{ fontSize: 22, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em', lineHeight: 1 }}>SNAP</span>
            {!narrow && <img src="/snappy-mascot.png" alt="" style={{ height: 42, width: 'auto', display: 'block' }} />}
          </div>

          {/* Center: capability toggle pills (desktop; on phones they live in the drawer) */}
          {!narrow && availableTabs.length > 1 && (
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
              {availableTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => navigateTab(tab)}
                  style={{
                    padding: '6px 20px',
                    borderRadius: 999,
                    border: 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: activeTab === tab ? '#2563EB' : 'transparent',
                    color: activeTab === tab ? '#fff' : '#64748B',
                  }}
                >
                  {TAB_META[tab].label}
                </button>
              ))}
            </div>
          )}

          {/* Right: facility name */}
          <div
            style={{
              width: narrow ? undefined : 200,
              maxWidth: narrow ? 160 : undefined,
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
        <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 56 + demoBannerH }}>
          <Sidebar
            activePage={facilityPage}
            onNavigate={setFacilityPage}
            facilityName={facilityName}
            onLogout={handleFacilityLogout}
            activeTab={activeTab}
            featureFlags={featureFlags}
            narrow={narrow}
            open={navOpen}
            onClose={() => setNavOpen(false)}
            topOffset={56 + demoBannerH}
            tabs={availableTabs.map((t) => ({ key: t, label: TAB_META[t].label, active: activeTab === t }))}
            onTab={navigateTab}
          />
          <main style={{ flex: 1, marginLeft: narrow ? 0 : 240, minHeight: 'calc(100vh - 56px)', background: '#F8FAFC' }}>
            <Suspense fallback={<PageLoader />}>
            {/* Brief moment before /me answers and the landing tab is chosen */}
            {!facilityPage && <PageLoader />}
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
            {isShiftsMode && facilityPage === 'availability' && (
              <FacilityAvailabilityPage onNavigate={setFacilityPage} />
            )}
            {isShiftsMode && facilityPage === 'room-counts' && (
              <RoomCountRequestsPage />
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
            {isShiftsMode && (facilityPage === 'pto' || facilityPage === 'pto-builder') && (
              <PtoPage onNavigate={setFacilityPage} featureFlags={featureFlags} />
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
            {isOpsMode && facilityPage ==='payroll' && (
              <PayrollBuilderPage onNavigate={setFacilityPage} />
            )}
            {isOpsMode && facilityPage ==='payroll-history' && (
              <PayrollHistoryPage onNavigate={setFacilityPage} />
            )}
            {isOpsMode && facilityPage ==='agency-invoice' && (
              <AgencyInvoicePage onNavigate={setFacilityPage} />
            )}
            {isOpsMode && facilityPage ==='hour-entry' && (
              <HourEntryPage onNavigate={setFacilityPage} />
            )}
            {isOpsMode && facilityPage ==='agency-metrics' && (
              <AgencyMetricsPage onNavigate={setFacilityPage} />
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
            </Suspense>
          </main>
        </div>
        {/* Snappy AI assistant — facility portal (Task #17) */}
        <SnappyWidget />
      </div>
    )
  }

  // ── Admin panel ─────────────────────────────────────────────────────────────
  if (adminToken) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Phone-only top bar — the admin panel has no desktop header, so the
            hamburger needs somewhere to live on small screens. */}
        {narrow && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 52, zIndex: 300,
            background: '#0F172A', display: 'flex', alignItems: 'center', gap: 12,
            padding: '0 14px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <button
              onClick={() => setNavOpen((v) => !v)}
              aria-label="Menu"
              style={{
                width: 36, height: 36, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9,
                background: 'transparent', cursor: 'pointer', fontSize: 17, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#CBD5E1',
              }}
            >
              ☰
            </button>
            <span style={{ fontSize: 17, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em' }}>SNAP</span>
            <span style={{ fontSize: 11, color: '#A5B4FC', fontWeight: 700, letterSpacing: '0.05em' }}>ADMIN</span>
          </div>
        )}
        <AdminSidebar
          activePage={adminPage}
          onNavigate={setAdminPage}
          onLogout={handleAdminLogout}
          narrow={narrow}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          topOffset={52}
        />
        <main style={{ flex: 1, marginLeft: narrow ? 0 : 240, paddingTop: narrow ? 52 : 0, minHeight: '100vh', background: '#F8FAFC' }}>
          <Suspense fallback={<PageLoader />}>
          {adminPage === 'overview'          && <AdminOverviewPage />}
          {adminPage === 'demo'             && <AdminDemoPage />}
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
          {adminPage === 'marketplace-fees'  && <AdminMarketplaceFeesPage />}
          {adminPage === 'feature-flags'     && <AdminFeatureFlagsPage />}
          {adminPage === 'messages'          && <AdminMessagesPage />}
          {adminPage === 'staffiq-analytics' && <AdminStaffIQPage onNavigate={setAdminPage} />}
          {/* Dedicated sidebar entry that opens straight into presentation mode. */}
          {adminPage === 'pitch-deck'        && <AdminStaffIQPage autoPitch onNavigate={setAdminPage} />}
          {adminPage === 'roi'               && <AdminRoiPage preselectedFacilityId={adminRoiFacilityId} />}
          {adminPage === 'leads'             && <AdminLeadsPage />}
          {adminPage === 'admin-windows'     && <AdminWindowsPage />}
          {adminPage === 'admin-incentives'  && <AdminIncentivesPage />}
          {adminPage === 'admin-uploads'     && <AdminUploadsPage />}
          {adminPage === 'credential-users' && <AdminCredentialUsersPage />}
          {adminPage === 'invoices'         && <AdminInvoicesPage />}
          </Suspense>
        </main>
      </div>
    )
  }

  // ── Credentialing portal ────────────────────────────────────────────────────
  if (portalChoice === 'credential') {
    return (
      <Suspense fallback={<PageLoader />}>
        <CredentialApp onBack={() => setPortalChoice(null)} />
      </Suspense>
    )
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
            color: '#2563EB',
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
            border: '1px solid rgba(37,99,235,0.3)',
            borderRadius: 20,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(12px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(37,99,235,0.12)'
            e.currentTarget.style.borderColor = 'rgba(37,99,235,0.6)'
            e.currentTarget.style.transform = 'translateY(-4px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            e.currentTarget.style.borderColor = 'rgba(37,99,235,0.3)'
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
              color: '#2563EB',
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
        <span style={{ color: '#2563EB', fontWeight: 600 }}>Download the SNAP mobile app</span>
      </div>
    </div>
  )
}
