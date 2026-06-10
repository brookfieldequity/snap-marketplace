import React, { useEffect, useState, useRef } from 'react'
import { credentialAPI } from '../../api.js'

const ALL_PERMISSIONS = ['COORDINATOR', 'DEPT_HEAD', 'BILLING']
const COORDINATOR_ALLOWED = ['DEPT_HEAD', 'BILLING']
const PERM_LABELS = { COORDINATOR: 'Coordinator', DEPT_HEAD: 'Dept Head', BILLING: 'Billing' }

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function inp(extra = {}) {
  return {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    fontSize: 14,
    color: '#0F172A',
    background: '#fff',
    boxSizing: 'border-box',
    ...extra,
  }
}

// ─── User Management ─────────────────────────────────────────────────────────

function UserForm({ initial, onSave, onCancel }) {
  const allowedPermissions = initial ? ALL_PERMISSIONS : COORDINATOR_ALLOWED
  const [form, setForm] = useState(initial || { name: '', email: '', permission: 'BILLING' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required.')
    setSaving(true)
    try {
      await onSave({ name: form.name, email: form.email, permission: form.permission })
    } catch (ex) {
      setErr(ex.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Name</label>
        <input style={inp()} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Full name" required />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Email</label>
        <input style={inp()} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@facility.com" required />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Permission Level</label>
        <select style={inp()} value={form.permission} onChange={e => set('permission', e.target.value)}>
          {allowedPermissions.map(p => <option key={p} value={p}>{PERM_LABELS[p]}</option>)}
        </select>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
          Dept Head: view status · Billing: name + NPI only
        </div>
      </div>
      {!initial && (
        <div style={{ padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 13, color: '#1D4ED8', marginBottom: 16 }}>
          A welcome email with a temporary password will be sent to the user automatically.
        </div>
      )}
      {err && <div style={{ padding: '8px 12px', background: '#FEE2E2', borderRadius: 6, color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onCancel} style={{ flex: 1, padding: '10px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 8, background: saving ? '#A5B4FC' : '#2563EB', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : (initial ? 'Update User' : 'Create & Send Welcome Email')}
        </button>
      </div>
    </form>
  )
}

function UsersTab() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | {editing user}

  function load() {
    setLoading(true)
    credentialAPI.getUsers()
      .then(d => setUsers(Array.isArray(d) ? d : []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function handleSave(form) {
    if (modal === 'add') {
      await credentialAPI.createUser(form)
    } else {
      await credentialAPI.updateUser(modal.id, form)
    }
    setModal(null)
    load()
  }

  async function handleDelete(user) {
    if (!window.confirm(`Remove ${user.name}? This cannot be undone.`)) return
    await credentialAPI.deleteUser(user.id)
    load()
  }

  const permColor = { COORDINATOR: '#2563EB', DEPT_HEAD: '#F59E0B', BILLING: '#94A3B8' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Facility Users</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Manage who can access the credentialing dashboard</p>
        </div>
        <button
          onClick={() => setModal('add')}
          style={{ padding: '10px 18px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + Add User
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>Loading users…</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC' }}>
              <tr>
                {['Name', 'Email', 'Permission', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>No users yet.</td></tr>
              ) : users.map((u, i) => (
                <tr key={u.id} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{u.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: permColor[u.permission] || '#64748B', background: `${permColor[u.permission] || '#94A3B8'}15`, padding: '3px 8px', borderRadius: 6 }}>
                      {PERM_LABELS[u.permission] || u.permission}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {u.forcePasswordChange
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '3px 8px', borderRadius: 6 }}>Pending login</span>
                      : <span style={{ fontSize: 11, fontWeight: 700, color: '#15803D', background: '#F0FDF4', padding: '3px 8px', borderRadius: 6 }}>Active</span>
                    }
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setModal(u)} style={{ padding: '5px 12px', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Edit</button>
                      <button onClick={() => handleDelete(u)} style={{ padding: '5px 12px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#FFF5F5', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#EF4444' }}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add User" onClose={() => setModal(null)}>
          <UserForm onSave={handleSave} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal && modal !== 'add' && (
        <Modal title="Edit User" onClose={() => setModal(null)}>
          <UserForm initial={modal} onSave={handleSave} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  )
}

// ─── Roster Management ───────────────────────────────────────────────────────

function AddProviderForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', npiNumber: '', credentialType: 'Anesthesiologist', email: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.firstName.trim() || !form.lastName.trim() || !form.npiNumber.trim()) {
      return setErr('First name, last name, and NPI are required.')
    }
    setSaving(true)
    try {
      await onSave(form)
    } catch (ex) {
      setErr(ex.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>First Name *</label>
          <input style={inp()} value={form.firstName} onChange={e => set('firstName', e.target.value)} required />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Last Name *</label>
          <input style={inp()} value={form.lastName} onChange={e => set('lastName', e.target.value)} required />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>NPI Number *</label>
        <input style={inp()} value={form.npiNumber} onChange={e => set('npiNumber', e.target.value)} placeholder="10-digit NPI" required />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Provider Type</label>
        <select style={inp()} value={form.credentialType} onChange={e => set('credentialType', e.target.value)}>
          <option value="Anesthesiologist">Anesthesiologist</option>
          <option value="CRNA">CRNA</option>
        </select>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Email (optional — for invitation)</label>
        <input style={inp()} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="provider@example.com" />
      </div>
      {err && <div style={{ padding: '8px 12px', background: '#FEE2E2', borderRadius: 6, color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onCancel} style={{ flex: 1, padding: '10px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#F8FAFC', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 8, background: saving ? '#A5B4FC' : '#2563EB', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Adding…' : 'Add Provider'}
        </button>
      </div>
    </form>
  )
}

function RosterTab() {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [csvStatus, setCsvStatus] = useState('')
  const [inviting, setInviting] = useState(null)
  const fileRef = useRef()

  function load() {
    setLoading(true)
    credentialAPI.getRoster()
      .then(d => setRoster(Array.isArray(d) ? d : []))
      .catch(() => setRoster([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function handleAdd(form) {
    await credentialAPI.addRosterEntry(form)
    setModal(null)
    load()
  }

  async function handleRemove(id) {
    if (!window.confirm('Remove this provider from the roster?')) return
    await credentialAPI.removeRosterEntry(id)
    load()
  }

  async function handleInvite(entry) {
    if (!entry.email) {
      return window.alert('No email address on file for this provider. Edit the roster entry to add one.')
    }
    setInviting(entry.id)
    try {
      await credentialAPI.inviteRosterEntry(entry.id)
      load()
    } catch (ex) {
      window.alert(ex.message || 'Invite failed')
    } finally {
      setInviting(null)
    }
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvStatus('Uploading…')
    try {
      const text = await file.text()
      const result = await credentialAPI.bulkUploadRoster(text)
      setCsvStatus(`✓ ${result.created} added, ${result.skipped} skipped (duplicates)`)
      load()
    } catch (ex) {
      setCsvStatus(`Error: ${ex.message || 'Upload failed'}`)
    } finally {
      fileRef.current.value = ''
    }
  }

  const matchColor = { LINKED: '#10B981', INVITED: '#F59E0B', NOT_INVITED: '#94A3B8' }
  const matchLabel = { LINKED: 'Linked', INVITED: 'Invited', NOT_INVITED: 'Not Invited' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Provider Roster</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Providers in your facility's credentialing roster</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a
            href={credentialAPI.getRosterTemplate()}
            style={{ padding: '10px 16px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10, color: '#374151', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
          >
            CSV Template ↓
          </a>
          <label style={{ padding: '10px 16px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10, color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Upload CSV
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvUpload} />
          </label>
          <button
            onClick={() => setModal('add')}
            style={{ padding: '10px 18px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + Add Provider
          </button>
        </div>
      </div>

      {csvStatus && (
        <div style={{ padding: '10px 14px', background: csvStatus.startsWith('✓') ? '#ECFDF5' : '#FEF2F2', border: `1px solid ${csvStatus.startsWith('✓') ? '#A7F3D0' : '#FECACA'}`, borderRadius: 8, fontSize: 13, color: csvStatus.startsWith('✓') ? '#065F46' : '#DC2626', marginBottom: 16 }}>
          {csvStatus}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>Loading roster…</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F8FAFC' }}>
              <tr>
                {['Provider', 'NPI', 'Type', 'Email', 'Passport Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>No providers on roster yet.</td></tr>
              ) : roster.map((r, i) => (
                <tr key={r.id} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{r.lastName}, {r.firstName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748B', fontFamily: 'monospace' }}>{r.npiNumber}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{r.credentialType}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748B' }}>{r.email || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: matchColor[r.matchStatus] || '#94A3B8', background: `${matchColor[r.matchStatus] || '#94A3B8'}15`, padding: '3px 8px', borderRadius: 6 }}>
                      {matchLabel[r.matchStatus] || r.matchStatus}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {r.matchStatus === 'NOT_INVITED' && (
                        <button
                          onClick={() => handleInvite(r)}
                          disabled={inviting === r.id}
                          style={{ padding: '5px 12px', border: '1px solid #C7D2FE', borderRadius: 6, background: '#EFF6FF', fontSize: 12, fontWeight: 600, cursor: inviting === r.id ? 'not-allowed' : 'pointer', color: '#2563EB' }}
                        >
                          {inviting === r.id ? 'Sending…' : 'Invite'}
                        </button>
                      )}
                      <button onClick={() => handleRemove(r.id)} style={{ padding: '5px 12px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#FFF5F5', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#EF4444' }}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add Provider to Roster" onClose={() => setModal(null)}>
          <AddProviderForm onSave={handleAdd} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CredentialSettings() {
  const [tab, setTab] = useState('users')

  const tabStyle = active => ({
    padding: '10px 20px',
    border: 'none',
    borderBottom: `3px solid ${active ? '#2563EB' : 'transparent'}`,
    background: 'none',
    color: active ? '#2563EB' : '#64748B',
    fontSize: 14,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  })

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Manage facility users and provider roster</p>
      </div>

      <div style={{ borderBottom: '1px solid #E2E8F0', marginBottom: 28, display: 'flex', gap: 4 }}>
        <button style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>Users & Permissions</button>
        <button style={tabStyle(tab === 'roster')} onClick={() => setTab('roster')}>Provider Roster</button>
      </div>

      {tab === 'users' ? <UsersTab /> : <RosterTab />}
    </div>
  )
}
