import React, { useEffect, useState } from 'react'
import { facilityClaimAPI } from '../api.js'

// Public claim page. Lives at /facility-claim/:token. The first surface a
// coordinator (or regional VP, later) sees of SNAP Medical, so:
//
//   - Names the inviter explicitly ("Matt Haverkamp invited you")
//   - Names the facility prominently — they should immediately see THEIR
//     facility's name, not generic SaaS copy.
//   - Warm peer-to-peer tone. Single field (password). No friction.
//
// Spec: snap-applications/capa-pilot/facility-invite-spec.md
//
// On successful claim, drops the returned JWT into localStorage.snapFacilityToken
// (matches the existing facility-portal auth pattern) and reloads to / so the
// app's normal portal selection picks up.

const REASON_COPY = {
  INVALID:         { title: 'This link isn’t valid', body: 'The invite link looks malformed. Double-check the URL or ask Matt to resend.' },
  NOT_FOUND:       { title: 'This invite link isn’t valid', body: 'We couldn’t find an active invite for this link. Ask Matt to send a fresh one.' },
  ALREADY_CLAIMED: { title: 'This invite has already been used', body: 'Looks like you (or someone with this invite) already set up the account. Try logging in with the email Matt invited.' },
  EXPIRED:         { title: 'This invite has expired', body: 'No problem — just ask Matt to send a new one and you’ll be back in business in a couple of minutes.' },
}

export default function FacilityClaimPage({ token }) {
  const [phase, setPhase]       = useState('loading')  // loading | ready | submitting | error | success
  const [info, setInfo]         = useState(null)
  const [errReason, setErrReason] = useState(null)
  const [errMessage, setErrMessage] = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [fieldError, setFieldError] = useState(null)

  // Look up the invite on mount.
  useEffect(() => {
    let cancelled = false
    facilityClaimAPI.getInfo(token)
      .then((data) => { if (!cancelled) { setInfo(data); setPhase('ready') } })
      .catch((err) => {
        if (cancelled) return
        // apiFetch sticks the response body into err.body when available
        const reason = err?.data?.reason || 'INVALID'
        const message = err?.data?.error || err.message || 'Unknown error.'
        setErrReason(reason)
        setErrMessage(message)
        setPhase('error')
      })
    return () => { cancelled = true }
  }, [token])

  async function submit(e) {
    e?.preventDefault()
    setFieldError(null)
    if (password.length < 8) { setFieldError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setFieldError('Passwords don’t match. Try again.'); return }
    setPhase('submitting')
    try {
      const result = await facilityClaimAPI.claim(token, password)
      if (result?.token) {
        localStorage.setItem('snapFacilityToken', result.token)
        if (result.facility?.name) localStorage.setItem('snapFacilityName', result.facility.name)
        setPhase('success')
        // Brief celebration + redirect.
        setTimeout(() => { window.location.href = '/' }, 1200)
      } else {
        setFieldError('Something went wrong setting up your account. Try again or contact Matt.')
        setPhase('ready')
      }
    } catch (err) {
      const message = err?.data?.error || err.message || 'Could not finish setup.'
      setFieldError(message)
      setPhase('ready')
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* SNAP Medical header */}
        <div style={styles.header}>
          <div style={styles.brand}>SNAP Medical</div>
        </div>

        <div style={styles.body}>
          {phase === 'loading' && <Loading />}

          {phase === 'error' && (
            <ErrorState
              title={REASON_COPY[errReason]?.title || 'This link isn’t working'}
              body={REASON_COPY[errReason]?.body || errMessage}
            />
          )}

          {(phase === 'ready' || phase === 'submitting') && info && (
            <ClaimForm
              info={info}
              password={password} setPassword={setPassword}
              confirm={confirm} setConfirm={setConfirm}
              showPwd={showPwd} setShowPwd={setShowPwd}
              submit={submit}
              submitting={phase === 'submitting'}
              fieldError={fieldError}
            />
          )}

          {phase === 'success' && info && <Success info={info} />}
        </div>

        <div style={styles.footer}>
          Questions? Reply to your invite email — it goes straight to Matt.
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ ...styles.spinner }} />
      <div style={{ fontSize: 14, color: '#64748B', marginTop: 16 }}>Checking your invite…</div>
    </div>
  )
}

function ErrorState({ title, body }) {
  return (
    <div style={{ padding: '20px 4px' }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>🙁</div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{title}</h2>
      <p style={{ marginTop: 12, fontSize: 15, color: '#374151', lineHeight: 1.6 }}>
        {body}
      </p>
      <div style={{ marginTop: 24, padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#64748B' }}>
        Email <a href="mailto:matt@snapmedical.app" style={{ color: '#6366F1', fontWeight: 700 }}>matt@snapmedical.app</a> if you need help — he’ll sort it out fast.
      </div>
    </div>
  )
}

function ClaimForm({ info, password, setPassword, confirm, setConfirm, showPwd, setShowPwd, submit, submitting, fieldError }) {
  const firstName = (info.invitedEmail || '').split('@')[0].split(/[._-]/)[0]
  const greeting = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there'
  const roleArticle = info.facilityRole === 'ADMIN' ? 'an administrator'
    : info.facilityRole === 'COORDINATOR' ? 'a coordinator'
    : 'a viewer'

  return (
    <>
      <h1 style={styles.welcome}>Welcome to SNAP Medical, {greeting}.</h1>
      <p style={styles.subline}>
        <strong>{info.invitedByName}</strong> invited you to manage{' '}
        <strong style={{ color: '#0F172A' }}>{info.facilityName}</strong> as {roleArticle}.
      </p>
      <p style={styles.subline2}>
        Set a password to continue. You’ll land right in your facility’s dashboard.
      </p>

      <form onSubmit={submit} style={{ marginTop: 24 }}>
        <label style={styles.label}>
          Email
          <input type="email" value={info.invitedEmail || ''} readOnly disabled style={{ ...styles.input, background: '#F8FAFC', color: '#64748B' }} />
        </label>

        <label style={styles.label}>
          Password
          <div style={{ position: 'relative' }}>
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              style={styles.input}
            />
            <button type="button" onClick={() => setShowPwd((v) => !v)} style={styles.showPwd}>
              {showPwd ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label style={styles.label}>
          Confirm password
          <input
            type={showPwd ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your password"
            style={styles.input}
          />
        </label>

        {fieldError && (
          <div style={styles.fieldError}>{fieldError}</div>
        )}

        <button type="submit" disabled={submitting} style={{ ...styles.submit, opacity: submitting ? 0.7 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>
          {submitting ? 'Setting up your account…' : 'Get Started →'}
        </button>
      </form>
    </>
  )
}

function Success({ info }) {
  return (
    <div style={{ padding: '20px 4px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0F172A' }}>You’re in.</h2>
      <p style={{ marginTop: 12, fontSize: 15, color: '#374151', lineHeight: 1.6 }}>
        Setting up your <strong>{info.facilityName}</strong> dashboard…
      </p>
      <div style={{ ...styles.spinner, marginTop: 24, marginLeft: 'auto', marginRight: 'auto' }} />
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #EEF2FF 0%, #FAFAFA 70%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  },
  shell: {
    background: '#fff',
    borderRadius: 18,
    boxShadow: '0 25px 50px -12px rgba(99,102,241,0.18)',
    border: '1px solid #E2E8F0',
    maxWidth: 460,
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    background: '#6366F1',
    padding: '20px 28px',
  },
  brand: {
    fontSize: 18,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },
  body: {
    padding: '32px 28px',
  },
  welcome: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: '#0F172A',
    letterSpacing: '-0.02em',
  },
  subline: {
    marginTop: 12,
    fontSize: 15,
    color: '#374151',
    lineHeight: 1.6,
  },
  subline2: {
    marginTop: 6,
    fontSize: 14,
    color: '#64748B',
    lineHeight: 1.6,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#374151',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  input: {
    display: 'block',
    width: '100%',
    padding: '11px 13px',
    border: '1.5px solid #E2E8F0',
    borderRadius: 9,
    fontSize: 15,
    color: '#0F172A',
    outline: 'none',
    boxSizing: 'border-box',
    marginTop: 6,
  },
  showPwd: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'transparent',
    border: 'none',
    color: '#6366F1',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  fieldError: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    color: '#B91C1C',
    fontSize: 13,
    padding: '10px 12px',
    borderRadius: 8,
    marginBottom: 16,
  },
  submit: {
    width: '100%',
    background: '#6366F1',
    color: '#fff',
    border: 'none',
    padding: '13px 20px',
    borderRadius: 11,
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: '0.01em',
    boxShadow: '0 2px 6px rgba(99,102,241,0.35)',
  },
  footer: {
    background: '#FAFAFA',
    padding: '14px 28px',
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    borderTop: '1px solid #F1F5F9',
  },
  spinner: {
    display: 'inline-block',
    width: 28,
    height: 28,
    border: '3px solid #E2E8F0',
    borderTopColor: '#6366F1',
    borderRadius: '50%',
    animation: 'fcSpin 0.9s linear infinite',
  },
}

// CSS keyframes — injected once if not present.
if (typeof document !== 'undefined' && !document.getElementById('facility-claim-style')) {
  const tag = document.createElement('style')
  tag.id = 'facility-claim-style'
  tag.textContent = '@keyframes fcSpin { to { transform: rotate(360deg); } }'
  document.head.appendChild(tag)
}
