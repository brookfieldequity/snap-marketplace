import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../api.js'
import StatusBadge from '../components/StatusBadge.jsx'
import FacilitySetupChecklist from '../components/FacilitySetupChecklist.jsx'

function fmt(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function SavingsCard({ label, period, agencyCost, snapCost, savings, isShiftsMode }) {
  const savingsPct = agencyCost > 0 ? Math.round((savings / agencyCost) * 100) : 0

  return (
    <div
      style={{
        flex: 1,
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        borderRadius: 20,
        padding: '32px 36px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
        border: '1px solid rgba(37,99,235,0.2)',
      }}
    >
      {/* Decorative glow */}
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 200,
          height: 200,
          background: 'radial-gradient(circle, rgba(37,99,235,0.25) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -40,
          left: -40,
          width: 160,
          height: 160,
          background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Period label */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', marginBottom: 4 }}>
        {period.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginBottom: 28 }}>
        {label}
      </div>

      {/* SAVINGS — hero number */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, color: '#64748B', fontWeight: 500, marginBottom: 6 }}>
          You Saved
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: '#10B981',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            textShadow: '0 0 40px rgba(16,185,129,0.35)',
          }}
        >
          {fmt(savings)}
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: 20,
            padding: '4px 12px',
          }}
        >
          <span style={{ fontSize: 16 }}>📉</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#10B981' }}>
            {isShiftsMode
              ? '10-20% below industry staffing standards'
              : `${savingsPct}% below agency rates`}
          </span>
        </div>
      </div>

      {/* Breakdown */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>Agency would have cost</div>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#94A3B8',
              textDecoration: 'line-through',
              textDecorationColor: '#EF4444',
            }}
          >
            {fmt(agencyCost)}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>SNAP total cost</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#A5B4FC' }}>
            {fmt(snapCost)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: '#334155', fontStyle: 'italic' }}>
        vs. agency average rates
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color = '#2563EB', sub }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: '20px 24px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', letterSpacing: '0.04em' }}>
          {label}
        </div>
        <div style={{ fontSize: 20 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function DashboardPage({ onNavigate, onFacilityNameLoaded, snapMode }) {
  const [data, setData] = useState(null)
  const [facility, setFacility] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState({})

  useEffect(() => {
    Promise.allSettled([
      facilityAPI.getDashboard(),
      facilityAPI.getMe(),
    ]).then(([dRes, fRes]) => {
      // Never fabricate data — if the dashboard call fails, render the empty
      // state rather than placeholder/demo numbers a real customer would see.
      setData(dRes.status === 'fulfilled' ? dRes.value : null)
      if (fRes.status === 'fulfilled') {
        setFacility(fRes.value)
        if (fRes.value?.name && onFacilityNameLoaded) onFacilityNameLoaded(fRes.value.name)
      }
      setLoading(false)
    })
  }, [])

  async function handleApplication(shiftId, applicationId, action) {
    const key = `${shiftId}-${applicationId}-${action}`
    setActionLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await facilityAPI.reviewApplication(shiftId, applicationId, action)
      // Refresh
      const updated = await facilityAPI.getDashboard()
      setData(updated)
    } catch {
      alert('Action failed. Please try again.')
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  async function handleConfirmDeposit(shiftId) {
    setActionLoading((prev) => ({ ...prev, [shiftId]: true }))
    try {
      await facilityAPI.confirmDeposit(shiftId)
      const updated = await facilityAPI.getDashboard()
      setData(updated)
    } catch {
      alert('Failed to confirm deposit. Please try again.')
    } finally {
      setActionLoading((prev) => ({ ...prev, [shiftId]: false }))
    }
  }

  const d = data || {}
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const facilityName = facility?.name || d.facilityName
  const isShiftsMode = snapMode === 'SHIFTS'

  // Map the real /me/dashboard response shape:
  //   { shifts:{total,open,filled,completed,depositPending,fillRate},
  //     upcoming:[…], pendingApplications:[…],
  //     savings:{thisMonth:{snapCost,agencyCost,savings}, yearToDate:{…}} }
  const shiftStats = d.shifts || {}
  const stats = {
    totalShifts: shiftStats.total || 0,
    fillRate:    shiftStats.fillRate || 0,
    open:        shiftStats.open || 0,
    filled:      shiftStats.filled || 0,
    completed:   shiftStats.completed || 0,
  }
  const depositCount = shiftStats.depositPending || 0

  const month = (d.savings && d.savings.thisMonth) || {}
  const ytd   = (d.savings && d.savings.yearToDate) || {}
  // In SHIFTS mode the savings are StaffIQ-attributed (a portion of the
  // marketplace-equivalent figure); marketplace mode shows the full delta.
  const monthSavings = isShiftsMode ? Math.round((month.savings || 0) * 0.75) : (month.savings || 0)
  const ytdSavings   = isShiftsMode ? Math.round((ytd.savings || 0) * 0.75)   : (ytd.savings || 0)

  const upcomingShifts = (d.upcoming || []).map((s) => ({
    id: s.id,
    date: s.date,
    specialty: s.specialty,
    startTime: s.startTime,
    duration: s.durationHours,
    status: s.status,
    providerName: s.booking?.provider
      ? `${s.booking.provider.firstName || ''} ${s.booking.provider.lastName || ''}`.trim()
      : null,
  }))

  const pendingApplications = (d.pendingApplications || []).map((a) => ({
    id: a.id,
    shiftId: a.shift?.id,
    applicationId: a.id,
    providerName: a.provider
      ? `${a.provider.firstName || ''} ${a.provider.lastName || ''}`.trim()
      : 'Provider',
    specialty: a.provider?.specialty || a.shift?.specialty,
    date: a.shift?.date,
  }))

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
            {greeting}, {facilityName || 'there'} 👋
          </h1>
          <p style={{ fontSize: 15, color: '#64748B', marginTop: 4 }}>
            Here's your staffing overview
          </p>
        </div>
        <button
          onClick={() => onNavigate('post-shift')}
          style={{
            padding: '12px 24px',
            background: '#2563EB',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#1D4ED8'
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(37,99,235,0.5)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#2563EB'
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 14px rgba(37,99,235,0.4)'
          }}
        >
          <span style={{ fontSize: 18 }}>+</span>
          Post a Shift
        </button>
      </div>

      {/* ── First-impression setup checklist — guides Ryan / new coordinators
            through the "Matt set this up for me" moment. Self-hides once
            everything is configured. ──────────────────────────────────────── */}
      <FacilitySetupChecklist facility={facility || data} onNavigate={onNavigate} />

      {/* ── COST SAVINGS — most important section ──────────────────────────── */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 20 }}>💰</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
            Your Cost Savings
          </h2>
          <div
            style={{
              background: isShiftsMode ? '#EFF6FF' : '#ECFDF5',
              border: isShiftsMode ? '1px solid #A5B4FC' : '1px solid #6EE7B7',
              color: isShiftsMode ? '#1D4ED8' : '#059669',
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 20,
              letterSpacing: '0.04em',
            }}
          >
            {isShiftsMode ? 'from StaffIQ™ Insights' : 'vs. Agency Rates'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          <SavingsCard
            label="Cost Savings"
            period="This Month"
            agencyCost={month.agencyCost || 0}
            snapCost={month.snapCost || 0}
            savings={monthSavings}
            isShiftsMode={isShiftsMode}
          />
          <SavingsCard
            label="Cost Savings"
            period="Year to Date"
            agencyCost={ytd.agencyCost || 0}
            snapCost={ytd.snapCost || 0}
            savings={ytdSavings}
            isShiftsMode={isShiftsMode}
          />
        </div>

        {/* Totals banner */}
        <div
          style={{
            marginTop: 16,
            background: 'linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(37,99,235,0.06) 100%)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 12,
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🏆</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>
              Total all-time savings with SNAP
            </span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#10B981', letterSpacing: '-0.03em' }}>
            {fmt(ytdSavings)}
          </div>
        </div>
        {isShiftsMode && (
          <div style={{ marginTop: 8, textAlign: 'right', fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>
            Powered by StaffIQ™
          </div>
        )}
      </div>

      {/* ── Stats Row ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 16,
          marginBottom: 36,
        }}
      >
        <StatCard label="TOTAL SHIFTS"  value={stats.totalShifts || 0}  icon="📋" color="#0F172A" />
        <StatCard label="FILL RATE"     value={`${stats.fillRate || 0}%`} icon="🎯" color="#2563EB" />
        <StatCard label="OPEN"          value={stats.open || 0}           icon="🔵" color="#3B82F6" />
        <StatCard label="FILLED"        value={stats.filled || 0}         icon="🟡" color="#F59E0B" />
        <StatCard label="COMPLETED"     value={stats.completed || 0}      icon="✅" color="#10B981" />
      </div>

      {/* ── Deposit Required ───────────────────────────────────────────────────
            The dashboard endpoint returns a count only; per-shift confirmation
            lives on the Shifts page. Show an actionable banner, never fake rows. */}
      {depositCount > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              background: '#FFF',
              border: '1px solid #FCD34D',
              borderLeft: '4px solid #F59E0B',
              borderRadius: 12,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#0F172A' }}>
                {depositCount} shift{depositCount === 1 ? '' : 's'} need{depositCount === 1 ? 's' : ''} a deposit to go live
              </span>
            </div>
            <button
              onClick={() => onNavigate('shifts')}
              style={{
                padding: '9px 20px',
                background: '#F59E0B',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Review in Shifts →
            </button>
          </div>
        </div>
      )}

      {/* ── Pending Applications ────────────────────────────────────────────── */}
      {pendingApplications.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>👤</span> Pending Applications
            <span style={{ background: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: '1px solid #A5B4FC' }}>
              {pendingApplications.length}
            </span>
          </h2>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            {pendingApplications.map((app, i) => (
              <div
                key={app.id || i}
                style={{
                  padding: '16px 20px',
                  borderBottom: i < pendingApplications.length - 1 ? '1px solid #F1F5F9' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #2563EB, #1E3A8A)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 15,
                      flexShrink: 0,
                    }}
                  >
                    {(app.providerName || 'P').charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#0F172A' }}>
                      {app.providerName}
                    </div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>
                      {app.specialty} · Shift: {app.date}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleApplication(app.shiftId, app.applicationId, 'approve')}
                    disabled={actionLoading[`${app.shiftId}-${app.applicationId}-approve`]}
                    style={{
                      padding: '8px 18px',
                      background: '#10B981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleApplication(app.shiftId, app.applicationId, 'reject')}
                    disabled={actionLoading[`${app.shiftId}-${app.applicationId}-reject`]}
                    style={{
                      padding: '8px 18px',
                      background: '#fff',
                      color: '#EF4444',
                      border: '1px solid #FCA5A5',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upcoming Shifts ─────────────────────────────────────────────────── */}
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📅</span> Upcoming Shifts (Next 7 Days)
        </h2>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          {upcomingShifts.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
              No upcoming shifts in the next 7 days.{' '}
              <button onClick={() => onNavigate('post-shift')} style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Post one now →
              </button>
            </div>
          ) : (
            upcomingShifts.map((shift, i) => (
              <div
                key={shift.id}
                style={{
                  padding: '16px 20px',
                  borderBottom: i < upcomingShifts.length - 1 ? '1px solid #F1F5F9' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    style={{
                      textAlign: 'center',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: 10,
                      padding: '8px 12px',
                      minWidth: 52,
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>
                      {new Date(shift.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>
                      {new Date(shift.date).getDate() + 1}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#0F172A' }}>
                      {shift.specialty}
                    </div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>
                      {shift.startTime} · {shift.duration}h
                      {shift.providerName && (
                        <span> · <span style={{ color: '#2563EB', fontWeight: 500 }}>{shift.providerName}</span></span>
                      )}
                    </div>
                  </div>
                </div>
                <StatusBadge status={shift.status} />
              </div>
            ))
          )}
        </div>
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          <button
            onClick={() => onNavigate('shifts')}
            style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            View all shifts →
          </button>
        </div>
      </div>
    </div>
  )
}
