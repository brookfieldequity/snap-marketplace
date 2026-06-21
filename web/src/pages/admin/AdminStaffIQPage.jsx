import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

// Set this to the contract PDF URL before presenting
const AGREEMENT_URL = ''

function fmt$(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const TOTAL_SLIDES = 8

// ─── Slide 1: Opening ─────────────────────────────────────────────────────────
function Slide1() {
  const products = [
    {
      name: 'SNAP Shifts',
      icon: '📅',
      desc: 'Internal scheduling with provider preferences, availability tracking, and gap detection',
      color: '#60A5FA',
    },
    {
      name: 'SNAP Marketplace',
      icon: '🔗',
      desc: 'On-demand per diem and locums coverage when internal roster comes up short',
      color: '#34D399',
    },
    {
      name: 'SNAP Credentialing',
      icon: '📋',
      desc: 'License tracking, document management, and compliance alerts for your entire team',
      color: '#FBBF24',
    },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 860, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
        SNAP Medical — Facility Pitch Deck
      </div>
      <h2 style={{ fontSize: 42, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 16 }}>
        What We Built for Your Facility
      </h2>
      <p style={{ fontSize: 17, color: '#94A3B8', marginBottom: 48, lineHeight: 1.6 }}>
        A complete anesthesia workforce management platform — built around the specific inefficiencies we identified in your facilities.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {products.map(p => (
          <div key={p.name} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${p.color}40`, borderRadius: 16, padding: '28px 22px', textAlign: 'left' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{p.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: p.color, marginBottom: 10 }}>{p.name}</div>
            <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>{p.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 2: Problem ─────────────────────────────────────────────────────────
function Slide2() {
  const metrics = [
    { location: 'Kenmore', pct: 27, est: '$120,000', label: 'team model inefficiency' },
    { location: 'Weymouth', pct: 36, est: '$160,000', label: 'team model inefficiency' },
    { location: 'Combined', pct: null, est: '$200K–$300K', label: 'estimated annual waste' },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 860, textAlign: 'center' }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 16 }}>
        The Problem We Identified
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 44, lineHeight: 1.6 }}>
        Before building anything, we analyzed your facility's scheduling patterns. Here's what we found.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 16, padding: '28px 24px', textAlign: 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              {m.location}
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 6 }}>
              {m.est}
            </div>
            <div style={{ fontSize: 13, color: '#FDA4AF', marginBottom: m.pct != null ? 14 : 0 }}>
              {m.label}
            </div>
            {m.pct != null && (
              <>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ background: '#EF4444', width: `${m.pct}%`, height: '100%', borderRadius: 6 }} />
                </div>
                <div style={{ fontSize: 12, color: '#EF4444', fontWeight: 700 }}>{m.pct}% inefficient</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 3: Team Model Inefficiency ────────────────────────────────────────
function Slide3() {
  const rows = [
    { label: 'Supervision Ratio', current: '1:2 (1 ANES / 2 CRNA)', optimal: '1:3 (1 ANES / 3 CRNA)' },
    { label: 'Anesthesiologist Cost', current: '$390/hr × excess rooms', optimal: 'Right-sized coverage' },
    { label: 'Friday Staffing', current: 'ANES-heavy, CRNA shortage', optimal: 'Balanced with per diem pool' },
    { label: 'Inefficiency Rate', current: '27–36%', optimal: '< 10%' },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 860 }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 16, textAlign: 'center' }}>
        The Team Model Problem
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, textAlign: 'center', lineHeight: 1.6 }}>
        Your facility is over-relying on anesthesiologists where CRNAs can provide the same coverage at significantly lower cost.
      </p>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: 'rgba(37,99,235,0.15)', padding: '14px 24px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metric</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current State</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.08em' }}>With SNAP</div>
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#CBD5E1' }}>{row.label}</div>
            <div style={{ fontSize: 13, color: '#FCA5A5' }}>{row.current}</div>
            <div style={{ fontSize: 13, color: '#6EE7B7' }}>{row.optimal}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 4: StaffIQ Score ───────────────────────────────────────────────────
function GaugeChart({ score = 70 }) {
  const CX = 130, CY = 115, R = 95, strokeW = 22

  function polar(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180
    return { x: CX + R * Math.cos(rad), y: CY - R * Math.sin(rad) }
  }

  // Score 0 = 180° (left), Score 100 = 0° (right), going clockwise through top
  function scoreToAngle(s) { return 180 - s * 1.8 }

  function arcD(s1, s2) {
    const p1 = polar(scoreToAngle(s1))
    const p2 = polar(scoreToAngle(s2))
    const large = (s2 - s1) > 50 ? 1 : 0
    return `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  const needlePt = polar(scoreToAngle(score))

  return (
    <svg viewBox="0 0 260 148" style={{ display: 'block', margin: '0 auto', maxWidth: 280 }}>
      <path d={arcD(0, 100)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeW} />
      <path d={arcD(0, 40)} fill="none" stroke="#EF4444" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(40, 70)} fill="none" stroke="#F59E0B" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(70, 89)} fill="none" stroke="#10B981" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(89, 100)} fill="none" stroke="#3B82F6" strokeWidth={strokeW} strokeLinecap="butt" />
      <line x1={CX} y1={CY} x2={needlePt.x.toFixed(1)} y2={needlePt.y.toFixed(1)} stroke="white" strokeWidth={3} strokeLinecap="round" />
      <circle cx={CX} cy={CY} r={7} fill="white" />
      <text x={CX} y={CY + 22} textAnchor="middle" fontSize={26} fontWeight="900" fill="white">{score}</text>
      <text x={CX} y={CY + 38} textAnchor="middle" fontSize={10} fill="#94A3B8">/ 100</text>
    </svg>
  )
}

function Slide4() {
  const zones = [
    { color: '#EF4444', label: '0–40', name: 'Critical' },
    { color: '#F59E0B', label: '41–70', name: 'Needs Work' },
    { color: '#10B981', label: '71–89', name: 'Good' },
    { color: '#3B82F6', label: '90–100', name: 'Elite' },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 860, textAlign: 'center' }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 8 }}>
        Your StaffIQ Score
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 32, lineHeight: 1.6 }}>
        Based on team model analysis and historical scheduling data.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 60 }}>
        <div>
          <GaugeChart score={70} />
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>
            Needs Work — Yellow Zone
          </div>
        </div>
        <div style={{ textAlign: 'left', maxWidth: 320 }}>
          <div style={{ marginBottom: 20 }}>
            {zones.map(z => (
              <div key={z.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: z.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#94A3B8', width: 44 }}>{z.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{z.name}</span>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 13, color: '#FCD34D', lineHeight: 1.7 }}>
              A score of <strong>70</strong> means significant savings are available. With SNAP, facilities typically move to the <strong style={{ color: '#34D399' }}>Good</strong> zone within 60–90 days.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Slide 5: Solution ───────────────────────────────────────────────────────
function Slide5() {
  const products = [
    {
      name: 'SNAP Shifts',
      color: '#60A5FA',
      items: [
        'Internal schedule builder with room-level assignments',
        'Provider preference matching (days, locations, rate)',
        'Automatic gap detection and fill alerts',
        'Publish schedule + notify providers by SMS/push',
      ],
    },
    {
      name: 'SNAP Marketplace',
      color: '#34D399',
      items: [
        'On-demand per diem and locums matching',
        'Credentialed, vetted CRNA and ANES pool',
        'Preferred provider list for repeat coverage',
        'Shift posting with instant applicant review',
      ],
    },
    {
      name: 'SNAP Credentialing',
      color: '#FBBF24',
      items: [
        'License and DEA expiration tracking',
        'Document upload and compliance dashboard',
        'Automated renewal reminders',
        'Centralized provider credential records',
      ],
    },
  ]

  return (
    <div style={{ width: '100%', maxWidth: 900 }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 16, textAlign: 'center' }}>
        How SNAP Solves It
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, textAlign: 'center', lineHeight: 1.6 }}>
        Three integrated tools, one platform. Each module addresses a distinct layer of your staffing challenge.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {products.map(p => (
          <div key={p.name} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${p.color}30`, borderRadius: 16, padding: '24px 22px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: p.color, marginBottom: 16 }}>{p.name}</div>
            {p.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: `${p.color}20`, border: `1px solid ${p.color}60`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: p.color }} />
                </div>
                <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.5 }}>{item}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 6: Provider Experience ────────────────────────────────────────────
function Slide6() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const weeks = [
    ['avail', 'avail', 'off', 'avail', 'off'],
    ['off', 'avail', 'avail', 'avail', 'off'],
    ['avail', 'avail', 'avail', 'off', 'avail'],
    ['avail', 'off', 'avail', 'avail', 'avail'],
  ]
  const features = [
    'Set weekly availability in minutes — providers pick their preferred days',
    'Location rankings so the right CRNA lands at their preferred site',
    'Push notifications when new shifts are posted or schedule is published',
    'Availability windows respect max shifts per month and contract terms',
  ]

  return (
    <div style={{ width: '100%', maxWidth: 880 }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 12, textAlign: 'center' }}>
        Your Providers Will Actually Use This
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, textAlign: 'center', lineHeight: 1.6 }}>
        Providers manage their availability on mobile. The system does the matching automatically.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, alignItems: 'center' }}>
        {/* Calendar mockup */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#60A5FA', marginBottom: 16 }}>Provider Availability — June</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {days.map(d => (
              <div key={d} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textAlign: 'center', paddingBottom: 4 }}>{d}</div>
            ))}
            {weeks.map((week, wi) =>
              week.map((status, di) => (
                <div key={`${wi}-${di}`} style={{
                  height: 34,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  background: status === 'avail' ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${status === 'avail' ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  color: status === 'avail' ? '#34D399' : '#475569',
                }}>
                  {status === 'avail' ? '✓' : '—'}
                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(52,211,153,0.3)', border: '1px solid rgba(52,211,153,0.4)' }} />
              <span style={{ fontSize: 11, color: '#94A3B8' }}>Available</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />
              <span style={{ fontSize: 11, color: '#94A3B8' }}>Day off</span>
            </div>
          </div>
        </div>

        {/* Features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {features.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, color: '#60A5FA', fontWeight: 900 }}>
                {i + 1}
              </div>
              <div style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 1.6 }}>{f}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Slide 7: ROI ────────────────────────────────────────────────────────────
function Slide7() {
  const rows = [
    { label: 'Team Model Optimization', min: 150000, max: 200000 },
    { label: 'Friday Coverage Efficiency', min: 50000, max: 90000 },
    { label: 'Agency Cost Reduction', min: 50000, max: 100000 },
  ]
  const total = { min: 250000, max: 390000 }
  const investment = 75000
  const roi = '3–4×'

  function fmtK(n) {
    return '$' + (n / 1000).toFixed(0) + 'K'
  }

  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 16, textAlign: 'center' }}>
        The Financial Case
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, textAlign: 'center', lineHeight: 1.6 }}>
        Conservative estimates based on your current utilization data.
      </p>

      {/* Savings rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
            <span style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 500 }}>{row.label}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#6EE7B7' }}>
              {fmtK(row.min)} – {fmtK(row.max)}/yr
            </span>
          </div>
        ))}

        {/* Total */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Total Estimated Annual Savings</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: '#10B981' }}>
            {fmtK(total.min)} – {fmtK(total.max)}/yr
          </span>
        </div>
      </div>

      {/* Investment + ROI */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: '20px 22px', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#A5B4FC', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Platform Investment</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>{fmtK(investment)}/yr</div>
        </div>
        <div style={{ padding: '20px 22px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Return on Investment</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#FBBF24' }}>{roi} ROI</div>
        </div>
      </div>
    </div>
  )
}

// ─── Slide 8: Offer ──────────────────────────────────────────────────────────
function Slide8() {
  const benefits = [
    'Full platform access across all your facilities',
    'A StaffIQ baseline report and ROI analysis for your facility',
    'White-glove onboarding and historical data migration',
    'Founding partner pricing locked for 3 years',
    'Direct input on SNAP product roadmap',
  ]

  function handleSign() {
    if (AGREEMENT_URL) {
      window.open(AGREEMENT_URL, '_blank')
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 780, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
        Exclusive Offer
      </div>
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 12 }}>
        Founding Customer Agreement
      </h2>
      <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, lineHeight: 1.6 }}>
        Partner with SNAP Medical from the ground floor. Founding customers shape how this platform evolves.
      </p>

      {/* Benefits */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 36, textAlign: 'left' }}>
        {benefits.map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#fff', flexShrink: 0 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{b}</div>
          </div>
        ))}
      </div>

      {/* Investment + CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 14, padding: '16px 28px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#A5B4FC', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Founding Partner Investment</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff' }}>$75,000 / year</div>
        </div>
        <button
          onClick={handleSign}
          disabled={!AGREEMENT_URL}
          style={{
            padding: '18px 36px',
            background: AGREEMENT_URL ? 'linear-gradient(135deg, #2563EB, #1E40AF)' : 'rgba(37,99,235,0.3)',
            border: 'none',
            borderRadius: 14,
            fontSize: 17,
            fontWeight: 800,
            color: '#fff',
            cursor: AGREEMENT_URL ? 'pointer' : 'default',
            boxShadow: AGREEMENT_URL ? '0 6px 24px rgba(37,99,235,0.5)' : 'none',
            letterSpacing: '-0.01em',
          }}
        >
          Sign the Agreement →
        </button>
      </div>
    </div>
  )
}

// ─── Slide registry ──────────────────────────────────────────────────────────
const SLIDES = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6, Slide7, Slide8]

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminStaffIQPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [pitchMode, setPitchMode] = useState(false)
  const [pitchPage, setPitchPage] = useState(0)

  useEffect(() => {
    adminAPI.getStaffIQAnalytics()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  function openPitchMode() {
    setPitchMode(true)
    setPitchPage(0)
  }

  const metrics = [
    { label: 'Total Insights Generated', value: data?.totalInsights ?? '—', icon: '🧠', color: '#2563EB' },
    { label: 'Total Dollar Savings Calculated', value: fmt$(data?.totalSavings), icon: '💰', color: '#10B981' },
    { label: 'Most Common Inefficiency Type', value: data?.topInefficencyType || '—', icon: '📊', color: '#F59E0B' },
    { label: 'Avg Savings Per Facility / Month', value: fmt$(data?.avgSavingsPerFacilityMonth), icon: '📈', color: '#1E3A8A' },
  ]

  const SlideComponent = SLIDES[pitchPage]

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Presentation overlay */}
      {pitchMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#0F172A', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          {/* Close */}
          <button
            onClick={() => setPitchMode(false)}
            style={{ position: 'absolute', top: 24, right: 32, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          >
            ×
          </button>

          {/* Header */}
          <div style={{ padding: '28px 60px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#2563EB', letterSpacing: '0.1em', textTransform: 'uppercase' }}>SNAP Medical</div>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Facility Pitch Deck</div>
          </div>

          {/* Slide content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 80px', overflowY: 'auto' }}>
            <SlideComponent />
          </div>

          {/* Navigation */}
          <div style={{ padding: '24px 60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => setPitchPage(p => Math.max(0, p - 1))}
              disabled={pitchPage === 0}
              style={{ padding: '10px 24px', background: pitchPage === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: pitchPage === 0 ? '#475569' : '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: pitchPage === 0 ? 'not-allowed' : 'pointer' }}
            >
              ← Previous
            </button>
            <div style={{ color: '#64748B', fontSize: 13, fontWeight: 600 }}>
              {pitchPage + 1} of {TOTAL_SLIDES}
            </div>
            {pitchPage < TOTAL_SLIDES - 1 ? (
              <button
                onClick={() => setPitchPage(p => Math.min(TOTAL_SLIDES - 1, p + 1))}
                style={{ padding: '10px 24px', background: '#2563EB', border: 'none', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={() => setPitchMode(false)}
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
          onClick={openPitchMode}
          style={{ padding: '10px 20px', background: '#1E1B4B', color: '#A5B4FC', border: '1px solid #3730A3', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          Facility Pitch Mode →
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '80px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>
          Loading analytics…
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
            {metrics.map(({ label, value, icon, color }) => (
              <div key={label} style={{ background: '#fff', borderRadius: 16, padding: '24px 24px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
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

          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '28px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
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
