import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

const TYPE_BADGE = {
  CRNA: { bg: '#EFF6FF', color: '#1D4ED8', label: 'CRNA' },
  ANESTHESIOLOGIST: { bg: '#F5F3FF', color: '#7C3AED', label: 'Anesthesiologist' },
  ANESTHESIA_ASSISTANT: { bg: '#F0FDFA', color: '#0F766E', label: 'Anesthesia Asst.' },
}

const EMPLOY_BADGE = {
  FULL_TIME: { bg: '#F0FDF4', color: '#15803D', label: 'Full Time' },
  PER_DIEM: { bg: '#FEFCE8', color: '#A16207', label: 'Per Diem' },
  LOCUMS: { bg: '#FFF7ED', color: '#C2410C', label: 'Locums' },
}

const BLANK_FORM = {
  providerName: '',
  providerType: 'CRNA',
  employmentCategory: 'FULL_TIME',
  snapEmail: '',
  phoneNumber: '',
  licenseNumber: '',
  licenseExpiration: '',
  notes: '',
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false
  const diff = new Date(dateStr) - new Date()
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000
}

function Badge({ bg, color, label }) {
  return (
    <span style={{ background: bg, color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${color}33` }}>
      {label}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 14,
  color: '#0F172A',
  background: '#F8FAFC',
  boxSizing: 'border-box',
  outline: 'none',
}

export default function InternalRosterPage({ onNavigate }) {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null) // null = add, else provider object
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [invitedIds, setInvitedIds] = useState({})
  const [deletingIds, setDeletingIds] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await facilityAPI.getRoster()
      setRoster(Array.isArray(data) ? data : data.roster || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openAdd() {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setShowModal(true)
  }

  function openEdit(p) {
    setEditTarget(p)
    setForm({
      providerName: p.providerName || '',
      providerType: p.providerType || 'CRNA',
      employmentCategory: p.employmentCategory || 'FULL_TIME',
      snapEmail: p.snapEmail || '',
      phoneNumber: p.phoneNumber || '',
      licenseNumber: p.licenseNumber || '',
      licenseExpiration: p.licenseExpiration ? p.licenseExpiration.substring(0, 10) : '',
      notes: p.notes || '',
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.providerName.trim()) return alert('Provider name is required.')
    setSaving(true)
    try {
      if (editTarget) {
        await facilityAPI.updateRosterEntry(editTarget.id, form)
      } else {
        await facilityAPI.createRosterEntry(form)
      }
      setShowModal(false)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this provider from the roster?')) return
    setDeletingIds((p) => ({ ...p, [id]: true }))
    try {
      await facilityAPI.deleteRosterEntry(id)
      await load()
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeletingIds((p) => ({ ...p, [id]: false }))
    }
  }

  async function handleInvite(id) {
    try {
      await facilityAPI.inviteRosterProvider(id)
      setInvitedIds((p) => ({ ...p, [id]: true }))
    } catch (e) {
      alert('Invite failed: ' + e.message)
    }
  }

  function setF(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Internal Provider Roster</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{roster.length} provider{roster.length !== 1 ? 's' : ''} on your roster</p>
        </div>
        <button
          onClick={openAdd}
          style={{ padding: '11px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Provider
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 15 }}>Loading roster...</div>
      )}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 24 }}>
          Failed to load roster: {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && roster.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>No providers on your roster yet.</div>
          <div style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>Add your first provider to start building your schedule.</div>
          <button onClick={openAdd} style={{ padding: '11px 24px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            + Add Your First Provider
          </button>
        </div>
      )}

      {/* Grid */}
      {!loading && roster.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {roster.map((p) => {
            const typeBadge = TYPE_BADGE[p.providerType] || TYPE_BADGE.CRNA
            const empBadge = EMPLOY_BADGE[p.employmentCategory] || EMPLOY_BADGE.FULL_TIME
            const linked = !!p.snapAccountLinked
            const expiringSoon = isExpiringSoon(p.licenseExpiration)

            return (
              <div key={p.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '20px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Name + badges */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginBottom: 8 }}>{p.providerName}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge bg={typeBadge.bg} color={typeBadge.color} label={typeBadge.label} />
                    <Badge bg={empBadge.bg} color={empBadge.color} label={empBadge.label} />
                  </div>
                </div>

                {/* Linked status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: linked ? '#10B981' : '#CBD5E1', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: linked ? '#059669' : '#94A3B8', fontWeight: 500 }}>
                    {linked ? 'SNAP Account Linked' : 'No SNAP Account'}
                  </span>
                </div>

                {/* License expiration */}
                {p.licenseExpiration && (
                  <div style={{ fontSize: 12, color: expiringSoon ? '#DC2626' : '#64748B', fontWeight: expiringSoon ? 700 : 400 }}>
                    {expiringSoon ? '⚠️ ' : ''}License expires: {p.licenseExpiration.substring(0, 10)}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => openEdit(p)}
                    style={{ padding: '6px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    ✏️ Edit
                  </button>
                  {!linked && (
                    <button
                      onClick={() => handleInvite(p.id)}
                      disabled={invitedIds[p.id]}
                      style={{ padding: '6px 14px', background: invitedIds[p.id] ? '#F0FDF4' : '#EEF2FF', border: `1px solid ${invitedIds[p.id] ? '#86EFAC' : '#A5B4FC'}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: invitedIds[p.id] ? 'default' : 'pointer', color: invitedIds[p.id] ? '#15803D' : '#4F46E5' }}
                    >
                      {invitedIds[p.id] ? '✓ Invite Sent' : '✉️ Invite'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deletingIds[p.id]}
                    style={{ padding: '6px 14px', background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#DC2626', marginLeft: 'auto' }}
                  >
                    {deletingIds[p.id] ? '...' : '🗑️'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <Modal title={editTarget ? 'Edit Provider' : 'Add Provider'} onClose={() => setShowModal(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Provider Name">
                <input style={inputStyle} value={form.providerName} onChange={(e) => setF('providerName', e.target.value)} placeholder="Dr. Jane Smith" />
              </Field>
            </div>
            <Field label="Provider Type">
              <select style={inputStyle} value={form.providerType} onChange={(e) => setF('providerType', e.target.value)}>
                <option value="CRNA">CRNA</option>
                <option value="ANESTHESIOLOGIST">Anesthesiologist</option>
                <option value="ANESTHESIA_ASSISTANT">Anesthesia Assistant</option>
              </select>
            </Field>
            <Field label="Employment Category">
              <select style={inputStyle} value={form.employmentCategory} onChange={(e) => setF('employmentCategory', e.target.value)}>
                <option value="FULL_TIME">Full Time</option>
                <option value="PER_DIEM">Per Diem</option>
                <option value="LOCUMS">Locums</option>
              </select>
            </Field>
            <Field label="SNAP Account Email">
              <input style={inputStyle} type="email" value={form.snapEmail} onChange={(e) => setF('snapEmail', e.target.value)} placeholder="provider@example.com" />
            </Field>
            <Field label="Phone Number">
              <input style={inputStyle} type="tel" value={form.phoneNumber} onChange={(e) => setF('phoneNumber', e.target.value)} placeholder="(555) 000-0000" />
            </Field>
            <Field label="License Number">
              <input style={inputStyle} value={form.licenseNumber} onChange={(e) => setF('licenseNumber', e.target.value)} placeholder="LIC-12345" />
            </Field>
            <Field label="License Expiration">
              <input style={inputStyle} type="date" value={form.licenseExpiration} onChange={(e) => setF('licenseExpiration', e.target.value)} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="Any relevant notes..." />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
