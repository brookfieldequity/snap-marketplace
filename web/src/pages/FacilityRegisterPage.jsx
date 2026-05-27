import React, { useState } from 'react'
import { facilityAPI } from '../api.js'

const FACILITY_TYPES = [
  'Ambulatory Surgery Center',
  'Hospital',
  'Surgical Hospital',
  'Specialty Clinic',
  'Other',
]

const TIERS = [
  {
    id: 'BASIC',
    name: 'Basic',
    price: '$750',
    per: '/mo',
    color: '#6366F1',
    features: [
      'Up to 4 shifts/month',
      'Access to credentialed providers',
      'Standard provider pool',
      'Email support',
      'Cost savings dashboard',
    ],
  },
  {
    id: 'PROFESSIONAL',
    name: 'Professional',
    price: '$2,000',
    per: '/mo',
    color: '#7C3AED',
    popular: true,
    features: [
      'Up to 20 shifts/month',
      'Preferred provider list',
      'Early access posting (1-4 hrs)',
      'Featured shift listings',
      'Surge pricing access',
      'Priority support',
      'Cost savings dashboard',
    ],
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: '$5,000',
    per: '/mo',
    color: '#0F172A',
    features: [
      'Unlimited shifts',
      'Dedicated account manager',
      'VIP provider access',
      'Custom contract terms',
      'API access',
      'Multi-location support',
      'Priority support',
      'Cost savings dashboard',
    ],
  },
]

const MODE_OPTIONS = [
  {
    id: 'SHIFTS',
    label: 'SNAP Shifts',
    description: 'Optimize my internal scheduling and reduce staffing costs',
    icon: '📊',
  },
  {
    id: 'MARKETPLACE',
    label: 'SNAP Marketplace',
    description: 'Post open shifts and find qualified external providers',
    icon: '🌐',
  },
  {
    id: 'BOTH',
    label: 'Both',
    description: 'I want to use internal optimization and access external providers',
    icon: '⚡',
  },
]

export default function FacilityRegisterPage({ onLogin, onBack }) {
  const [step, setStep] = useState(1) // 1 = info, 2 = subscription, 3 = mode
  const [form, setForm] = useState({
    email: '',
    password: '',
    facilityName: '',
    facilityType: '',
    address: '',
    zipCode: '',
  })
  const [selectedTier, setSelectedTier] = useState('PROFESSIONAL')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  // Stored after step 2 registration succeeds, used in step 3
  const [registeredToken, setRegisteredToken] = useState(null)
  const [registeredName, setRegisteredName]   = useState('')

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    setError('')
    setLoading(true)
    try {
      const data = await facilityAPI.register({ ...form, subscriptionTier: selectedTier })
      const name = data.facility?.facilityName || form.facilityName
      setRegisteredToken(data.token)
      setRegisteredName(name)
      // Store the token so setMode call can use it
      localStorage.setItem('snapFacilityToken', data.token)
      setStep(3)
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
      setStep(1)
    } finally {
      setLoading(false)
    }
  }

  async function handleModeSelect(modeId) {
    try {
      await facilityAPI.setMode(modeId)
    } catch {
      // Don't block onboarding if mode set fails
    }
    onLogin(registeredToken, registeredName)
  }

  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    background: '#F8FAFC',
    border: '1.5px solid #E2E8F0',
    borderRadius: 10,
    fontSize: 14,
    color: '#0F172A',
    outline: 'none',
  }

  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 24px',
        overflowY: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: step === 2 ? 900 : step === 3 ? 680 : 480 }}>
        {/* Card */}
        <div
          style={{
            background: '#fff',
            borderRadius: 20,
            padding: '40px 40px',
            boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
          }}
        >
          {/* Back — hide on step 3 (after registration is done) */}
          {step < 3 && (
            <button
              onClick={step === 1 ? onBack : () => setStep(1)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: 13,
                cursor: 'pointer',
                marginBottom: 24,
                padding: 0,
              }}
            >
              ← {step === 1 ? 'Back' : 'Back to info'}
            </button>
          )}

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#6366F1', letterSpacing: '-0.04em' }}>
              SNAP
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginTop: 8 }}>
              {step === 1 ? 'Register Your Facility' : step === 2 ? 'Choose a Plan' : 'How would you like to use SNAP?'}
            </h1>
            <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
              {step === 1
                ? 'Step 1 of 3 — Facility information'
                : step === 2
                ? 'Step 2 of 3 — Select your subscription tier'
                : 'You can change this anytime in your settings'}
            </p>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 2,
                  background: s <= step ? '#6366F1' : '#E2E8F0',
                  transition: 'background 0.3s',
                }}
              />
            ))}
          </div>

          {/* Step 1 — Info */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="admin@facility.com"
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="••••••••"
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Facility Name</label>
                <input
                  type="text"
                  value={form.facilityName}
                  onChange={(e) => handleChange('facilityName', e.target.value)}
                  placeholder="Boston Surgery Center"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              <div>
                <label style={labelStyle}>Facility Type</label>
                <select
                  value={form.facilityType}
                  onChange={(e) => handleChange('facilityType', e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                >
                  <option value="">Select type...</option>
                  {FACILITY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Street Address</label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="123 Medical Plaza Dr"
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>ZIP Code</label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => handleChange('zipCode', e.target.value)}
                    placeholder="02101"
                    maxLength={5}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  if (!form.email || !form.password || !form.facilityName || !form.facilityType) {
                    setError('Please fill in all required fields.')
                    return
                  }
                  setError('')
                  setStep(2)
                }}
                style={{
                  width: '100%',
                  padding: '13px',
                  background: '#6366F1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: 8,
                }}
              >
                Continue →
              </button>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Subscription */}
          {step === 2 && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 32 }}>
                {TIERS.map((tier) => {
                  const isSelected = selectedTier === tier.id
                  return (
                    <div
                      key={tier.id}
                      onClick={() => setSelectedTier(tier.id)}
                      style={{
                        border: isSelected ? `2px solid #6366F1` : '2px solid #E2E8F0',
                        borderRadius: 16,
                        padding: '28px 24px',
                        cursor: 'pointer',
                        position: 'relative',
                        background: isSelected ? '#FAFAFE' : '#fff',
                        transition: 'all 0.2s ease',
                        boxShadow: isSelected ? '0 0 0 4px rgba(99,102,241,0.1)' : 'none',
                      }}
                    >
                      {tier.popular && (
                        <div
                          style={{
                            position: 'absolute',
                            top: -12,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#7C3AED',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 12px',
                            borderRadius: 20,
                            letterSpacing: '0.05em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          MOST POPULAR
                        </div>
                      )}

                      <div style={{ fontWeight: 700, fontSize: 18, color: '#0F172A', marginBottom: 4 }}>
                        {tier.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 20 }}>
                        <span style={{ fontSize: 32, fontWeight: 800, color: tier.color }}>
                          {tier.price}
                        </span>
                        <span style={{ fontSize: 14, color: '#94A3B8' }}>{tier.per}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {tier.features.map((f) => (
                          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151' }}>
                            <span style={{ color: '#10B981', flexShrink: 0, marginTop: 1 }}>✓</span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>

                      {isSelected && (
                        <div
                          style={{
                            marginTop: 20,
                            textAlign: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#6366F1',
                            letterSpacing: '0.04em',
                          }}
                        >
                          ✓ SELECTED
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626', marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: loading ? '#A5B4FC' : '#6366F1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Creating account...' : `Create Account — ${TIERS.find(t => t.id === selectedTier)?.name} Plan`}
              </button>

              <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 12 }}>
                By registering you agree to SNAP's Terms of Service. Payment details collected separately.
              </p>
            </div>
          )}

          {/* Step 3 — Mode Selection */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {MODE_OPTIONS.map((option) => (
                <div
                  key={option.id}
                  onClick={() => handleModeSelect(option.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    padding: '24px 28px',
                    border: '2px solid #E2E8F0',
                    borderRadius: 16,
                    cursor: 'pointer',
                    background: '#fff',
                    transition: 'all 0.18s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#6366F1'
                    e.currentTarget.style.background = '#F5F3FF'
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(99,102,241,0.1)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#E2E8F0'
                    e.currentTarget.style.background = '#fff'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{ fontSize: 36, flexShrink: 0 }}>{option.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                      {option.label}
                    </div>
                    <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.5 }}>
                      {option.description}
                    </div>
                  </div>
                  <div style={{ color: '#CBD5E1', fontSize: 20, flexShrink: 0 }}>→</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
