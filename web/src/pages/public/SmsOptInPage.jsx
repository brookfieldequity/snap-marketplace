import React, { useState } from 'react'
import { smsAPI } from '../../api'

// Public, no-login SMS opt-in form served at /sms-optin. This is the
// customer-facing consent page supplied to Twilio for toll-free verification:
// SNAP branding, a phone number input, the full CTIA consent disclosure, and
// a submit button. SNAP is the message sender (single brand) — providers opt
// in directly with SNAP, and sendSMS() on the backend only texts numbers
// recorded here (or via the availability-page consent checkbox).
//
// Keep the checkbox copy in sync with CONSENT_TEXT_V1 in
// backend/src/routes/sms.js — that constant is snapshotted onto each consent
// record as evidence of what was agreed to.

function formatPhoneInput(raw) {
  const d = raw.replace(/\D/g, '').replace(/^1/, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function isValidPhone(raw) {
  return raw.replace(/\D/g, '').replace(/^1/, '').length === 10
}

export default function SmsOptInPage() {
  const [mode, setMode] = useState('optin') // 'optin' | 'optout'
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // 'optin' | 'optout'
  const [error, setError] = useState(null)

  const canSubmit = isValidPhone(phone) && (mode === 'optout' || consent) && !busy

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'optin') {
        await smsAPI.optIn({ phoneNumber: phone, firstName, lastName, consent: true })
        setDone('optin')
      } else {
        await smsAPI.optOut(phone)
        setDone('optout')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m) => {
    setMode(m)
    setDone(null)
    setError(null)
    setConsent(false)
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <span style={styles.brand}>SNAP</span>
          <span style={styles.brandSub}>Medical</span>
        </div>

        {done === 'optin' ? (
          <div>
            <h1 style={styles.h1}>You&rsquo;re opted in ✓</h1>
            <p style={styles.p}>
              <strong>{formatPhoneInput(phone)}</strong> will now receive SNAP
              scheduling texts — availability requests, posted schedules, and
              shift notifications.
            </p>
            <p style={styles.p}>
              You can stop at any time by replying <strong>STOP</strong> to any
              message, or by using the{' '}
              <button type="button" style={styles.linkBtn} onClick={() => switchMode('optout')}>opt-out form</button>.
            </p>
          </div>
        ) : done === 'optout' ? (
          <div>
            <h1 style={styles.h1}>You&rsquo;ve been opted out</h1>
            <p style={styles.p}>
              <strong>{formatPhoneInput(phone)}</strong> will no longer receive
              SNAP texts. Changed your mind? You can{' '}
              <button type="button" style={styles.linkBtn} onClick={() => switchMode('optin')}>opt back in</button>{' '}
              whenever you like.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={styles.h1}>
              {mode === 'optin' ? 'Get SNAP scheduling texts' : 'Stop SNAP texts'}
            </h1>
            <p style={styles.meta}>
              {mode === 'optin'
                ? 'Text notifications from SNAP for providers: availability requests, posted schedules, and shift updates.'
                : 'Enter your number below and we will stop sending texts to it. You can also just reply STOP to any message.'}
            </p>

            {mode === 'optin' && (
              <div style={styles.nameRow}>
                <input
                  style={styles.input}
                  placeholder="First name (optional)"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                />
                <input
                  style={styles.input}
                  placeholder="Last name (optional)"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            )}

            <label style={styles.label} htmlFor="sms-phone">Mobile phone number</label>
            <input
              id="sms-phone"
              style={{ ...styles.input, fontSize: 17, letterSpacing: '0.02em' }}
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              autoComplete="tel-national"
            />

            {mode === 'optin' && (
              <label style={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.consentText}>
                  I agree to receive scheduling and account text messages from
                  SNAP (Essential Anesthesia Partners LLC, d/b/a SNAP Medical
                  Technologies) at the number provided. Message frequency varies;
                  message &amp; data rates may apply. Reply <strong>STOP</strong> to
                  opt out, <strong>HELP</strong> for help. Consent is not a
                  condition of employment or service. See our{' '}
                  <a href="/sms-terms" target="_blank" rel="noreferrer" style={styles.a}>SMS Terms</a>{' '}
                  and{' '}
                  <a href="https://api.snapmedical.app/privacy" target="_blank" rel="noreferrer" style={styles.a}>Privacy Policy</a>.
                </span>
              </label>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" disabled={!canSubmit} style={{
              ...styles.submit,
              ...(canSubmit ? {} : styles.submitDisabled),
              ...(mode === 'optout' ? { background: '#DC2626' } : {}),
            }}>
              {busy ? 'Submitting…' : mode === 'optin' ? 'Opt in to texts' : 'Stop texting this number'}
            </button>

            <p style={styles.switchRow}>
              {mode === 'optin' ? (
                <>Want texts to stop instead?{' '}
                  <button type="button" style={styles.linkBtn} onClick={() => switchMode('optout')}>Opt out here</button>.</>
              ) : (
                <>Want to receive texts?{' '}
                  <button type="button" style={styles.linkBtn} onClick={() => switchMode('optin')}>Opt in here</button>.</>
              )}
            </p>
          </form>
        )}

        <p style={styles.legal}>
          SNAP is operated by Essential Anesthesia Partners LLC (d/b/a SNAP
          Medical Technologies), Massachusetts. Messages are sent by SNAP from
          855-677-7627 (855-677-SNAP). ·{' '}
          <a href="/sms-terms" style={styles.a}>SMS Terms</a> ·{' '}
          <a href="https://api.snapmedical.app/privacy" style={styles.a}>Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#F8FAFC', display: 'flex', justifyContent: 'center', padding: '40px 16px', boxSizing: 'border-box' },
  card: { maxWidth: 560, width: '100%', background: '#fff', border: '1px solid #DCE8F7', borderRadius: 16, padding: '36px 40px', boxShadow: '0 4px 16px rgba(15,23,42,0.04)', alignSelf: 'flex-start' },
  brandRow: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 24 },
  brand: { fontFamily: "'Nunito', 'Inter', sans-serif", fontSize: 24, fontWeight: 800, color: '#2563EB', letterSpacing: '-0.02em' },
  brandSub: { fontSize: 14, fontWeight: 600, color: '#64748B' },
  h1: { fontSize: 24, fontWeight: 800, color: '#10233F', margin: '0 0 6px', letterSpacing: '-0.01em' },
  meta: { fontSize: 14, lineHeight: 1.55, color: '#64748B', margin: '0 0 20px' },
  p: { fontSize: 15, lineHeight: 1.6, color: '#334155', margin: '0 0 10px' },
  nameRow: { display: 'flex', gap: 10, marginBottom: 12 },
  label: { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#475569', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 15, border: '1px solid #CBD5E1', borderRadius: 10, outline: 'none', color: '#10233F', background: '#fff' },
  consentRow: { display: 'flex', alignItems: 'flex-start', gap: 10, margin: '16px 0 0', cursor: 'pointer' },
  checkbox: { marginTop: 3, width: 17, height: 17, flex: 'none', accentColor: '#2563EB', cursor: 'pointer' },
  consentText: { fontSize: 12.5, lineHeight: 1.55, color: '#475569' },
  error: { marginTop: 14, padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 13, color: '#B91C1C' },
  submit: { marginTop: 18, width: '100%', padding: '13px 20px', background: 'linear-gradient(135deg,#2563EB,#3B82F6)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 16px rgba(37,99,235,0.25)' },
  submitDisabled: { background: '#CBD5E1', boxShadow: 'none', cursor: 'default' },
  switchRow: { fontSize: 13, color: '#64748B', margin: '14px 0 0', textAlign: 'center' },
  linkBtn: { background: 'none', border: 'none', padding: 0, color: '#2563EB', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline' },
  a: { color: '#2563EB', textDecoration: 'none', fontWeight: 600 },
  legal: { fontSize: 12, lineHeight: 1.5, color: '#94A3B8', margin: '28px 0 0', borderTop: '1px solid #DCE8F7', paddingTop: 16 },
}
