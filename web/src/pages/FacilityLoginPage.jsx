import React, { useState } from 'react'
import { facilityAPI, authAPI } from '../api.js'

export default function FacilityLoginPage({ onLogin, onRegister, onBack }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // 'login' | 'forgot' | 'reset'
  const [view, setView]               = useState('login')
  const [notice, setNotice]           = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [code, setCode]               = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await facilityAPI.login(email, password)
      onLogin(data.token, data.facility?.facilityName || data.facilityName || '')
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authAPI.forgotPassword(forgotEmail)
    } catch {
      // Swallow errors to avoid account enumeration — always advance.
    } finally {
      setLoading(false)
      setNotice("If an account exists, we've sent a 6-digit code to that email.")
      setView('reset')
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await authAPI.resetPassword(forgotEmail, code.trim(), newPassword)
      setEmail(forgotEmail)
      setPassword('')
      setCode('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('')
      setView('login')
      setError('')
      setResetSuccess('Password reset successfully. Please sign in.')
    } catch (err) {
      setError(err.message || 'Could not reset password. Check your code and try again.')
    } finally {
      setLoading(false)
    }
  }

  function goToLogin() {
    setView('login')
    setError('')
    setNotice('')
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    background: '#F8FAFC',
    border: '1.5px solid #E2E8F0',
    borderRadius: 10,
    fontSize: 15,
    color: '#0F172A',
    outline: 'none',
    transition: 'border-color 0.15s',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          borderRadius: 20,
          padding: '40px 36px',
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        }}
      >
        {/* Header */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            fontSize: 13,
            cursor: 'pointer',
            marginBottom: 24,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ← Back
        </button>

        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em' }}>
            SNAP
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginTop: 8 }}>
            {view === 'login' ? 'Facility Sign In' : 'Reset Password'}
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            {view === 'login'
              ? 'Access your staffing portal'
              : view === 'forgot'
                ? "Enter your email and we'll send a 6-digit code."
                : 'Enter the code we sent and choose a new password.'}
          </p>
        </div>

        {/* ── Login ── */}
        {view === 'login' && (
          <>
            {resetSuccess && (
              <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#16A34A', marginBottom: 16 }}>
                {resetSuccess}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@facility.com"
                    required
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                    onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                  />
                </div>

                <div style={{ textAlign: 'right', marginTop: -4 }}>
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setError(''); setResetSuccess(''); setView('forgot') }}
                    style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, cursor: 'pointer', fontWeight: 500, padding: 0 }}
                  >
                    Forgot password?
                  </button>
                </div>

                {error && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '13px',
                    background: loading ? '#A5B4FC' : '#2563EB',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                    marginTop: 4,
                  }}
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </div>
            </form>

            <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: '#64748B' }}>
              Don't have an account?{' '}
              <button
                onClick={onRegister}
                style={{ background: 'none', border: 'none', color: '#2563EB', fontWeight: 600, cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                Register your facility
              </button>
            </div>
          </>
        )}

        {/* ── Forgot (request code) ── */}
        {view === 'forgot' && (
          <form onSubmit={handleForgot}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@facility.com"
                  required
                  autoFocus
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '13px',
                  background: loading ? '#A5B4FC' : '#2563EB',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: 4,
                }}
              >
                {loading ? 'Sending…' : 'Send Code'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button type="button" onClick={goToLogin} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 13, cursor: 'pointer', padding: 0 }}>
                  ← Back to login
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── Reset (enter code + new password) ── */}
        {view === 'reset' && (
          <form onSubmit={handleReset}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {notice && (
                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1D4ED8' }}>
                  {notice}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  6-Digit Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  autoFocus
                  style={{ ...inputStyle, letterSpacing: '0.3em', fontWeight: 600 }}
                  onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                  onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '13px',
                  background: loading ? '#A5B4FC' : '#2563EB',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: 4,
                }}
              >
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button type="button" onClick={goToLogin} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 13, cursor: 'pointer', padding: 0 }}>
                  ← Back to login
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
