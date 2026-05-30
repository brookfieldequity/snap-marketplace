import React, { useState } from 'react'
import { credentialAPI } from '../../api.js'

export default function CredentialLoginPage({ onLogin, onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
          <div style={{ fontSize: 48, fontWeight: 900, color: '#6366F1', letterSpacing: '-0.06em', lineHeight: 1 }}>SNAP</div>
          <div style={{ fontSize: 16, color: '#64748B', marginTop: 6, fontWeight: 500 }}>Credentialing Dashboard</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '36px 32px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#F1F5F9', margin: '0 0 28px', letterSpacing: '-0.02em' }}>
            Sign in to your facility
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Email</label>
              <input type="email" style={inp} value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="coordinator@facility.com" />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Password</label>
              <input type="password" style={inp} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? 'rgba(99,102,241,0.5)' : '#6366F1', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 14px rgba(99,102,241,0.4)' }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        </div>

        {onBack && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              ← Back to portal selection
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
