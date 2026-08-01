import React, { useState } from 'react'
import { adminAPI, authAPI } from '../api.js'

// Admin panel sign-in is intentionally LOGIN-ONLY: no self-service password
// reset. The admin account is the highest-privilege entry point, so password
// recovery is handled out-of-band (direct/owner-controlled), not via an
// emailable code. The backend also refuses to reset ADMIN accounts.
export default function AdminLoginPage({ onLogin, onBack }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  // Forced change after an owner-issued temporary password.
  const [pendingToken, setPendingToken] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await adminAPI.login(email, password)
      if (data.mustChangePassword) {
        setPendingToken(data.token)
        setPassword('')
        return
      }
      onLogin(data.token)
    } catch (err) {
      setError(err.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForcedChange(e) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) return setError('Password must be at least 8 characters.')
    if (newPassword !== confirmPassword) return setError('Passwords do not match.')
    setLoading(true)
    try {
      await authAPI.changePassword(pendingToken, newPassword)
      setPendingToken(null)
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Password updated. Sign in with your new password.')
    } catch (err) {
      setError(err.message || 'Could not set the new password.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    background: '#F8FAFC',
    border: '1.5px solid #E2E8F0',
    borderRadius: 10,
    fontSize: 15,
    color: '#10233F',
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
          maxWidth: 400,
          background: '#fff',
          borderRadius: 20,
          padding: '40px 36px',
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        }}
      >
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer', marginBottom: 24, padding: 0 }}
        >
          ← Back
        </button>

        <div style={{ marginBottom: 32 }}>
          <div className="snap-wordmark" style={{ fontSize: 26, color: '#2563EB' }}>SNAP</div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 6,
              marginBottom: 8,
              background: 'rgba(37,99,235,0.08)',
              border: '1px solid rgba(37,99,235,0.2)',
              borderRadius: 6,
              padding: '2px 8px',
            }}
          >
            <span style={{ fontSize: 10 }}>🔐</span>
            <span style={{ fontSize: 11, color: '#2563EB', fontWeight: 700, letterSpacing: '0.06em' }}>ADMIN PANEL</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#10233F', marginTop: 4 }}>Admin Sign In</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Restricted access — SNAP staff only</p>
        </div>

        {notice && !pendingToken && (
          <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#16A34A', marginBottom: 16 }}>
            {notice}
          </div>
        )}

        {pendingToken ? (
          <form onSubmit={handleForcedChange}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                Your temporary password worked — now choose your own.
              </p>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} style={inputStyle} />
              </div>
              {error && <div style={{ color: '#DC2626', fontSize: 13 }}>{error}</div>}
              <button type="submit" disabled={loading} style={{ width: '100%', padding: 13, background: 'linear-gradient(135deg, #2563EB, #3B82F6)', boxShadow: '0 2px 10px rgba(37,99,235,0.3)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Saving…' : 'Set Password & Continue'}
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Admin Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@snapmedical.app"
                required
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
                onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
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
              {loading ? 'Signing in...' : 'Sign In to Admin Panel'}
            </button>
          </div>
        </form>

        )}      </div>
    </div>
  )
}
