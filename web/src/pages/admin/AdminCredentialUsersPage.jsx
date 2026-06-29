import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const PERMISSIONS = ['COORDINATOR', 'DEPT_HEAD', 'BILLING']
const PERM_LABELS = { COORDINATOR: 'Credentialing Coordinator', DEPT_HEAD: 'Department Head', BILLING: 'Billing' }
const PERM_COLORS = {
  COORDINATOR: { bg: '#EFF6FF', text: '#1D4ED8' },
  DEPT_HEAD:   { bg: '#F0FDF4', text: '#15803D' },
  BILLING:     { bg: '#FFF7ED', text: '#C2410C' },
}

function inp(extra = {}) {
  return { width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#fff', boxSizing: 'border-box', outline: 'none', ...extra }
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminCredentialUsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', permission: 'COORDINATOR', facilityName: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createSuccess, setCreateSuccess] = useState('')
  const [actionLoading, setActionLoading] = useState({})
  const [search, setSearch] = useState('')

  function load() {
    setLoading(true)
    adminAPI.getCredentialUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.facilityName.trim()) {
      return setCreateError('All fields are required.')
    }
    setCreating(true)
    setCreateError('')
    setCreateSuccess('')
    try {
      await adminAPI.createCredentialUser(form)
      setCreateSuccess(`Account created and welcome email sent to ${form.email}`)
      setForm({ name: '', email: '', permission: 'COORDINATOR', facilityName: '' })
      load()
    } catch (err) {
      setCreateError(err.message || 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  async function handleResetPassword(user) {
    if (!confirm(`Send a new temporary password to ${user.email}?`)) return
    setActionLoading(p => ({ ...p, [user.id + '_reset']: true }))
    try {
      await adminAPI.resetCredentialUserPassword(user.id)
      alert(`Temporary password sent to ${user.email}`)
    } catch {
      alert('Failed to send reset email')
    } finally {
      setActionLoading(p => ({ ...p, [user.id + '_reset']: false }))
    }
  }

  async function handleToggleActive(user) {
    const action = user.isActive ? 'deactivate' : 'reactivate'
    if (!confirm(`Are you sure you want to ${action} ${user.name}?`)) return
    setActionLoading(p => ({ ...p, [user.id + '_active']: true }))
    try {
      await adminAPI.updateCredentialUser(user.id, { isActive: !user.isActive })
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u))
    } catch {
      alert(`Failed to ${action} user`)
    } finally {
      setActionLoading(p => ({ ...p, [user.id + '_active']: false }))
    }
  }

  async function handleChangePermission(user, permission) {
    setActionLoading(p => ({ ...p, [user.id + '_perm']: true }))
    try {
      await adminAPI.updateCredentialUser(user.id, { permission })
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, permission } : u))
    } catch {
      alert('Failed to update permission')
    } finally {
      setActionLoading(p => ({ ...p, [user.id + '_perm']: false }))
    }
  }

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.facilityName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Credential Users</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{users.length} facility portal accounts</p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(''); setCreateSuccess('') }}
          style={{ padding: '10px 20px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          + Create Facility User
        </button>
      </div>

      {/* Create user panel */}
      {showCreate && (
        <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 14, padding: '28px 32px', marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '0 0 20px' }}>Create Facility User</h2>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Full Name</label>
                <input style={inp()} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Diane Callahan" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Email Address</label>
                <input style={inp()} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="diane@facility.com" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Facility Name</label>
                <input style={inp()} value={form.facilityName} onChange={e => set('facilityName', e.target.value)} placeholder="Surgical Center name" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Permission Level</label>
                <select style={inp()} value={form.permission} onChange={e => set('permission', e.target.value)}>
                  {PERMISSIONS.map(p => <option key={p} value={p}>{PERM_LABELS[p]}</option>)}
                </select>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                  Coordinator: full access · Dept Head: view only · Billing: name + NPI only
                </div>
              </div>
            </div>

            {createError && <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{createError}</div>}
            {createSuccess && <div style={{ padding: '10px 14px', background: '#F0FDF4', borderRadius: 8, color: '#15803D', fontSize: 13, marginBottom: 14 }}>✓ {createSuccess}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '10px 20px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC', color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={creating} style={{ padding: '10px 24px', background: creating ? '#A5B4FC' : '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creating & Sending Email…' : 'Create User & Send Welcome Email'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 20 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔍</span>
        <input
          type="text"
          placeholder="Search users or facilities..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 14px 10px 36px', background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1.2fr 1.2fr 1fr 160px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Name', 'Email', 'Facility', 'Permission', 'Last Login', 'Status', 'Actions'].map(h => (
            <div key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
          ))}
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Loading…</div>}
        {!loading && filtered.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>No users found.</div>}

        {filtered.map((u, i) => {
          const pc = PERM_COLORS[u.permission] || PERM_COLORS.BILLING
          return (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1.2fr 1.2fr 1fr 160px', borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', alignItems: 'center', background: u.isActive ? (i % 2 === 0 ? '#fff' : '#FAFAFA') : '#FFF5F5' }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{u.name}</div>
                {u.forcePasswordChange && <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600, marginTop: 2 }}>Pending first login</div>}
              </div>
              <div style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{u.email}</div>
              <div style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{u.facilityName}</div>
              <div style={{ padding: '14px 16px' }}>
                <select
                  value={u.permission}
                  disabled={!!actionLoading[u.id + '_perm']}
                  onChange={e => handleChangePermission(u, e.target.value)}
                  style={{ background: pc.bg, color: pc.text, border: `1px solid ${pc.text}30`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  {PERMISSIONS.map(p => <option key={p} value={p}>{PERM_LABELS[p]}</option>)}
                </select>
              </div>
              <div style={{ padding: '14px 16px', fontSize: 13, color: '#94A3B8' }}>{formatDate(u.lastLoginAt)}</div>
              <div style={{ padding: '14px 16px' }}>
                <span style={{ background: u.isActive ? '#F0FDF4' : '#FEF2F2', color: u.isActive ? '#15803D' : '#DC2626', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleResetPassword(u)}
                  disabled={actionLoading[u.id + '_reset']}
                  style={{ padding: '5px 10px', background: '#EFF6FF', border: 'none', borderRadius: 6, color: '#1D4ED8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {actionLoading[u.id + '_reset'] ? '…' : 'Reset PW'}
                </button>
                <button
                  onClick={() => handleToggleActive(u)}
                  disabled={actionLoading[u.id + '_active']}
                  style={{ padding: '5px 10px', background: u.isActive ? '#FEF2F2' : '#F0FDF4', border: 'none', borderRadius: 6, color: u.isActive ? '#DC2626' : '#15803D', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {actionLoading[u.id + '_active'] ? '…' : u.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
