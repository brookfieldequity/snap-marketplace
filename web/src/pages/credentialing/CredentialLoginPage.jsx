import React, { useState } from 'react'
import { credentialAPI } from '../../api.js'

export default function CredentialLoginPage({ onLogin, onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('login') // 'login' | 'forgot' | 'forgot-sent'
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await credentialAPI.login(email, password)
      localStorage.setItem('snapCredToken', data.token)
      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setForgotLoading(true)
    try {
      await credentialAPI.forgotPassword(forgotEmail)
      setView('forgot-sent')
    } catch {
      setView('forgot-sent') // always show confirmation to avoid enumeration
    } finally {
      setForgotLoading(false)
    }
  }

  const inp = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: '#F1F5F9',
    fontSize: 15,
    boxSizing: 'border-box',
    outline: 'none',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.06em', lineHeight: 1 }}>SNAP</div>
          <div style={{ fontSize: 16, color: '#64748B', marginTop: 6, fontWeight: 500 }}>Credentialing Dashboard</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '36px 32px' }}>

          {/* ── Login form ── */}
          {view === 'login' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#F1F5F9', margin: '0 0 28px', letterSpacing: '-0.02em' }}>
                Sign in to your facility
              </h2>
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Email</label>
                  <input type="email" style={inp} value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="coordinator@facility.com" />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Password</label>
                  <input type="password" style={inp} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
                </div>

                <div style={{ textAlign: 'right', marginBottom: 20 }}>
                  <button type="button" onClick={() => { setForgotEmail(email); setView('forgot') }} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                    Forgot password?
                  </button>
                </div>

                {error && (
                  <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: '100%', padding: '13px', background: loading ? 'rgba(37,99,235,0.5)' : '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 14px rgba(37,99,235,0.4)' }}
                >
                  {loading ? 'Signing in…' : 'Sign In →'}
                </button>
              </form>
            </>
          )}

          {/* ── Forgot password form ── */}
          {view === 'forgot' && (
            <>
              <button onClick={() => setView('login')} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back to login</button>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#F1F5F9', margin: '0 0 8px' }}>Reset your password</h2>
              <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px' }}>Enter your email and we'll send a reset link.</p>
              <form onSubmit={handleForgot}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Email</label>
                  <input type="email" style={inp} value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required autoFocus placeholder="coordinator@facility.com" />
                </div>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  style={{ width: '100%', padding: '13px', background: forgotLoading ? 'rgba(37,99,235,0.5)' : '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: forgotLoading ? 'not-allowed' : 'pointer' }}
                >
                  {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}

          {/* ── Forgot sent confirmation ── */}
          {view === 'forgot-sent' && (
            <>
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📧</div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#F1F5F9', margin: '0 0 12px' }}>Check your email</h2>
                <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px', lineHeight: 1.6 }}>
                  If an account exists for that email, a reset link has been sent. Check your inbox.
                </p>
                <button onClick={() => setView('login')} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#94A3B8', fontSize: 14, cursor: 'pointer', padding: '10px 24px', fontWeight: 500 }}>
                  Back to Login
                </button>
              </div>
            </>
          )}
        </div>

        {/* Contact note */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <p style={{ color: '#334155', fontSize: 13, margin: '0 0 8px' }}>
            To request facility access, contact SNAP Medical at{' '}
            <a href="mailto:admin@snapmedical.com" style={{ color: '#2563EB', textDecoration: 'none' }}>admin@snapmedical.com</a>
          </p>
        </div>

        {onBack && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              ← Back to portal selection
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
