import React, { useState } from 'react'
import { facilityAPI } from '../api.js'

export default function FacilityLoginPage({ onLogin, onRegister, onBack }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

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
          <div style={{ fontSize: 28, fontWeight: 900, color: '#6366F1', letterSpacing: '-0.04em' }}>
            SNAP
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginTop: 8 }}>
            Facility Sign In
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            Access your staffing portal
          </p>
        </div>

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
                onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
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
                onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
                onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
              />
            </div>

            {error && (
              <div
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: '#DC2626',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px',
                background: loading ? '#A5B4FC' : '#6366F1',
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
            style={{
              background: 'none',
              border: 'none',
              color: '#6366F1',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
            }}
          >
            Register your facility
          </button>
        </div>
      </div>
    </div>
  )
}
