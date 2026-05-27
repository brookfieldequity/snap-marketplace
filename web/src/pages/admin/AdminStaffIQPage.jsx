import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

function fmt$(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function GarySlide1({ data }) {
  if (!data) return null
  return (
    <div style={{ width: '100%', maxWidth: 900, textAlign: 'center' }}>
      <h2 style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 48 }}>
        {data.title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 32 }}>
        {(data.metrics || []).map((m, i) => (
          <div
            key={i}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 16,
              padding: '28px 24px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              {m.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 14 }}>
              {m.value}
            </div>
            {m.pct != null && (
              <div>
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, width: '100%', overflow: 'hidden' }}>
                  <div style={{ background: '#EF4444', width: `${Math.min(m.pct, 100)}%`, height: '100%', borderRadius: 6 }} />
                </div>
                <div style={{ fontSize: 12, color: '#EF4444', fontWeight: 600, marginTop: 6 }}>{m.pct}% inefficient</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>
        Based on supervision model analysis vs. optimal 1:4 CRNA-to-ANES ratio
      </div>
    </div>
  )
}

function GarySlide2({ data }) {
  if (!data) return null
  const maxRatio = 4.0
  const facilities = [
    {
      name: 'Kenmore',
      weekday: data.kenmoreWeekdayRatio,
      friday: data.kenmoreFridayRatio,
    },
    {
      name: 'Weymouth',
      weekday: data.weymouthWeekdayRatio,
      friday: data.weymouthFridayRatio,
    },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 900, textAlign: 'center' }}>
      <h2 style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 48 }}>
        {data.title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
        {facilities.map((f) => (
          <div
            key={f.name}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 16,
              padding: '28px 28px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: '#818CF8', marginBottom: 20 }}>{f.name}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#10B981', fontWeight: 600, marginBottom: 6 }}>
                Mon–Thu: 1:{f.weekday} CRNA ratio
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 10, width: '100%', overflow: 'hidden' }}>
                <div style={{ background: '#10B981', width: `${(f.weekday / maxRatio) * 100}%`, height: '100%', borderRadius: 6 }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, marginBottom: 6 }}>
                Friday: 1:{f.friday} CRNA ratio
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 10, width: '100%', overflow: 'hidden' }}>
                <div style={{ background: '#EF4444', width: `${(f.friday / maxRatio) * 100}%`, height: '100%', borderRadius: 6 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 24 }}>
        Friday CRNA shortage costs an estimated{' '}
        <span style={{ fontWeight: 700, color: '#FCA5A5' }}>${(data.fridayAnnualPremium ?? 0).toLocaleString()}/year</span>{' '}
        in excess ANES coverage
      </div>
      {data.totalSavingsOpportunity && (
        <div
          style={{
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 12,
            padding: '18px 32px',
            display: 'inline-block',
          }}
        >
          <div style={{ fontSize: 13, color: '#A5B4FC', fontWeight: 600, marginBottom: 4 }}>Total Savings Opportunity</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>
            ${(data.totalSavingsOpportunity.min ?? 0).toLocaleString()} – ${(data.totalSavingsOpportunity.max ?? 0).toLocaleString()}/year
          </div>
        </div>
      )}
    </div>
  )
}

function GarySlide3({ data }) {
  if (!data) return null
  return (
    <div style={{ width: '100%', maxWidth: 800, textAlign: 'center' }}>
      <h2 style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 48 }}>
        {data.title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 48, textAlign: 'left' }}>
        {(data.bullets || []).map((bullet, i) => (
          <div
            key={i}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '18px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#10B981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 900,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              ✓
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{bullet}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#6366F1', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          SNAP Medical
        </div>
        <div style={{ fontSize: 18, color: '#94A3B8', fontStyle: 'italic' }}>
          Ready to see this in action? Let's talk.
        </div>
      </div>
      <div
        style={{
          background: 'rgba(99,102,241,0.15)',
          border: '1px solid rgba(99,102,241,0.5)',
          borderRadius: 12,
          padding: '16px 32px',
          display: 'inline-block',
        }}
      >
        <div style={{ fontSize: 13, color: '#A5B4FC', fontWeight: 600, marginBottom: 4 }}>Combined Opportunity</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>$400,000 – $500,000 in annual savings</div>
      </div>
    </div>
  )
}

export default function AdminStaffIQPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [garyMode, setGaryMode] = useState(false)
  const [garyPage, setGaryPage] = useState(0)
  const [garyData, setGaryData] = useState(null)
  const [garyLoading, setGaryLoading] = useState(false)

  useEffect(() => {
    adminAPI.getStaffIQAnalytics()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  async function openGaryMode() {
    setGaryMode(true)
    setGaryPage(0)
    setGaryLoading(true)
    try {
      const d = await adminAPI.getGaryPresentation()
      setGaryData(d)
    } catch (e) {
      console.error(e)
    } finally {
      setGaryLoading(false)
    }
  }

  const metrics = [
    {
      label: 'Total Insights Generated',
      value: data?.totalInsights ?? '—',
      icon: '🧠',
      color: '#6366F1',
    },
    {
      label: 'Total Dollar Savings Calculated',
      value: fmt$(data?.totalSavings),
      icon: '💰',
      color: '#10B981',
    },
    {
      label: 'Most Common Inefficiency Type',
      value: data?.topInefficencyType || '—',
      icon: '📊',
      color: '#F59E0B',
    },
    {
      label: 'Avg Savings Per Facility / Month',
      value: fmt$(data?.avgSavingsPerFacilityMonth),
      icon: '📈',
      color: '#7C3AED',
    },
  ]

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Gary Mode overlay */}
      {garyMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0F172A', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          {/* Close */}
          <button
            onClick={() => setGaryMode(false)}
            style={{ position: 'absolute', top: 24, right: 32, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>

          {/* SNAP logo area */}
          <div style={{ padding: '32px 60px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#6366F1', letterSpacing: '0.1em', textTransform: 'uppercase' }}>SNAP Medical</div>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>StaffIQ™ Analysis</div>
          </div>

          {/* Slide content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 80px' }}>
            {garyLoading ? (
              <div style={{ color: '#94A3B8', fontSize: 18 }}>Loading presentation data...</div>
            ) : garyData ? (
              <>
                {garyPage === 0 && <GarySlide1 data={garyData.page1} />}
                {garyPage === 1 && <GarySlide2 data={garyData.page2} />}
                {garyPage === 2 && <GarySlide3 data={garyData.page3} />}
              </>
            ) : (
              <div style={{ color: '#EF4444' }}>Failed to load presentation data.</div>
            )}
          </div>

          {/* Navigation */}
          <div style={{ padding: '24px 60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => setGaryPage(p => Math.max(0, p - 1))}
              disabled={garyPage === 0}
              style={{ padding: '10px 24px', background: garyPage === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: garyPage === 0 ? '#475569' : '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: garyPage === 0 ? 'not-allowed' : 'pointer' }}
            >
              ← Previous
            </button>
            <div style={{ color: '#64748B', fontSize: 13, fontWeight: 600 }}>
              {garyPage + 1} / 3
            </div>
            {garyPage < 2 ? (
              <button
                onClick={() => setGaryPage(p => Math.min(2, p + 1))}
                style={{ padding: '10px 24px', background: '#6366F1', border: 'none', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={() => setGaryMode(false)}
                style={{ padding: '10px 24px', background: '#10B981', border: 'none', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Close Presentation
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
            StaffIQ Analytics
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
            Platform-wide scheduling intelligence metrics
          </p>
        </div>
        <button
          onClick={openGaryMode}
          style={{ padding: '10px 20px', background: '#1E1B4B', color: '#A5B4FC', border: '1px solid #3730A3', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          Gary Presentation Mode →
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '80px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>
          Loading analytics…
        </div>
      ) : (
        <>
          {/* Metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
            {metrics.map(({ label, value, icon, color }) => (
              <div
                key={label}
                style={{
                  background: '#fff',
                  borderRadius: 16,
                  padding: '24px 24px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.4 }}>
                    {label}
                  </div>
                  <span style={{ fontSize: 24 }}>{icon}</span>
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Description card */}
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #E2E8F0',
              padding: '28px 32px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 28 }}>🧠</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
                About StaffIQ™
              </h2>
            </div>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.8, margin: 0, maxWidth: 720 }}>
              StaffIQ™ is the proprietary scheduling intelligence algorithm that powers all savings calculations
              and insights across the SNAP platform. By analyzing historical scheduling patterns, agency spend,
              and internal roster utilization, StaffIQ™ identifies inefficiencies and generates actionable
              recommendations that help facilities reduce costs, improve fill rates, and retain internal staff.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
