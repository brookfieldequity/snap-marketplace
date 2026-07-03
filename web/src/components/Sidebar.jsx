import React, { useState, useEffect } from 'react'

// SNAP Shifts navigation — a mix of standalone items and collapsible groups.
// type 'item'  → a single nav link
// type 'group' → a collapsible header whose `items` render when expanded
const SHIFTS_NAV = [
  { type: 'item', key: 'shifts-dashboard', label: 'Dashboard',  icon: '📊' },
  { type: 'item', key: 'daily',            label: 'Daily View',  icon: '📍' },
  {
    type: 'group',
    id: 'scheduling',
    label: 'Scheduling Tools',
    icon: '📅',
    items: [
      { key: 'schedule',          label: 'Schedule Builder',     icon: '📅' },
      { key: 'coverage-templates',label: 'Coverage Templates',   icon: '🧩' },
      { key: 'windows',           label: 'Availability Windows', icon: '🗓' },
      { key: 'availability',      label: 'Set Availability',     icon: '✅' },
      { key: 'requests',          label: 'Provider Requests',    icon: '✋' },
      { key: 'pto-builder',       label: 'PTO Builder',          icon: '🌴', flag: 'pto_builder' },
    ],
  },
  {
    type: 'group',
    id: 'staffiq',
    label: 'StaffIQ',
    icon: '🧠',
    items: [
      { key: 'staffiq',        label: 'StaffIQ Insights',   icon: '🧠' },
      { key: 'staffiq-inputs', label: 'StaffIQ Data Input', icon: '📝' },
      { key: 'gaps',           label: 'Gaps & Incentives',  icon: '🔴' },
      { key: 'data-upload',    label: 'Data Upload',        icon: '📤' },
      { key: 'calculator',     label: 'Calculator',         icon: '🧮' },
    ],
  },
  { type: 'item', key: 'roster', label: 'Internal Roster', icon: '👥' },
]

const MARKETPLACE_ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',   icon: '🏠' },
  { key: 'post-shift', label: 'Post a Shift', icon: '➕' },
  { key: 'shifts',     label: 'My Shifts',   icon: '📋' },
]

// SNAP Ops (practice management) — payroll + agency back-office. Its own
// top-level capability, toggled from the header; shown when payroll_builder is on.
const OPS_ITEMS = [
  { key: 'hour-entry',     label: 'Provider Hours',  icon: '⏱' },
  { key: 'payroll',        label: 'Payroll Builder', icon: '💵' },
  { key: 'payroll-history',label: 'Payroll History', icon: '🧾' },
  { key: 'agency-invoice', label: 'Agency Invoice',  icon: '📑' },
  { key: 'agency-metrics', label: 'Profitability',   icon: '📈' },
]

const SHARED_ITEMS = [
  { key: 'providers',    label: 'Provider Management', icon: '👩‍⚕️' },
  { key: 'profile',      label: 'Facility Profile',    icon: '🏥' },
  { key: 'subscription', label: 'Subscription',        icon: '⭐' },
]

// Apply feature-flag filtering to the SNAP Shifts nav: drop flagged items and
// any group that ends up empty, and respect a flag set on the group itself.
function filterShiftsNav(featureFlags) {
  return SHIFTS_NAV.flatMap((node) => {
    if (node.type === 'item') {
      return !node.flag || featureFlags[node.flag] ? [node] : []
    }
    if (node.flag && !featureFlags[node.flag]) return []
    const items = node.items.filter((it) => !it.flag || featureFlags[it.flag])
    return items.length ? [{ ...node, items }] : []
  })
}

// Which group (if any) contains the given page key.
function groupIdForPage(nav, pageKey) {
  for (const node of nav) {
    if (node.type === 'group' && node.items.some((it) => it.key === pageKey)) {
      return node.id
    }
  }
  return null
}

function Chevron({ open }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.18s ease',
        flexShrink: 0,
      }}
    >
      <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NavItem({ item, isActive, onNavigate, indented = false }) {
  return (
    <button
      onClick={() => onNavigate(item.key)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: indented ? 10 : 12,
        width: '100%',
        padding: indented ? '9px 24px 9px 46px' : '11px 24px',
        background: isActive
          ? 'linear-gradient(90deg, rgba(37,99,235,0.2) 0%, rgba(37,99,235,0.05) 100%)'
          : 'transparent',
        border: 'none',
        borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
        color: isActive ? '#A5B4FC' : '#64748B',
        fontSize: indented ? 13 : 14,
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
      <span style={{ fontSize: indented ? 14 : 16 }}>{item.icon}</span>
      <span>{item.label}</span>
    </button>
  )
}

function GroupHeader({ group, open, hasActiveChild, onToggle }) {
  // When collapsed but holding the active page, tint the header so the user
  // still knows where they are.
  const accent = open ? false : hasActiveChild
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '11px 24px',
        background: accent ? 'rgba(37,99,235,0.06)' : 'transparent',
        border: 'none',
        borderLeft: accent ? '3px solid rgba(37,99,235,0.6)' : '3px solid transparent',
        color: accent ? '#A5B4FC' : '#94A3B8',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!accent) {
          e.currentTarget.style.color = '#CBD5E1'
          e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
        }
      }}
      onMouseLeave={(e) => {
        if (!accent) {
          e.currentTarget.style.color = '#94A3B8'
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      <span style={{ fontSize: 16 }}>{group.icon}</span>
      <span style={{ flex: 1 }}>{group.label}</span>
      <Chevron open={open} />
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

export default function Sidebar({ activePage, onNavigate, facilityName, onLogout, activeTab, featureFlags = {}, narrow = false, open = false, onClose, tabs = [], onTab, topOffset = 56 }) {
  // The header toggle picks one capability at a time; the sidebar shows just
  // that tab's nav (+ the always-on Account section) for a tidy menu.
  const shiftsNav = filterShiftsNav(featureFlags)

  // Track which collapsible groups are open. Default: everything collapsed
  // except the group containing the active page, so the menu starts tidy.
  const [openGroups, setOpenGroups] = useState(() => {
    const g = groupIdForPage(shiftsNav, activePage)
    return g ? { [g]: true } : {}
  })

  // When navigation moves into a collapsed group, auto-expand it (but never
  // auto-close a group the user opened themselves).
  useEffect(() => {
    const g = groupIdForPage(shiftsNav, activePage)
    if (g) setOpenGroups((prev) => (prev[g] ? prev : { ...prev, [g]: true }))
  }, [activePage]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (id) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))

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
    <aside
      style={{
        width: 240,
        background: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: narrow ? topOffset : 56,
        left: 0,
        bottom: 0,
        zIndex: narrow ? 400 : 100,
        overflow: 'hidden',
        // Off-canvas on phones; desktop keeps the always-visible column.
        transform: narrow && !open ? 'translateX(-100%)' : 'translateX(0)',
        transition: narrow ? 'transform 0.25s ease' : 'none',
        boxShadow: narrow && open ? '8px 0 30px rgba(0,0,0,0.35)' : 'none',
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

      {/* Capability switcher — lives in the drawer on phones (the header pills
          are hidden there). Desktop keeps the header pills; this never shows. */}
      {narrow && tabs.length > 1 && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 6 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab && onTab(t.key)}
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: t.active ? '#2563EB' : 'rgba(255,255,255,0.06)',
                color: t.active ? '#fff' : '#94A3B8',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {/* SNAP Shifts section */}
        {activeTab === 'shifts' && (
          <>
            <SectionHeader label="SNAP Shifts" />
            {shiftsNav.map((node) => {
              if (node.type === 'item') {
                return (
                  <NavItem
                    key={node.key}
                    item={node}
                    isActive={activePage === node.key}
                    onNavigate={navigate}
                  />
                )
              }
              const open = !!openGroups[node.id]
              const hasActiveChild = node.items.some((it) => it.key === activePage)
              return (
                <div key={node.id}>
                  <GroupHeader
                    group={node}
                    open={open}
                    hasActiveChild={hasActiveChild}
                    onToggle={() => toggleGroup(node.id)}
                  />
                  {open &&
                    node.items.map((it) => (
                      <NavItem
                        key={it.key}
                        item={it}
                        isActive={activePage === it.key}
                        onNavigate={navigate}
                        indented
                      />
                    ))}
                </div>
              )
            })}
            <Divider />
          </>
        )}

        {/* SNAP Marketplace section */}
        {activeTab === 'marketplace' && (
          <>
            <SectionHeader label="SNAP Marketplace" />
            {MARKETPLACE_ITEMS.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                isActive={activePage === item.key}
                onNavigate={navigate}
              />
            ))}
            <Divider />
          </>
        )}

        {/* SNAP Ops section (practice management) */}
        {activeTab === 'ops' && (
          <>
            <SectionHeader label="SNAP Ops" />
            {OPS_ITEMS.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                isActive={activePage === item.key}
                onNavigate={navigate}
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
            onNavigate={navigate}
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
    </>
  )
}
