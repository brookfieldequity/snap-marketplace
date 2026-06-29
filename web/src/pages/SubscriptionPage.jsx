import React, { useState, useEffect, useRef } from 'react'
import { facilityAPI } from '../api.js'

const AGREEMENT_VERSION = 'v1.0-2026-06-29'

const AGREEMENT_TEXT = `SNAP MEDICAL TECHNOLOGIES — SUBSCRIPTION AGREEMENT & BUSINESS ASSOCIATE AGREEMENT

Effective upon acceptance. Version ${AGREEMENT_VERSION}.

This Subscription Agreement and Business Associate Agreement ("Agreement") is entered into between SNAP Medical Technologies, LLC ("SNAP Medical", "we", "us") and the subscribing facility ("Facility", "you") upon electronic acceptance.

────────────────────────────────────────
PART 1 — SUBSCRIPTION TERMS
────────────────────────────────────────

1. SERVICES. SNAP Medical grants Facility a non-exclusive, non-transferable license to access and use the SNAP Medical platform (including SNAP Shifts, SNAP Marketplace, SNAP Credentialing, and SNAP Ops) during the subscription term, subject to the selected tier.

2. FEES & BILLING. Subscription fees are charged monthly in advance at the rate corresponding to your selected tier (Basic: $2,500/mo; Professional: $5,000/mo; Enterprise: $10,000/mo). Fees are due upon invoice. Unpaid invoices accrue interest at 1.5% per month. Prices may be updated with 30 days written notice.

3. TERM & CANCELLATION. The subscription continues on a monthly basis until cancelled. Either party may cancel with 30 days written notice. No refunds are issued for partial months.

4. ACCEPTABLE USE. Facility agrees to use the platform solely for lawful workforce management purposes. Facility shall not resell access, reverse engineer the platform, or use it to violate applicable law.

5. INTELLECTUAL PROPERTY. All platform software, algorithms, and content remain the exclusive property of SNAP Medical. This Agreement grants no ownership rights.

6. LIMITATION OF LIABILITY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, SNAP MEDICAL'S LIABILITY IS LIMITED TO THE FEES PAID IN THE THREE MONTHS PRECEDING THE CLAIM. SNAP MEDICAL IS NOT LIABLE FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES.

7. GOVERNING LAW. This Agreement is governed by the laws of the Commonwealth of Massachusetts.

────────────────────────────────────────
PART 2 — HIPAA BUSINESS ASSOCIATE AGREEMENT
────────────────────────────────────────

This Business Associate Agreement ("BAA") is entered into pursuant to the Health Insurance Portability and Accountability Act of 1996 ("HIPAA") and the HITECH Act.

8. DEFINITIONS. "Protected Health Information" or "PHI" has the meaning given under 45 CFR § 160.103. "Covered Entity" means Facility. "Business Associate" means SNAP Medical.

9. PERMITTED USES. Business Associate may use and disclose PHI only as necessary to provide the contracted services, as required by law, or as otherwise permitted under HIPAA. Business Associate shall not use PHI for its own purposes beyond service delivery.

10. SAFEGUARDS. Business Associate agrees to implement appropriate administrative, physical, and technical safeguards to protect PHI in accordance with HIPAA Security Rule requirements (45 CFR Part 164, Subpart C).

11. BREACH NOTIFICATION. Business Associate shall notify Covered Entity without unreasonable delay, and in no case later than 60 calendar days, upon discovery of a breach of unsecured PHI, consistent with 45 CFR § 164.410.

12. SUBCONTRACTORS. Business Associate shall ensure that any subcontractors who create, receive, maintain, or transmit PHI on Business Associate's behalf agree to the same restrictions and conditions that apply to Business Associate under this BAA.

13. INDIVIDUAL RIGHTS. Business Associate agrees to make PHI available to Covered Entity as needed to fulfill individuals' rights of access, amendment, and accounting of disclosures under HIPAA.

14. TERMINATION. Upon termination of this Agreement, Business Associate shall return or destroy all PHI received from Covered Entity, if feasible. If return or destruction is not feasible, Business Associate shall extend the protections of this BAA to the PHI and limit further uses and disclosures to those purposes that make return or destruction infeasible.

15. NO THIRD-PARTY BENEFICIARIES. This BAA is for the sole benefit of the parties and does not create rights in any third party.

16. AMENDMENT. The parties agree to amend this BAA as necessary to comply with changes in applicable law.

────────────────────────────────────────

By clicking "I Agree & Confirm Plan", you (a) represent that you have authority to bind the Facility to this Agreement, (b) acknowledge that you have read and understood these terms, and (c) agree that your electronic acceptance constitutes a legally binding signature.`

const TIERS = [
  {
    id: 'BASIC',
    name: 'Basic',
    price: '$2,500',
    per: '/mo',
    color: '#2563EB',
    accent: '#EFF6FF',
    features: [
      { text: 'Full scheduling & marketplace access', included: true },
      { text: 'Credentialed provider pool', included: true },
      { text: 'Cost savings dashboard', included: true },
      { text: 'Email support', included: true },
      { text: 'Preferred provider list', included: false },
      { text: 'Featured listings', included: false },
      { text: 'Surge pricing', included: false },
      { text: 'Dedicated account manager', included: false },
    ],
  },
  {
    id: 'PROFESSIONAL',
    name: 'Professional',
    price: '$5,000',
    per: '/mo',
    color: '#1E3A8A',
    accent: '#F3E8FF',
    popular: true,
    features: [
      { text: 'Full scheduling & marketplace access', included: true },
      { text: 'Credentialed provider pool', included: true },
      { text: 'Cost savings dashboard', included: true },
      { text: 'Priority email & phone support', included: true },
      { text: 'Preferred provider list', included: true },
      { text: 'Early access posting (1–4 hrs)', included: true },
      { text: 'Featured listings', included: true },
      { text: 'Surge pricing', included: true },
      { text: 'Dedicated account manager', included: false },
    ],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: '$10,000',
    per: '/mo',
    color: '#0F172A',
    accent: '#F8FAFC',
    features: [
      { text: 'Unlimited usage', included: true },
      { text: 'Credentialed provider pool', included: true },
      { text: 'Cost savings dashboard', included: true },
      { text: 'Dedicated account manager', included: true },
      { text: 'Preferred provider list', included: true },
      { text: 'Early access posting (1–4 hrs)', included: true },
      { text: 'Featured listings', included: true },
      { text: 'Surge pricing', included: true },
      { text: 'VIP provider access', included: true },
      { text: 'Custom contract terms', included: true },
      { text: 'Volume pricing for large multi-site groups & health systems', included: true },
      { text: 'Multi-location support', included: true },
      { text: 'API access', included: true },
    ],
  },
]

function AgreementModal({ tier, onConfirm, onCancel, loading }) {
  const [agreed, setAgreed]       = useState(false)
  const [scrolled, setScrolled]   = useState(false)
  const scrollRef                 = useRef(null)

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setScrolled(true)
  }

  const tierConfig = TIERS.find(t => t.id === tier)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 640,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Subscription Agreement & BAA
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
            Confirm {tierConfig?.name} Plan — {tierConfig?.price}/mo
          </div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
            Please read and accept the terms below to activate your plan.
          </div>
        </div>

        {/* Scrollable agreement */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: 'auto', padding: '20px 28px',
            fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
            color: '#374151', whiteSpace: 'pre-wrap',
          }}
        >
          {AGREEMENT_TEXT}
        </div>

        {!scrolled && (
          <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#94A3B8' }}>
            Scroll to read the full agreement
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '16px 28px 24px', borderTop: '1px solid #E2E8F0' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
              I agree to the SNAP Medical Subscription Terms and Business Associate Agreement ({AGREEMENT_VERSION}) on behalf of my facility.
            </span>
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onCancel}
              disabled={loading}
              style={{
                flex: 1, padding: '12px', background: '#F8FAFC',
                border: '1px solid #E2E8F0', borderRadius: 10,
                fontSize: 14, fontWeight: 600, color: '#64748B', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => agreed && onConfirm()}
              disabled={!agreed || loading}
              style={{
                flex: 2, padding: '12px',
                background: agreed && !loading ? tierConfig?.color || '#2563EB' : '#E2E8F0',
                border: 'none', borderRadius: 10,
                fontSize: 14, fontWeight: 700,
                color: agreed && !loading ? '#fff' : '#94A3B8',
                cursor: agreed && !loading ? 'pointer' : 'not-allowed',
                transition: 'background 0.2s',
              }}
            >
              {loading ? 'Activating…' : 'I Agree & Confirm Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  const [currentTier, setCurrentTier] = useState('BASIC')
  const [usage, setUsage]             = useState({ shiftsThisMonth: 0 })
  const [loading, setLoading]         = useState(true)
  const [confirmingTier, setConfirmingTier] = useState(null)
  const [upgrading, setUpgrading]     = useState(false)
  const [successMsg, setSuccessMsg]   = useState('')
  const [error, setError]             = useState('')

  useEffect(() => {
    facilityAPI.getSubscription()
      .then((data) => {
        setCurrentTier(data.subscription?.tier || 'BASIC')
        setUsage(data.usage || { shiftsThisMonth: 0 })
      })
      .catch(() => setCurrentTier('BASIC'))
      .finally(() => setLoading(false))
  }, [])

  async function handleConfirm() {
    setUpgrading(true)
    setError('')
    try {
      const data = await facilityAPI.upgradeSubscription(confirmingTier, AGREEMENT_VERSION)
      setCurrentTier(data.subscription.tier)
      setConfirmingTier(null)
      setSuccessMsg(`Plan updated to ${TIERS.find(t => t.id === data.subscription.tier)?.name}. Our team will be in touch about billing.`)
    } catch (err) {
      setError(err.message || 'Could not update plan. Please contact support.')
      setConfirmingTier(null)
    } finally {
      setUpgrading(false)
    }
  }

  const currentConfig = TIERS.find((t) => t.id === currentTier) || TIERS[0]

  return (
    <div style={{ padding: '32px 40px' }}>

      {confirmingTier && (
        <AgreementModal
          tier={confirmingTier}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmingTier(null)}
          loading={upgrading}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Subscription</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Manage your SNAP subscription plan
        </p>
      </div>

      {successMsg && (
        <div style={{
          background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12,
          padding: '14px 18px', marginBottom: 24, fontSize: 14, color: '#166534', fontWeight: 500,
        }}>
          {successMsg}
        </div>
      )}

      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12,
          padding: '14px 18px', marginBottom: 24, fontSize: 14, color: '#991B1B', fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* Current plan badge */}
      <div style={{
        background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16,
        padding: '24px 28px', marginBottom: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Current Plan
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: currentConfig.color }}>
              {currentConfig.name}
            </span>
            <span style={{
              background: currentConfig.accent, color: currentConfig.color,
              border: `1px solid ${currentConfig.color}30`,
              borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700,
            }}>
              ACTIVE
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            {currentConfig.price}{currentConfig.per} · Billed monthly
          </div>
        </div>
      </div>

      {/* Tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {TIERS.map((tier) => {
          const isCurrent = tier.id === currentTier
          const isEnterprise = tier.id === 'ENTERPRISE'
          return (
            <div
              key={tier.id}
              style={{
                background: '#fff',
                border: isCurrent ? `2px solid #2563EB` : '1px solid #E2E8F0',
                borderRadius: 20, padding: '28px 24px', position: 'relative',
                boxShadow: isCurrent ? '0 0 0 4px rgba(37,99,235,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'box-shadow 0.2s',
              }}
            >
              {tier.popular && (
                <div style={{
                  position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                  background: '#1E3A8A', color: '#fff', fontSize: 11, fontWeight: 700,
                  padding: '3px 14px', borderRadius: 20, letterSpacing: '0.05em', whiteSpace: 'nowrap',
                }}>
                  MOST POPULAR
                </div>
              )}

              {isCurrent && (
                <div style={{
                  position: 'absolute', top: 16, right: 16,
                  background: '#EFF6FF', color: '#2563EB',
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, letterSpacing: '0.05em',
                }}>
                  YOUR PLAN
                </div>
              )}

              <div style={{ fontWeight: 700, fontSize: 20, color: '#0F172A', marginBottom: 4 }}>
                {tier.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 24 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: tier.color }}>{tier.price}</span>
                <span style={{ fontSize: 14, color: '#94A3B8' }}>{tier.per}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                {tier.features.map((f) => (
                  <div key={f.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                    <span style={{ color: f.included ? '#10B981' : '#CBD5E1', flexShrink: 0, fontWeight: 700, marginTop: 1 }}>
                      {f.included ? '✓' : '✗'}
                    </span>
                    <span style={{ color: f.included ? '#374151' : '#CBD5E1' }}>{f.text}</span>
                  </div>
                ))}
              </div>

              {isCurrent ? (
                <div style={{
                  textAlign: 'center', padding: '11px', background: '#F8FAFC',
                  border: '1px solid #E2E8F0', borderRadius: 10,
                  fontSize: 13, color: '#94A3B8', fontWeight: 600,
                }}>
                  Current Plan
                </div>
              ) : isEnterprise ? (
                <a
                  href="mailto:hello@snapmedical.app"
                  style={{
                    display: 'block', textAlign: 'center', padding: '11px',
                    background: '#0F172A', color: '#fff', borderRadius: 10,
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  Contact Us to Upgrade
                </a>
              ) : (
                <button
                  onClick={() => { setError(''); setSuccessMsg(''); setConfirmingTier(tier.id) }}
                  style={{
                    width: '100%', padding: '11px', background: tier.color,
                    color: '#fff', border: 'none', borderRadius: 10,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {loading ? '…' : `Select ${tier.name} Plan`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p style={{ textAlign: 'center', fontSize: 13, color: '#94A3B8', marginTop: 24 }}>
        Need help choosing a plan?{' '}
        <a href="mailto:hello@snapmedical.app" style={{ color: '#2563EB', fontWeight: 600 }}>
          Contact our team
        </a>
      </p>
    </div>
  )
}
