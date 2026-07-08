import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

// Agreement is accepted IN-APP (click-wrap on the facility SubscriptionPage:
// Subscription Agreement + HIPAA BAA, versioned + timestamped in
// AgreementAcceptance) — there is no external document to sign, so the deck
// closes on starting onboarding, not on a PDF link.

// Live subscription tiers ($/month). Keep in sync with pricing.
const PITCH_TIERS = [
  { key: 'CORE', label: 'SNAP Core', monthly: 2500 },
  { key: 'STAFF_IQ', label: 'SNAP Staff IQ', monthly: 5000 },
  { key: 'COMPLETE', label: 'SNAP Complete', monthly: 10000 },
]

const SETUP_STORAGE_KEY = 'snapPitchSetup'

const DEFAULT_SETUP = {
  prospectName: '',
  totalLocations: '',
  primaryTeamModel: 'mixed',
  avgAnesthesiologistRate: '',
  avgCrnaRate: '',
  avgShiftHours: 10,
  operatingDaysPerYear: 250,
  agencyAnesthesiologistsPerMonth: '',
  agencyCrnasPerMonth: '',
  agencyAnesthesiologistRate: '',
  agencyCrnaRate: '',
  tierKey: 'STAFF_IQ',
  customMonthlyPrice: '',
}

function fmt$(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function setupMonthlyPrice(setup) {
  if (setup.tierKey === 'CUSTOM') return Number(setup.customMonthlyPrice) || 0
  return PITCH_TIERS.find(t => t.key === setup.tierKey)?.monthly || 0
}

function prospect(setup) {
  return setup?.prospectName?.trim() || 'Your Facility'
}

// ─── Shared slide bits ─────────────────────────────────────────────────────────

function SlideTitle({ kicker, title, sub, maxWidth = 860 }) {
  return (
    <div style={{ textAlign: 'center', maxWidth, margin: '0 auto' }}>
      {kicker && (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
          {kicker}
        </div>
      )}
      <h2 style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 14 }}>
        {title}
      </h2>
      {sub && <p style={{ fontSize: 15, color: '#94A3B8', marginBottom: 36, lineHeight: 1.6 }}>{sub}</p>}
    </div>
  )
}

// Shown on data-driven slides when the pitch hasn't been set up — never
// fabricate a prospect's numbers.
function NeedsSetup({ onOpenSetup }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 560, margin: '40px auto 0' }}>
      <div style={{ fontSize: 15, color: '#94A3B8', lineHeight: 1.7, marginBottom: 20 }}>
        This slide runs on the prospect's own numbers — enter their 2-minute baseline to compute it live.
        No placeholder figures, ever.
      </div>
      <button
        onClick={onOpenSetup}
        style={{ padding: '12px 28px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
      >
        Enter Prospect Baseline →
      </button>
    </div>
  )
}

// ─── Gauge (score vs network median) ──────────────────────────────────────────
function GaugeChart({ score = null, median = 88 }) {
  const CX = 130, CY = 115, R = 95, strokeW = 22

  function polar(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180
    return { x: CX + R * Math.cos(rad), y: CY - R * Math.sin(rad) }
  }
  function scoreToAngle(s) { return 180 - s * 1.8 }
  function arcD(s1, s2) {
    const p1 = polar(scoreToAngle(s1))
    const p2 = polar(scoreToAngle(s2))
    const large = (s2 - s1) > 50 ? 1 : 0
    return `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  const hasScore = score != null
  const needlePt = polar(scoreToAngle(hasScore ? score : 0))
  const medianPt1 = polar(scoreToAngle(median))

  return (
    <svg viewBox="0 0 260 148" style={{ display: 'block', margin: '0 auto', maxWidth: 280 }}>
      <path d={arcD(0, 100)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeW} />
      <path d={arcD(0, 40)} fill="none" stroke="#EF4444" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(40, 70)} fill="none" stroke="#F59E0B" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(70, 89)} fill="none" stroke="#10B981" strokeWidth={strokeW} strokeLinecap="butt" />
      <path d={arcD(89, 100)} fill="none" stroke="#3B82F6" strokeWidth={strokeW} strokeLinecap="butt" />
      {/* Network median tick */}
      <line
        x1={CX + (R - 16) * Math.cos((scoreToAngle(median) * Math.PI) / 180)}
        y1={CY - (R - 16) * Math.sin((scoreToAngle(median) * Math.PI) / 180)}
        x2={CX + (R + 16) * Math.cos((scoreToAngle(median) * Math.PI) / 180)}
        y2={CY - (R + 16) * Math.sin((scoreToAngle(median) * Math.PI) / 180)}
        stroke="#94A3B8" strokeWidth={2} strokeDasharray="3 2"
      />
      <text x={medianPt1.x.toFixed(1)} y={(medianPt1.y - 20).toFixed(1)} textAnchor="middle" fontSize={9} fill="#94A3B8">median {median}</text>
      {hasScore && (
        <>
          <line x1={CX} y1={CY} x2={needlePt.x.toFixed(1)} y2={needlePt.y.toFixed(1)} stroke="white" strokeWidth={3} strokeLinecap="round" />
          <circle cx={CX} cy={CY} r={7} fill="white" />
        </>
      )}
      <text x={CX} y={CY + 22} textAnchor="middle" fontSize={26} fontWeight="900" fill="white">{hasScore ? score : '—'}</text>
      <text x={CX} y={CY + 38} textAnchor="middle" fontSize={10} fill="#94A3B8">/ 100 · gap = waste %</text>
    </svg>
  )
}

// ─── Slide 1: The one number ──────────────────────────────────────────────────
function Slide1({ p, setup, onOpenSetup }) {
  return (
    <div style={{ width: '100%', maxWidth: 860, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20 }}>
        SNAP Medical · StaffIQ™
      </div>
      {p?.monthly != null ? (
        <>
          <h2 style={{ fontSize: 30, fontWeight: 800, color: '#94A3B8', letterSpacing: '-0.02em', marginBottom: 10 }}>
            StaffIQ projects {prospect(setup)} saves
          </h2>
          <div style={{
            fontSize: 96, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1,
            background: 'linear-gradient(135deg, #FCD34D 0%, #10B981 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 10,
          }}>
            {fmt$(p.monthly)}<span style={{ fontSize: 40 }}>/mo</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#10B981', marginBottom: 28 }}>
            = {fmt$(p.annual)} per year
          </div>
          <p style={{ fontSize: 16, color: '#94A3B8', lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
            One number. Computed by our proprietary staffing algorithm from your own
            baseline — in about two minutes. The rest of this conversation is where it
            comes from, why you can trust it, and how SNAP delivers it.
          </p>
        </>
      ) : (
        <>
          <h2 style={{ fontSize: 42, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 16 }}>
            One Number Tells the Story
          </h2>
          <p style={{ fontSize: 17, color: '#94A3B8', lineHeight: 1.6, maxWidth: 620, margin: '0 auto' }}>
            StaffIQ — our proprietary staffing algorithm — projects what a facility saves
            with SNAP, from a 2-minute baseline, before any commitment.
          </p>
          <NeedsSetup onOpenSetup={onOpenSetup} />
        </>
      )}
    </div>
  )
}

// ─── Slide 2: Where anesthesia budgets leak ───────────────────────────────────
function Slide2() {
  const leaks = [
    {
      icon: '🏥',
      title: 'The staffing model itself',
      color: '#EF4444',
      desc: 'Paying anesthesiologist rates to cover rooms a balanced care team (1 MD supervising 3–4 CRNAs) covers for materially less. This is the biggest leak — and the one nobody measures day-by-day.',
    },
    {
      icon: '🏷️',
      title: 'Agency premiums',
      color: '#F59E0B',
      desc: 'Every gap that reaches a locum agency bills at a premium — often $100+/hr over your own rates. Gaps are inevitable; paying agency rates for them is not.',
    },
    {
      icon: '📉',
      title: 'And it compounds',
      color: '#94A3B8',
      desc: 'MD-heavy Fridays, last-minute backfills, coverage "just in case" — each looks small on the day it happens. Across a year of operating days it becomes six figures.',
    },
  ]
  return (
    <div style={{ width: '100%', maxWidth: 900 }}>
      <SlideTitle
        title="Where Anesthesia Budgets Leak"
        sub="Across our network and published benchmarks, the median anesthesia department wastes about 12% of its staffing spend. The best-run facilities hold it under 5%. It leaks in two places:"
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {leaks.map(l => (
          <div key={l.title} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${l.color}35`, borderRadius: 16, padding: '26px 22px', textAlign: 'left' }}>
            <div style={{ fontSize: 30, marginBottom: 12 }}>{l.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: l.color, marginBottom: 10 }}>{l.title}</div>
            <div style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.7 }}>{l.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 3: Your number, live (the hero) ────────────────────────────────────
function Slide3({ p, setup, onOpenSetup }) {
  if (p?.monthly == null) {
    return (
      <div style={{ width: '100%', maxWidth: 860 }}>
        <SlideTitle title="Your Number" sub="Computed live from the prospect's 2-minute baseline." />
        <NeedsSetup onOpenSetup={onOpenSetup} />
      </div>
    )
  }
  const lever1 = p.components?.find(c => c.key === 'staffing_efficiency')
  const lever2 = p.components?.find(c => c.key === 'agency_displacement')
  const inputChips = [
    `${p.inputs?.totalLocations ?? '—'} anesthetizing locations`,
    `${setup.primaryTeamModel === 'mixed' ? 'mixed team models' : setup.primaryTeamModel + ' team model'}`,
    `MD ${fmt$(p.inputs?.avgAnesthesiologistRate)}/hr · CRNA ${fmt$(p.inputs?.avgCrnaRate)}/hr`,
    `${(Number(setup.agencyAnesthesiologistsPerMonth) || 0) + (Number(setup.agencyCrnasPerMonth) || 0)} agency shifts/mo`,
  ]
  return (
    <div style={{ width: '100%', maxWidth: 920 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 40, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#FCD34D', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              ⭐ StaffIQ saves {prospect(setup)}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.18)', color: '#93C5FD', border: '1px solid rgba(59,130,246,0.4)' }}>
              PROJECTED
            </span>
          </div>
          <div style={{
            fontSize: 72, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1,
            background: 'linear-gradient(135deg, #FCD34D 0%, #10B981 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            {fmt$(p.monthly)}<span style={{ fontSize: 30 }}>/mo</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#10B981', marginTop: 6, marginBottom: 22 }}>
            = {fmt$(p.annual)} / year
          </div>
          {/* Two levers */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: '#CBD5E1' }}>1 · Staffing-model efficiency <span style={{ color: '#64748B', fontSize: 12 }}>(the StaffIQ core)</span></span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{fmt$(lever1?.monthly)}/mo</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: '#CBD5E1' }}>2 · Agency displacement</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{fmt$(lever2?.monthly)}/mo</span>
            </div>
          </div>
          {p.assumptions?.agencyRateSource === 'estimated' && (
            <div style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic', marginTop: 14 }}>
              Agency premiums use regional estimates ({fmt$(p.assumptions.agencyRates?.ANESTHESIOLOGIST)}/{fmt$(p.assumptions.agencyRates?.CRNA)} per hr) — your invoices replace them.
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <GaugeChart score={p.score} median={p.networkMedianScore ?? 88} />
          <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 10, lineHeight: 1.6 }}>
            Efficiency score <strong style={{ color: '#fff' }}>{p.score}</strong> — the gap from 100 is the
            <strong style={{ color: '#FCD34D' }}> {p.wasteRatioPct}%</strong> of staffing spend StaffIQ can recover.
          </div>
          <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {inputChips.map((c, i) => (
              <span key={i} style={{ fontSize: 11, color: '#94A3B8', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 12px' }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>Computed from the baseline entered before this meeting — 2 minutes of input.</div>
        </div>
      </div>
    </div>
  )
}

// ─── Slide 4: The math (CFO drill-down) ───────────────────────────────────────
function Slide4({ p, onOpenSetup }) {
  if (p?.monthly == null) {
    return (
      <div style={{ width: '100%', maxWidth: 860 }}>
        <SlideTitle title="The Math Your CFO Will Ask For" sub="Every dollar traceable to an input." />
        <NeedsSetup onOpenSetup={onOpenSetup} />
      </div>
    )
  }
  const lever1 = p.components?.find(c => c.key === 'staffing_efficiency')
  const lever2 = p.components?.find(c => c.key === 'agency_displacement')
  const rows = [
    { label: 'Annual staffing budget (from your rooms, rates, hours, operating days)', value: fmt$(p.totalBudget) + '/yr' },
    { label: `Waste StaffIQ identified in the staffing model — ${p.wasteRatioPct}% of that budget`, value: fmt$(lever1?.monthly != null ? lever1.monthly * 12 : null) + '/yr', color: '#FCD34D' },
    { label: 'Agency premium avoided — your agency shifts/mo × (agency rate − your rate) × shift hours', value: fmt$(lever2?.monthly != null ? lever2.monthly * 12 : null) + '/yr', color: '#FCD34D' },
    { label: 'Total projected savings', value: fmt$(p.annual) + '/yr', total: true },
  ]
  const assumptions = []
  if (p.assumptions?.efficiencyFloorApplied) {
    assumptions.push('Your entered team model is already efficient, so lever 1 uses the industry-typical minimum (2% of spend) — schedule uploads replace it with your measured number.')
  } else {
    assumptions.push('Lever 1 comes from your entered team model measured against the optimal care-team mix — schedule uploads replace it with day-by-day measured waste.')
  }
  assumptions.push(
    p.assumptions?.agencyRateSource === 'facility'
      ? 'Agency premiums use the rates you told us your agencies bill.'
      : `Agency premiums use regional estimates (${fmt$(p.assumptions?.agencyRates?.ANESTHESIOLOGIST)} MD / ${fmt$(p.assumptions?.agencyRates?.CRNA)} CRNA per hour) — labeled, and replaced the moment you give us an invoice.`
  )
  return (
    <div style={{ width: '100%', maxWidth: 820 }}>
      <SlideTitle
        title="The Math Your CFO Will Ask For"
        sub="Score gap = waste percentage = dollars. You can recompute every line on a napkin."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
            padding: r.total ? '18px 22px' : '14px 22px',
            background: r.total ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${r.total ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 12,
          }}>
            <span style={{ fontSize: r.total ? 15 : 13, color: r.total ? '#fff' : '#CBD5E1', fontWeight: r.total ? 800 : 500, lineHeight: 1.5 }}>{r.label}</span>
            <span style={{ fontSize: r.total ? 20 : 15, fontWeight: 900, color: r.total ? '#10B981' : (r.color || '#fff'), whiteSpace: 'nowrap' }}>{r.value}</span>
          </div>
        ))}
      </div>
      <div style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#93C5FD', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Every assumption, labeled
        </div>
        {assumptions.map((a, i) => (
          <div key={i} style={{ fontSize: 12.5, color: '#CBD5E1', lineHeight: 1.7, marginBottom: 4 }}>• {a}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 5: Projected → Realized (the trust slide) ──────────────────────────
function Slide5() {
  const steps = [
    { when: 'Day 1', title: 'Projected', color: '#60A5FA', desc: 'Your number, from the 2-minute baseline you just saw. Labeled PROJECTED — we never dress an estimate up as a measurement.' },
    { when: 'Weeks 1–4', title: 'Learning', color: '#FBBF24', desc: 'You upload schedules (or we import them). StaffIQ measures your actual day-by-day staffing against the optimal care team and builds your facility\'s own baseline.' },
    { when: 'Day 30+', title: 'Realized', color: '#10B981', desc: 'The dashboard flips to REALIZED: your savings measured from your own data over a rolling 30 days. Same number, now backed by evidence.' },
    { when: 'Every month', title: 'Audited', color: '#A78BFA', desc: 'StaffIQ records what it projected next to what actually happened — and shows you. We grade our own accuracy, in writing, every month.' },
  ]
  return (
    <div style={{ width: '100%', maxWidth: 940 }}>
      <SlideTitle
        title="A Projection Is a Promise. Here's How We Keep It Honest."
        sub="StaffIQ is a learning algorithm: it starts from your baseline and gets smarter with every schedule you feed it."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${s.color}35`, borderRadius: 16, padding: '22px 18px', position: 'relative' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{s.when}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color, marginBottom: 10 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.65 }}>{s.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 26, fontSize: 13, color: '#94A3B8', lineHeight: 1.7, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
        Your facility is also benchmarked against the SNAP network — cost per room, care-team ratio,
        waste per room — so you always know where you stand, not just where you started.
      </div>
    </div>
  )
}

// ─── Slide 6: How SNAP delivers the number ────────────────────────────────────
function Slide6() {
  const engines = [
    {
      name: 'SNAP Shifts',
      color: '#60A5FA',
      lever: 'Delivers lever 1 — staffing-model efficiency',
      items: [
        'Schedule builder that right-sizes the care team every day (optimal MD:CRNA supervision)',
        'Flags MD-heavy days and Friday coverage waste before they cost you',
        'Internal incentive shifts fill gaps with YOUR people first',
      ],
    },
    {
      name: 'SNAP Marketplace',
      color: '#34D399',
      lever: 'Delivers lever 2 — agency displacement',
      items: [
        'Credentialed CRNA / MD pool fills remaining gaps below agency rates',
        'Preferred-provider lists for repeat coverage',
        'Every fill is logged — it becomes your realized savings, automatically',
      ],
    },
  ]
  const proof = [
    'Providers set availability on their phones in minutes — no logins, no friction',
    'Coverage is the proof point: ORs stay staffed while the number climbs',
    'Credentialing passport included — that\'s a separate conversation, and it sells itself once you\'re live',
  ]
  return (
    <div style={{ width: '100%', maxWidth: 900 }}>
      <SlideTitle
        title="How SNAP Delivers the Number"
        sub="Two engines, one brain. Everything rolls up into the same StaffIQ figure you saw — no side math."
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 18 }}>
        {engines.map(e => (
          <div key={e.name} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${e.color}30`, borderRadius: 16, padding: '24px 22px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: e.color, marginBottom: 4 }}>{e.name}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>{e.lever}</div>
            {e.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: `${e.color}20`, border: `1px solid ${e.color}60`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: e.color }} />
                </div>
                <div style={{ fontSize: 12.5, color: '#CBD5E1', lineHeight: 1.55 }}>{item}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {proof.map((t, i) => (
          <div key={i} style={{ fontSize: 12.5, color: '#94A3B8', lineHeight: 1.6 }}>✓ {t}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Slide 7: Investment & ROI (live) ─────────────────────────────────────────
function Slide7({ p, setup, onOpenSetup }) {
  const monthlyPrice = setupMonthlyPrice(setup)
  if (p?.monthly == null || !monthlyPrice) {
    return (
      <div style={{ width: '100%', maxWidth: 780 }}>
        <SlideTitle title="The Financial Case" sub="Computed live: their projected savings against the selected tier." />
        <NeedsSetup onOpenSetup={onOpenSetup} />
      </div>
    )
  }
  const annualCost = monthlyPrice * 12
  const roiX = annualCost > 0 ? p.annual / annualCost : null
  const paybackWeeks = p.monthly > 0 ? Math.max(1, Math.round((annualCost / (p.annual / 52)))) : null
  const tierLabel = setup.tierKey === 'CUSTOM' ? 'Custom' : PITCH_TIERS.find(t => t.key === setup.tierKey)?.label
  const net = p.annual - annualCost
  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <SlideTitle
        title="The Financial Case"
        sub="You've seen the number and the math behind it. Here's what it costs to turn on."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12 }}>
          <span style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 600 }}>Projected annual savings (StaffIQ)</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#10B981' }}>{fmt$(p.annual)}/yr</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 12 }}>
          <span style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 600 }}>{tierLabel} subscription</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#93C5FD' }}>{fmt$(monthlyPrice)}/mo · {fmt$(annualCost)}/yr</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Net first-year impact</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#FBBF24' }}>{net >= 0 ? '+' : ''}{fmt$(net)}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: '18px 22px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Return on investment</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{roiX != null ? `${(Math.round(roiX * 10) / 10).toLocaleString()}×` : '—'}</div>
        </div>
        <div style={{ padding: '18px 22px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Platform pays for itself in</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{paybackWeeks != null ? `~${paybackWeeks} week${paybackWeeks === 1 ? '' : 's'}` : '—'}</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: '#64748B', marginTop: 16, fontStyle: 'italic' }}>
        This is a staffing-cost reduction with software attached — not a software line item.
      </div>
    </div>
  )
}

// ─── Slide 8: Close / how we start (everything in-app — no paperwork) ─────────
function Slide8({ p, setup, onStartOnboarding }) {
  const steps = [
    { n: '1', title: 'Accept & activate — in the app', time: 'Day 1 — one click', desc: 'We create your facility account from this meeting. Your administrator accepts the Subscription Agreement + HIPAA BAA right in the portal — electronic click-through, versioned and timestamped. No PDFs, no e-sign emails, no paper chase.' },
    { n: '2', title: 'Feed it your schedules', time: 'Week 1', desc: 'Confirm the 2-minute baseline you just saw, then upload the last 2–3 months of schedules (any format — we parse it). StaffIQ starts measuring your actual staffing against optimal, day by day.' },
    { n: '3', title: 'See the realized number', time: 'Day 30', desc: 'Your dashboard flips from PROJECTED to REALIZED — savings measured from your own data. And every month, our accuracy report alongside it.' },
  ]
  const benefits = [
    'Founding partner pricing locked for 3 years',
    'White-glove onboarding and historical data migration',
    'Direct input on the SNAP product roadmap',
  ]
  return (
    <div style={{ width: '100%', maxWidth: 820, textAlign: 'center' }}>
      <SlideTitle
        kicker="How we start"
        title={p?.monthly != null ? `${fmt$(p.monthly)}/mo Starts With Three Steps` : 'Three Steps to Your Realized Number'}
        sub="The entire process lives in the app — signup, agreement, baseline, savings. You could be live before this meeting ends."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 26, textAlign: 'left' }}>
        {steps.map(s => (
          <div key={s.n} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '22px 20px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff', marginBottom: 12 }}>{s.n}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 2 }}>{s.title}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{s.time}</div>
            <div style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 1.65 }}>{s.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 30, textAlign: 'left', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
        {benefits.map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#fff', flexShrink: 0 }}>✓</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{b}</div>
          </div>
        ))}
      </div>
      <button
        onClick={onStartOnboarding}
        style={{
          padding: '18px 40px',
          background: 'linear-gradient(135deg, #2563EB, #1E40AF)',
          border: 'none', borderRadius: 14, fontSize: 17, fontWeight: 800, color: '#fff',
          cursor: 'pointer',
          boxShadow: '0 6px 24px rgba(37,99,235,0.5)',
        }}
      >
        Start Onboarding — Create {setup?.prospectName?.trim() ? setup.prospectName.trim() + "'s" : 'Their'} Account →
      </button>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>
        Opens the Facilities admin — create the facility and send the coordinator invite. They accept the agreement in-app at first login.
      </div>
    </div>
  )
}

// ─── Slide registry + presenter script ────────────────────────────────────────
// The script lines are the sell-in talk track (locked 2026-07-07): lead with the
// ONE number, staffing-model efficiency before agency, value before price,
// decomposition only when asked, credentialing out of the number.
const SLIDES = [
  {
    Component: Slide1,
    script: 'Open with the number, not the product. "Before I show you anything — one number. StaffIQ, our proprietary staffing algorithm, projects that your facility is leaving this on the table every month. Everything else today is where that number comes from, why your CFO can trust it, and how we deliver it."',
  },
  {
    Component: Slide2,
    script: 'Frame the two leaks IN ONE BREATH, efficiency first: "Anesthesia budgets leak in two places — the staffing model itself, which is the bigger and less-measured one, and agency premiums on the gaps. The median department wastes about 12% of staffing spend. The best run under 5. The question is only where you sit."',
  },
  {
    Component: Slide3,
    script: 'The hero moment. "We computed YOUR number from six inputs your team gave us — two minutes. Notice the split: the efficiency lever is usually bigger than the agency lever. That\'s the piece nobody else measures — anyone can undercut an agency rate." Pause on the number. Let them react before you move.',
  },
  {
    Component: Slide4,
    script: 'Only go deep here if the CFO wants it — otherwise move through in 30 seconds. "Nothing is hidden. Score gap equals waste percentage equals dollars — you can recompute every line on a napkin. And the two assumptions we made are labeled right there. Both get replaced by your own data."',
  },
  {
    Component: Slide5,
    script: 'The trust close on the number: "A projection is a promise. Day 30, your dashboard stops saying projected and starts saying realized — measured from your own schedules over a rolling 30 days. And every month we put our projection next to what actually happened and show you. We grade our own accuracy. No other staffing vendor will show you that report."',
  },
  {
    Component: Slide6,
    script: 'Map the levers to the product, keep it to two engines: "Shifts right-sizes the care team — that\'s lever one. Marketplace fills the remaining gaps below agency — lever two. Coverage is the proof point: your ORs stay staffed while the number climbs. Credentialing passport is included, but that\'s a separate conversation — it sells itself once you\'re live."',
  },
  {
    Component: Slide7,
    script: 'Price ONLY after the number has landed. "Against your projected savings, the platform returns a multiple and pays for itself in weeks. This is a staffing-cost reduction with software attached, not a software line item." Then stop talking.',
  },
  {
    Component: Slide8,
    script: 'Close on speed-to-proof and zero friction: "Three steps, all in the app — no contracts to route, no e-sign emails. We create your account right now; your administrator clicks accept on the agreement at first login, and your projected number is live on your dashboard today. Your realized number lands in 30 days. If StaffIQ is wrong about you, you\'ll see it in writing — but it won\'t be." Then click Start Onboarding while they watch.',
  },
]
const TOTAL_SLIDES = SLIDES.length

// ─── Pitch setup panel (the 2-minute baseline + tier) ─────────────────────────
function PitchSetupPanel({ setup, setSetup, onCalculate, calculating, onClose, error }) {
  const f = (k, v) => setSetup(prev => ({ ...prev, [k]: v }))
  const input = {
    width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', fontSize: 13,
  }
  const label = { fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }
  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 420, background: '#1E293B', borderLeft: '1px solid rgba(255,255,255,0.1)', padding: '28px 28px', overflowY: 'auto', zIndex: 20, boxShadow: '-16px 0 48px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Prospect Baseline</div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.6, marginBottom: 20 }}>
        The 2-minute baseline. This computes the same number their dashboard will show on day one — one engine, one number.
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={label}>Prospect / facility name</span>
        <input style={input} value={setup.prospectName} onChange={e => f('prospectName', e.target.value)} placeholder="e.g. Bayside Surgical Partners" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <span style={label}>Anesthetizing locations *</span>
          <input style={input} type="number" min="1" value={setup.totalLocations} onChange={e => f('totalLocations', e.target.value)} placeholder="e.g. 8" />
        </div>
        <div>
          <span style={label}>Primary team model</span>
          <select style={input} value={setup.primaryTeamModel} onChange={e => f('primaryTeamModel', e.target.value)}>
            <option value="mixed">Mixed models</option>
            <option value="1:3">Mostly 1:3</option>
            <option value="1:2">Mostly 1:2</option>
            <option value="solo">Mostly solo MD</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <span style={label}>MD rate ($/hr)</span>
          <input style={input} type="number" value={setup.avgAnesthesiologistRate} onChange={e => f('avgAnesthesiologistRate', e.target.value)} placeholder="390" />
        </div>
        <div>
          <span style={label}>CRNA rate ($/hr)</span>
          <input style={input} type="number" value={setup.avgCrnaRate} onChange={e => f('avgCrnaRate', e.target.value)} placeholder="260" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <span style={label}>Agency MD shifts /mo</span>
          <input style={input} type="number" min="0" value={setup.agencyAnesthesiologistsPerMonth} onChange={e => f('agencyAnesthesiologistsPerMonth', e.target.value)} placeholder="0" />
        </div>
        <div>
          <span style={label}>Agency CRNA shifts /mo</span>
          <input style={input} type="number" min="0" value={setup.agencyCrnasPerMonth} onChange={e => f('agencyCrnasPerMonth', e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <span style={label}>Agency MD bill rate</span>
          <input style={input} type="number" value={setup.agencyAnesthesiologistRate} onChange={e => f('agencyAnesthesiologistRate', e.target.value)} placeholder="est. $425" />
        </div>
        <div>
          <span style={label}>Agency CRNA bill rate</span>
          <input style={input} type="number" value={setup.agencyCrnaRate} onChange={e => f('agencyCrnaRate', e.target.value)} placeholder="est. $300" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <span style={label}>Shift hours</span>
          <input style={input} type="number" value={setup.avgShiftHours} onChange={e => f('avgShiftHours', e.target.value)} />
        </div>
        <div>
          <span style={label}>Operating days /yr</span>
          <input style={input} type="number" value={setup.operatingDaysPerYear} onChange={e => f('operatingDaysPerYear', e.target.value)} />
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16, marginBottom: 18 }}>
        <span style={label}>Tier to present (slide 7)</span>
        <select style={input} value={setup.tierKey} onChange={e => f('tierKey', e.target.value)}>
          {PITCH_TIERS.map(t => (
            <option key={t.key} value={t.key}>{t.label} — {fmt$(t.monthly)}/mo</option>
          ))}
          <option value="CUSTOM">Custom price…</option>
        </select>
        {setup.tierKey === 'CUSTOM' && (
          <input style={{ ...input, marginTop: 10 }} type="number" value={setup.customMonthlyPrice} onChange={e => f('customMonthlyPrice', e.target.value)} placeholder="Custom $/month" />
        )}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#FCA5A5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>{error}</div>
      )}
      <button
        onClick={onCalculate}
        disabled={calculating || !setup.totalLocations}
        style={{ width: '100%', padding: '14px', background: setup.totalLocations ? '#2563EB' : 'rgba(37,99,235,0.3)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 800, cursor: setup.totalLocations ? 'pointer' : 'default' }}
      >
        {calculating ? 'Computing…' : 'Compute Their Number →'}
      </button>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 10, lineHeight: 1.5 }}>
        Setup is saved on this machine so the deck is ready when the meeting starts.
      </div>
    </div>
  )
}

// ─── Calibration: projected vs realized savings, per facility ─────────────────
// The accuracy record behind the hero number. Measurement only — auto-adjusting
// projections from these ratios is deliberately OFF until enough history exists
// (see Notion task "Turn ON StaffIQ auto-calibration").
function CalibrationSection() {
  const [cal, setCal] = useState(null)
  const [calLoading, setCalLoading] = useState(true)
  const [snapRunning, setSnapRunning] = useState(false)

  function load() {
    adminAPI.getStaffIQCalibration()
      .then((d) => setCal(d))
      .catch(() => setCal(null))
      .finally(() => setCalLoading(false))
  }
  useEffect(load, [])

  async function runSnapshot() {
    setSnapRunning(true)
    try {
      await adminAPI.runStaffIQCalibrationSnapshot()
      load()
    } catch { /* non-fatal */ } finally {
      setSnapRunning(false)
    }
  }

  const rows = cal?.facilities || []

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '28px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🎯</span>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
            Savings Calibration — Projected vs Realized
          </h2>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '3px 10px', borderRadius: 20, background: '#FEF3C7', color: '#B45309', border: '1px solid #FCD34D' }}>
            AUTO-CALIBRATION OFF
          </span>
        </div>
        <button
          onClick={runSnapshot}
          disabled={snapRunning}
          style={{ padding: '8px 16px', background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: snapRunning ? 'wait' : 'pointer' }}
        >
          {snapRunning ? 'Recording…' : 'Record Snapshot Now'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 18px', lineHeight: 1.6, maxWidth: 780 }}>
        Every month StaffIQ records what it projected next to what it measured for each facility.
        This is the accuracy record that makes the hero number defensible — and the data that will
        drive auto-calibration once a facility has 3+ matched cycles (turn-on is a deliberate
        decision, tracked in Notion).
      </p>
      {calLoading ? (
        <div style={{ color: '#94A3B8', fontSize: 13, padding: '12px 0' }}>Loading calibration…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic', padding: '12px 0' }}>
          No snapshots yet — the first one records automatically on the 1st of the month, or click "Record Snapshot Now".
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>Facility</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>Snapshots</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>Matched Cycles</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>Latest Projected</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>Latest Realized</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>Realized ÷ Projected</th>
              <th style={{ padding: '8px 0 8px 12px', fontWeight: 700 }}>Calibration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const latest = r.snapshots[r.snapshots.length - 1] || {}
              return (
                <tr key={r.facilityId} style={{ borderTop: '1px solid #F1F5F9', color: '#0F172A' }}>
                  <td style={{ padding: '10px 12px 10px 0', fontWeight: 600 }}>{r.facilityName}</td>
                  <td style={{ padding: '10px 12px' }}>{r.snapshots.length}</td>
                  <td style={{ padding: '10px 12px' }}>{r.matchedCycles}</td>
                  <td style={{ padding: '10px 12px' }}>{latest.projected != null ? fmt$(latest.projected) : '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{latest.realized != null ? fmt$(latest.realized) : '—'}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: r.avgRealizedToProjected == null ? '#94A3B8' : (r.avgRealizedToProjected >= 0.9 ? '#059669' : '#B45309') }}>
                    {r.avgRealizedToProjected != null ? `${Math.round(r.avgRealizedToProjected * 100)}%` : '—'}
                  </td>
                  <td style={{ padding: '10px 0 10px 12px' }}>
                    {r.readyForCalibration
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>READY (awaiting turn-on)</span>
                      : <span style={{ fontSize: 11, color: '#94A3B8' }}>{r.matchedCycles}/3 cycles</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
// autoPitch: open straight into presentation mode (the "Sales Pitch Deck"
// sidebar entry). onNavigate: admin page navigation (used by the deck's
// Start Onboarding close to jump to Facilities).
export default function AdminStaffIQPage({ autoPitch = false, onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [pitchMode, setPitchMode] = useState(false)
  const [pitchPage, setPitchPage] = useState(0)
  const [showScript, setShowScript] = useState(true)
  const [showSetup, setShowSetup] = useState(false)
  const [setup, setSetup] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETUP_STORAGE_KEY))
      return saved ? { ...DEFAULT_SETUP, ...saved } : DEFAULT_SETUP
    } catch { return DEFAULT_SETUP }
  })
  const [projection, setProjection] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState(null)

  useEffect(() => {
    adminAPI.getStaffIQAnalytics()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    try { localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(setup)) } catch { /* ignore */ }
  }, [setup])

  async function calculate() {
    setCalculating(true)
    setCalcError(null)
    try {
      const p = await adminAPI.pitchProjection(setup)
      if (p?.basis === 'insufficient') {
        setCalcError('Enter at least the number of anesthetizing locations.')
        setProjection(null)
      } else {
        setProjection(p)
        setShowSetup(false)
      }
    } catch (e) {
      setCalcError(e.message || 'Failed to compute projection.')
    } finally {
      setCalculating(false)
    }
  }

  function openPitchMode() {
    setPitchMode(true)
    setPitchPage(0)
    // Recompute silently if a baseline is saved but nothing computed yet.
    if (!projection && setup.totalLocations) calculate()
    if (!setup.totalLocations) setShowSetup(true)
  }

  // "Sales Pitch Deck" sidebar entry lands directly in presentation mode.
  useEffect(() => {
    if (autoPitch) openPitchMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPitch])

  // The deck's close: leave pitch mode and jump to Facilities to create the
  // prospect's account (agreement is accepted in-app at their first login).
  function startOnboarding() {
    setPitchMode(false)
    if (onNavigate) onNavigate('facilities')
  }

  const metrics = [
    { label: 'Total Insights Generated', value: data?.totalInsights ?? '—', icon: '🧠', color: '#2563EB' },
    { label: 'Total Dollar Savings Calculated', value: fmt$(data?.totalSavings), icon: '💰', color: '#10B981' },
    { label: 'Most Common Inefficiency Type', value: data?.topInefficencyType || '—', icon: '📊', color: '#F59E0B' },
    { label: 'Avg Savings Per Facility / Month', value: fmt$(data?.avgSavingsPerFacilityMonth), icon: '📈', color: '#1E3A8A' },
  ]

  const CurrentSlide = SLIDES[pitchPage].Component

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
          {/* Setup gear */}
          <button
            onClick={() => setShowSetup(s => !s)}
            title="Prospect baseline"
            style={{ position: 'absolute', top: 24, right: 84, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 16, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          >
            ⚙
          </button>

          {showSetup && (
            <PitchSetupPanel
              setup={setup}
              setSetup={setSetup}
              onCalculate={calculate}
              calculating={calculating}
              onClose={() => setShowSetup(false)}
              error={calcError}
            />
          )}

          {/* Header */}
          <div style={{ padding: '28px 60px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#2563EB', letterSpacing: '0.1em', textTransform: 'uppercase' }}>SNAP Medical</div>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
              {setup.prospectName ? `Pitch — ${setup.prospectName}` : 'Facility Pitch Deck'}
            </div>
            {projection?.monthly != null && (
              <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700 }}>· {fmt$(projection.monthly)}/mo projected</div>
            )}
          </div>

          {/* Slide content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 80px', overflowY: 'auto' }}>
            <CurrentSlide p={projection} setup={setup} onOpenSetup={() => setShowSetup(true)} onStartOnboarding={startOnboarding} />
          </div>

          {/* Presenter script (talk track) — hidden with one click when screen-sharing */}
          {showScript && (
            <div style={{ margin: '0 60px', padding: '12px 18px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Presenter script — hide before screen-sharing</div>
              <div style={{ fontSize: 12.5, color: '#CBD5E1', lineHeight: 1.6 }}>{SLIDES[pitchPage].script}</div>
            </div>
          )}

          {/* Navigation */}
          <div style={{ padding: '18px 60px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setPitchPage(p => Math.max(0, p - 1))}
                disabled={pitchPage === 0}
                style={{ padding: '10px 24px', background: pitchPage === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: pitchPage === 0 ? '#475569' : '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: pitchPage === 0 ? 'not-allowed' : 'pointer' }}
              >
                ← Previous
              </button>
              <button
                onClick={() => setShowScript(s => !s)}
                style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: showScript ? '#FCD34D' : '#64748B', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {showScript ? 'Hide Script' : 'Show Script'}
              </button>
            </div>
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

          <CalibrationSection />

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
