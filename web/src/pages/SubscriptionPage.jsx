import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../api.js'

const TIERS = [
  {
    id: 'BASIC',
    name: 'Basic',
    price: '$750',
    per: '/mo',
    color: '#6366F1',
    accent: '#EEF2FF',
    limit: '4 shifts/month',
    features: [
      { text: '4 shifts per month', included: true },
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
    price: '$2,000',
    per: '/mo',
    color: '#7C3AED',
    accent: '#F3E8FF',
    popular: true,
    features: [
      { text: '20 shifts per month', included: true },
      { text: 'Credentialed provider pool', included: true },
      { text: 'Cost savings dashboard', included: true },
      { text: 'Priority email & phone support', included: true },
      { text: 'Preferred provider list', included: true },
      { text: 'Early access posting (1-4 hrs)', included: true },
      { text: 'Featured listings', included: true },
      { text: 'Surge pricing', included: true },
      { text: 'Dedicated account manager', included: false },
    ],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: '$5,000',
    per: '/mo',
    color: '#0F172A',
    accent: '#F8FAFC',
    features: [
      { text: 'Unlimited shifts', included: true },
      { text: 'Credentialed provider pool', included: true },
      { text: 'Cost savings dashboard', included: true },
      { text: 'Dedicated account manager', included: true },
      { text: 'Preferred provider list', included: true },
      { text: 'Early access posting (1-4 hrs)', included: true },
      { text: 'Featured listings', included: true },
      { text: 'Surge pricing', included: true },
      { text: 'VIP provider access', included: true },
      { text: 'Custom contract terms', included: true },
      { text: 'Multi-location support', included: true },
      { text: 'API access', included: true },
    ],
  },
]

export default function SubscriptionPage() {
  const [currentTier, setCurrentTier] = useState('BASIC')
  const [usage, setUsage]             = useState({ shiftsThisMonth: 2 })
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    facilityAPI.getSubscription()
      .then((data) => {
        setCurrentTier(data.tier || 'BASIC')
        setUsage(data.usage || { shiftsThisMonth: 0 })
      })
      .catch(() => {
        setCurrentTier('BASIC')
        setUsage({ shiftsThisMonth: 2 })
      })
      .finally(() => setLoading(false))
  }, [])

  const currentConfig = TIERS.find((t) => t.id === currentTier) || TIERS[0]

  return (
    <div style={{ padding: '32px 40px' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Subscription</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Manage your SNAP subscription plan
        </p>
      </div>

      {/* Current plan badge */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: '24px 28px',
          marginBottom: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Current Plan
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: currentConfig.color }}>
              {currentConfig.name}
            </span>
            <span
              style={{
                background: currentConfig.accent,
                color: currentConfig.color,
                border: `1px solid ${currentConfig.color}30`,
                borderRadius: 20,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ACTIVE
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            {currentConfig.price}{currentConfig.per} · Renews monthly
          </div>
        </div>

        {currentTier === 'BASIC' && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Shifts this month</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>
              {usage.shiftsThisMonth}{' '}
              <span style={{ fontSize: 14, fontWeight: 400, color: '#94A3B8' }}>/ 4</span>
            </div>
            <div style={{ width: 160, height: 6, background: '#F1F5F9', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(usage.shiftsThisMonth / 4) * 100}%`,
                  background: usage.shiftsThisMonth >= 4 ? '#EF4444' : '#6366F1',
                  borderRadius: 3,
                  transition: 'width 0.4s',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {TIERS.map((tier) => {
          const isCurrent = tier.id === currentTier
          return (
            <div
              key={tier.id}
              style={{
                background: '#fff',
                border: isCurrent ? `2px solid #6366F1` : '1px solid #E2E8F0',
                borderRadius: 20,
                padding: '28px 24px',
                position: 'relative',
                boxShadow: isCurrent ? '0 0 0 4px rgba(99,102,241,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'box-shadow 0.2s',
              }}
            >
              {tier.popular && (
                <div
                  style={{
                    position: 'absolute',
                    top: -13,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#7C3AED',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 14px',
                    borderRadius: 20,
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  MOST POPULAR
                </div>
              )}

              {isCurrent && (
                <div
                  style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    background: '#EEF2FF',
                    color: '#6366F1',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 20,
                    letterSpacing: '0.05em',
                  }}
                >
                  YOUR PLAN
                </div>
              )}

              <div style={{ fontWeight: 700, fontSize: 20, color: '#0F172A', marginBottom: 4 }}>
                {tier.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 24 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: tier.color }}>
                  {tier.price}
                </span>
                <span style={{ fontSize: 14, color: '#94A3B8' }}>{tier.per}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                {tier.features.map((f) => (
                  <div key={f.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                    <span
                      style={{
                        color: f.included ? '#10B981' : '#CBD5E1',
                        flexShrink: 0,
                        fontWeight: 700,
                        marginTop: 1,
                      }}
                    >
                      {f.included ? '✓' : '✗'}
                    </span>
                    <span style={{ color: f.included ? '#374151' : '#CBD5E1' }}>{f.text}</span>
                  </div>
                ))}
              </div>

              {isCurrent ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '11px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 10,
                    fontSize: 13,
                    color: '#94A3B8',
                    fontWeight: 600,
                  }}
                >
                  Current Plan
                </div>
              ) : tier.id === 'ENTERPRISE' ? (
                <a
                  href="mailto:hello@snapmedical.com"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: '11px',
                    background: '#0F172A',
                    color: '#fff',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  Contact Us to Upgrade
                </a>
              ) : (
                <div style={{ position: 'relative' }}>
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: '11px',
                      background: '#6366F1',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'not-allowed',
                      opacity: 0.6,
                    }}
                  >
                    Upgrade to {tier.name}
                  </button>
                  <div
                    style={{
                      position: 'absolute',
                      top: -10,
                      right: -8,
                      background: '#F59E0B',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 20,
                      letterSpacing: '0.04em',
                      boxShadow: '0 2px 6px rgba(245,158,11,0.4)',
                    }}
                  >
                    COMING SOON
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p style={{ textAlign: 'center', fontSize: 13, color: '#94A3B8', marginTop: 24 }}>
        Need help choosing a plan?{' '}
        <a href="mailto:hello@snapmedical.com" style={{ color: '#6366F1', fontWeight: 600 }}>
          Contact our team
        </a>
      </p>
    </div>
  )
}
