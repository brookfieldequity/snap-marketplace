import React, { useState } from 'react'
import { facilityAPI } from '../../api.js'

function fmt(n) {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 14,
  color: '#0F172A',
  background: '#F8FAFC',
  boxSizing: 'border-box',
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, lineHeight: 1.4 }}>
        {label}
      </label>
      {hint && (
        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>
      )}
      {children}
    </div>
  )
}

function ResultRow({ label, value, color, sub, size = 'normal' }) {
  return (
    <div style={{ marginBottom: size === 'large' ? 24 : 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: size === 'large' ? 44 : 28, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, fontStyle: 'italic' }}>{sub}</div>
      )}
    </div>
  )
}

// ─── Lead Capture ─────────────────────────────────────────────────────────────
function LeadCapture({ locations, providers, hourlyRate }) {
  const [form, setForm] = useState({ name: '', facilityName: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState(null)

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit() {
    if (!form.name.trim() || !form.facilityName.trim() || !form.email.trim()) {
      return setError('Name, Facility Name, and Email are required.')
    }
    if (!/\S+@\S+\.\S+/.test(form.email)) return setError('Please enter a valid email address.')
    setError(null)
    setSubmitting(true)
    try {
      await facilityAPI.submitStaffIQLead({
        locations,
        providers,
        hourlyRate,
        facilityName: form.facilityName,
        contactName: form.name,
        email: form.email,
        phone: form.phone,
      })
      setSuccess(form.email)
    } catch (e) {
      setError('Report generation failed: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
      borderRadius: 20,
      padding: '36px 40px',
      marginTop: 40,
      boxShadow: '0 20px 60px rgba(30,27,75,0.3)',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
        Get your free personalized StaffIQ savings report
      </div>
      <div style={{ fontSize: 14, color: '#A5B4FC', marginBottom: 28, lineHeight: 1.6 }}>
        We will generate a custom PDF report with your facility's specific numbers, a 12 month savings projection, and a detailed breakdown of where your inefficiencies are costing you money.
      </div>

      {success ? (
        <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 12, padding: '20px 24px', color: '#6EE7B7', fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Report on its way!</div>
          Your personalized StaffIQ savings report has been sent to <strong>{success}</strong>. Our team will follow up within 24 hours.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Your Name', key: 'name', placeholder: 'Dr. Jane Smith' },
              { label: 'Facility Name', key: 'facilityName', placeholder: 'Memorial Hospital' },
              { label: 'Email Address', key: 'email', placeholder: 'you@facility.com', type: 'email' },
              { label: 'Phone Number (optional)', key: 'phone', placeholder: '+1 (555) 000-0000', type: 'tel' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#A5B4FC', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {f.label}
                </label>
                <input
                  type={f.type || 'text'}
                  value={form[f.key]}
                  onChange={(e) => setF(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={{ ...inputStyle, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>
            ))}
          </div>
          {error && <div style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '13px 32px',
              background: '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(37,99,235,0.5)',
            }}
          >
            {submitting ? 'Generating...' : 'Generate My Free StaffIQ Report →'}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StaffIQCalculatorPage({ onNavigate }) {
  const [locations, setLocations] = useState(10)
  const [providers, setProviders] = useState(18)
  const [hourlyRate, setHourlyRate] = useState(290)

  // Live calculation
  const budget = locations * hourlyRate * 10 * 250
  const inefficiency1Cost = Math.round(budget * 0.075)
  const overstaffedRooms = locations * 0.25
  const inefficiency2Cost = Math.round(overstaffedRooms * 35 * 10 * 250)
  const totalInefficiency = inefficiency1Cost + inefficiency2Cost
  const inefficiencyPct = budget > 0 ? Math.round((totalInefficiency / budget) * 1000) / 10 : 0
  const potentialSavings = Math.round(budget * 0.08)

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
          StaffIQ Calculator
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          Get an instant estimate of your facility's staffing inefficiency and potential savings.
        </p>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* Left — Inputs */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '32px 36px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 28 }}>
            Your Facility
          </div>

          <Field label="How many anesthetizing locations does your facility have?">
            <input
              style={inputStyle}
              type="number"
              min="1"
              value={locations}
              onChange={e => setLocations(Number(e.target.value) || 0)}
            />
          </Field>

          <Field label="How many anesthesia providers are currently on your roster?">
            <input
              style={inputStyle}
              type="number"
              min="1"
              value={providers}
              onChange={e => setProviders(Number(e.target.value) || 0)}
            />
          </Field>

          <Field
            label="What is the average loaded cost per hour for your anesthesia providers?"
            hint="Include salary, benefits, and overhead. Typical range is $260 to $390 per hour."
          >
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748B', fontSize: 14, fontWeight: 600 }}>$</span>
              <input
                style={{ ...inputStyle, paddingLeft: 24 }}
                type="number"
                min="0"
                value={hourlyRate}
                onChange={e => setHourlyRate(Number(e.target.value) || 0)}
              />
            </div>
          </Field>

          <div style={{ marginTop: 8, padding: '12px 16px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>
            Results update instantly as you adjust your inputs. No account required.
          </div>
        </div>

        {/* Right — Results */}
        <div style={{ background: '#F8FAFC', borderRadius: 16, border: '1px solid #E2E8F0', padding: '32px 36px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 28 }}>
            Your Estimate
          </div>

          <ResultRow
            label="Your estimated annual staffing budget"
            value={fmt(budget)}
            color="#0F172A"
          />

          <div style={{ borderTop: '1px solid #E2E8F0', margin: '20px 0' }} />

          <ResultRow
            label="Annual waste from team model inefficiency (Inefficiency #1)"
            value={fmt(inefficiency1Cost)}
            color="#EF4444"
          />

          <ResultRow
            label="Annual waste from overstaffing to maximum capacity (Inefficiency #2)"
            value={fmt(inefficiency2Cost)}
            color="#F59E0B"
          />

          <div style={{ borderTop: '1px solid #E2E8F0', margin: '20px 0' }} />

          <ResultRow
            label="Total estimated annual staffing inefficiency"
            value={fmt(totalInefficiency)}
            color="#10B981"
            size="large"
            sub="Conservative estimate based on 8% industry standard inefficiency rate"
          />

          <div style={{ padding: '14px 18px', background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>
              Your facility is likely wasting <strong style={{ color: '#EF4444' }}>{inefficiencyPct}%</strong> of your annual staffing budget
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2563EB' }}>
              Potential annual savings with SNAP infrastructure: {fmt(potentialSavings)}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic', lineHeight: 1.5 }}>
            This calculator uses conservative industry standard estimates. StaffIQ's full analysis using your actual scheduling data typically identifies higher savings opportunities.
          </div>
        </div>
      </div>

      {/* Lead capture */}
      <LeadCapture locations={locations} providers={providers} hourlyRate={hourlyRate} />
    </div>
  )
}
