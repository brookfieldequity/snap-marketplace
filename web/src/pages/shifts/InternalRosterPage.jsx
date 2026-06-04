import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'
import NpiReviewModal from './NpiReviewModal.jsx'
import TimeOffModal from './TimeOffModal.jsx'

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

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const SHIFT_LENGTHS = [
  { value: '8hr', label: '8 hours' },
  { value: '10hr', label: '10 hours' },
  { value: '12hr', label: '12 hours' },
  { value: 'none', label: 'No preference' },
]

const BLANK_FORM = {
  providerName: '', providerType: 'CRNA', employmentCategory: 'FULL_TIME',
  snapEmail: '', phoneNumber: '', licenseNumber: '', licenseExpiration: '',
  // Category fields
  fteHours: '', annualRate: '', hourlyRate: '',
  preferredShiftLength: 'none', preferredDays: [],
  locationRankings: [], maxShiftsPerMonth: '',
  contractStart: '', contractEnd: '', notes: '',
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
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function SectionDivider({ label }) {
  return (
    <div style={{ borderTop: '1px solid #E2E8F0', margin: '20px 0 14px', paddingTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC',
  boxSizing: 'border-box', outline: 'none',
}

export default function InternalRosterPage({ onNavigate }) {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [invitedIds, setInvitedIds] = useState({})
  const [deletingIds, setDeletingIds] = useState({})
  // Bulk upload state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null) // { summary, created, errors }
  const [uploadError, setUploadError] = useState(null)
  const [locationInput, setLocationInput] = useState('')

  // NPI review queue (from multi-sheet imports)
  const [npiReviewRows, setNpiReviewRows] = useState([])
  const [showNpiReview, setShowNpiReview] = useState(false)
  const [timeOffMember, setTimeOffMember] = useState(null) // roster member whose PTO modal is open

  useEffect(() => { load(); loadNpiReview() }, [])

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

  async function loadNpiReview() {
    try {
      const data = await facilityAPI.getNpiReview()
      setNpiReviewRows(data.rows || [])
    } catch {
      // Non-blocking — the review queue is a nice-to-have surface; never
      // block the roster page if it fails to load.
    }
  }

  function openAdd() {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setLocationInput('')
    setShowModal(true)
  }

  // ─── Bulk upload ──────────────────────────────────────────────────────────
  function openUpload() {
    setUploadFile(null)
    setUploadResult(null)
    setUploadError(null)
    setShowUploadModal(true)
  }

  async function handleUpload() {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const res = await facilityAPI.uploadRoster(uploadFile)
      setUploadResult(res)
      // Reload roster so the imported providers appear immediately
      await load()
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function downloadTemplate() {
    const token = localStorage.getItem('snapFacilityToken')
    try {
      const res = await fetch(facilityAPI.downloadRosterTemplateUrl(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Failed to download template.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'snap-roster-template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Could not download template: ' + err.message)
    }
  }

  function openEdit(p) {
    setEditTarget(p)
    setForm({
      providerName: p.providerName || '',
      providerType: p.providerType || 'CRNA',
      employmentCategory: p.employmentCategory || 'FULL_TIME',
      snapEmail: p.snapAccountEmail || '',
      phoneNumber: p.phoneNumber || '',
      licenseNumber: p.licenseNumber || '',
      licenseExpiration: p.licenseExpiration ? p.licenseExpiration.substring(0, 10) : '',
      fteHours: p.fteHours ?? '',
      annualRate: p.annualRate ?? '',
      hourlyRate: p.hourlyRate ?? '',
      preferredShiftLength: p.preferredShiftLength || 'none',
      preferredDays: Array.isArray(p.preferredDays) ? p.preferredDays : [],
      locationRankings: Array.isArray(p.locationRankings) ? p.locationRankings : [],
      maxShiftsPerMonth: p.maxShiftsPerMonth ?? '',
      contractStart: p.contractStart ? p.contractStart.substring(0, 10) : '',
      contractEnd: p.contractEnd ? p.contractEnd.substring(0, 10) : '',
      notes: p.notes || '',
    })
    setLocationInput('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.providerName.trim()) return alert('Provider name is required.')
    if (form.employmentCategory === 'FULL_TIME' && !form.annualRate) return alert('Annual base rate is required for Full Time providers.')
    if ((form.employmentCategory === 'PER_DIEM' || form.employmentCategory === 'LOCUMS') && !form.hourlyRate) return alert('Base hourly rate is required.')
    setSaving(true)
    try {
      const payload = {
        providerName: form.providerName,
        providerType: form.providerType,
        employmentCategory: form.employmentCategory,
        snapAccountEmail: form.snapEmail || null,
        phoneNumber: form.phoneNumber || null,
        licenseNumber: form.licenseNumber || null,
        licenseExpiration: form.licenseExpiration || null,
        fteHours: form.fteHours !== '' ? parseFloat(form.fteHours) : null,
        annualRate: form.annualRate !== '' ? parseFloat(form.annualRate) : null,
        hourlyRate: form.hourlyRate !== '' ? parseFloat(form.hourlyRate) : null,
        preferredShiftLength: form.preferredShiftLength !== 'none' ? form.preferredShiftLength : null,
        preferredDays: form.preferredDays.length > 0 ? form.preferredDays : null,
        locationRankings: form.locationRankings.length > 0 ? form.locationRankings : null,
        maxShiftsPerMonth: form.maxShiftsPerMonth !== '' ? parseInt(form.maxShiftsPerMonth) : null,
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        notes: form.notes || null,
      }
      if (editTarget) {
        await facilityAPI.updateRosterEntry(editTarget.id, payload)
      } else {
        await facilityAPI.createRosterEntry(payload)
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

  function toggleDay(day) {
    setForm(p => ({
      ...p,
      preferredDays: p.preferredDays.includes(day)
        ? p.preferredDays.filter(d => d !== day)
        : [...p.preferredDays, day],
    }))
  }

  function addLocation() {
    const loc = locationInput.trim()
    if (!loc || form.locationRankings.includes(loc)) return
    setForm(p => ({ ...p, locationRankings: [...p.locationRankings, loc] }))
    setLocationInput('')
  }

  function removeLocation(i) {
    setForm(p => ({ ...p, locationRankings: p.locationRankings.filter((_, idx) => idx !== i) }))
  }

  function moveLocation(i, dir) {
    const arr = [...form.locationRankings]
    const swap = i + dir
    if (swap < 0 || swap >= arr.length) return
    ;[arr[i], arr[swap]] = [arr[swap], arr[i]]
    setForm(p => ({ ...p, locationRankings: arr }))
  }

  const cat = form.employmentCategory

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Internal Provider Roster</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{roster.length} provider{roster.length !== 1 ? 's' : ''} on your roster</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={openUpload}
            style={{ padding: '11px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>📥</span> Upload Roster
          </button>
          <button
            onClick={openAdd}
            style={{ padding: '11px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Provider
          </button>
        </div>
      </div>

      {/* NPI review nudge — gentle, dismissible by acting or ignoring */}
      {npiReviewRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 12, padding: '14px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: '#92400E' }}>
            <strong>{npiReviewRows.length} provider{npiReviewRows.length !== 1 ? 's' : ''}</strong> couldn't be matched to an NPI automatically. Review them to keep your roster fully verified.
          </div>
          <button
            onClick={() => setShowNpiReview(true)}
            style={{ padding: '9px 16px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Review {npiReviewRows.length} →
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 15 }}>Loading roster...</div>}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 24 }}>
          Failed to load roster: {error}
        </div>
      )}

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

      {!loading && roster.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {roster.map((p) => {
            const typeBadge = TYPE_BADGE[p.providerType] || TYPE_BADGE.CRNA
            const empBadge = EMPLOY_BADGE[p.employmentCategory] || EMPLOY_BADGE.FULL_TIME
            const linked = !!p.snapAccountLinked
            const expiringSoon = isExpiringSoon(p.licenseExpiration)
            const rateLabel = p.employmentCategory === 'FULL_TIME'
              ? (p.annualRate ? `$${Number(p.annualRate).toLocaleString()}/yr` : null)
              : (p.hourlyRate ? `$${p.hourlyRate}/hr` : null)

            return (
              <div key={p.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: '20px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginBottom: 8 }}>{p.providerName}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge bg={typeBadge.bg} color={typeBadge.color} label={typeBadge.label} />
                    <Badge bg={empBadge.bg} color={empBadge.color} label={empBadge.label} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: linked ? '#10B981' : '#CBD5E1', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: linked ? '#059669' : '#94A3B8', fontWeight: 500 }}>
                    {linked ? 'SNAP Account Linked' : 'No SNAP Account'}
                  </span>
                </div>

                {rateLabel && (
                  <div style={{ fontSize: 12, color: '#6366F1', fontWeight: 600 }}>{rateLabel}</div>
                )}

                {p.preferredDays && Array.isArray(p.preferredDays) && p.preferredDays.length > 0 && (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    Prefers: {p.preferredDays.join(', ')}
                    {p.preferredShiftLength && p.preferredShiftLength !== 'none' ? ` · ${p.preferredShiftLength}` : ''}
                  </div>
                )}

                {p.licenseExpiration && (
                  <div style={{ fontSize: 12, color: expiringSoon ? '#DC2626' : '#64748B', fontWeight: expiringSoon ? 700 : 400 }}>
                    {expiringSoon ? '⚠️ ' : ''}License expires: {p.licenseExpiration.substring(0, 10)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <button onClick={() => openEdit(p)} style={{ padding: '6px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                    ✏️ Edit
                  </button>
                  <button onClick={() => setTimeOffMember(p)} style={{ padding: '6px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#B45309' }}>
                    🌴 Time Off
                  </button>
                  {!linked && (
                    <button onClick={() => handleInvite(p.id)} disabled={invitedIds[p.id]} style={{ padding: '6px 14px', background: invitedIds[p.id] ? '#F0FDF4' : '#EEF2FF', border: `1px solid ${invitedIds[p.id] ? '#86EFAC' : '#A5B4FC'}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: invitedIds[p.id] ? 'default' : 'pointer', color: invitedIds[p.id] ? '#15803D' : '#4F46E5' }}>
                      {invitedIds[p.id] ? '✓ Invited' : '✉️ Invite'}
                    </button>
                  )}
                  <button onClick={() => handleDelete(p.id)} disabled={deletingIds[p.id]} style={{ padding: '6px 14px', background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#DC2626', marginLeft: 'auto' }}>
                    {deletingIds[p.id] ? '...' : '🗑️'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Provider' : 'Add Provider'} onClose={() => setShowModal(false)}>
          {/* Core fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Provider Name" required>
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
          </div>

          {/* FULL_TIME fields */}
          {cat === 'FULL_TIME' && (
            <>
              <SectionDivider label="Full Time Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="FTE Hours / Week" required>
                  <input style={inputStyle} type="number" min="1" max="60" value={form.fteHours} onChange={(e) => setF('fteHours', e.target.value)} placeholder="40" />
                </Field>
                <Field label="Annual Base Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.annualRate} onChange={(e) => setF('annualRate', e.target.value)} placeholder="e.g. 220000" />
                </Field>
              </div>
            </>
          )}

          {/* PER_DIEM fields */}
          {cat === 'PER_DIEM' && (
            <>
              <SectionDivider label="Per Diem Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="Base Hourly Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.hourlyRate} onChange={(e) => setF('hourlyRate', e.target.value)} placeholder="e.g. 185" />
                </Field>
                <Field label="Max Shifts / Month">
                  <input style={inputStyle} type="number" min="1" value={form.maxShiftsPerMonth} onChange={(e) => setF('maxShiftsPerMonth', e.target.value)} placeholder="e.g. 12" />
                </Field>
              </div>
            </>
          )}

          {/* LOCUMS fields */}
          {cat === 'LOCUMS' && (
            <>
              <SectionDivider label="Locums Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="Base Hourly Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.hourlyRate} onChange={(e) => setF('hourlyRate', e.target.value)} placeholder="e.g. 220" />
                </Field>
                <div />
                <Field label="Contract Start">
                  <input style={inputStyle} type="date" value={form.contractStart} onChange={(e) => setF('contractStart', e.target.value)} />
                </Field>
                <Field label="Contract End">
                  <input style={inputStyle} type="date" value={form.contractEnd} onChange={(e) => setF('contractEnd', e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {/* Shared preference fields */}
          <SectionDivider label="Scheduling Preferences" />

          <Field label="Preferred Shift Length">
            <select style={inputStyle} value={form.preferredShiftLength} onChange={(e) => setF('preferredShiftLength', e.target.value)}>
              {SHIFT_LENGTHS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <Field label="Preferred Days">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {ALL_DAYS.map(day => {
                const active = form.preferredDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: active ? '#6366F1' : '#F8FAFC',
                      color: active ? '#fff' : '#64748B',
                      border: `1px solid ${active ? '#6366F1' : '#E2E8F0'}`,
                      transition: 'all 0.12s',
                    }}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Location Preference Ranking">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLocation() } }}
                placeholder="e.g. Kenmore, Weymouth…"
              />
              <button
                type="button"
                onClick={addLocation}
                style={{ padding: '9px 16px', background: '#EEF2FF', border: '1px solid #A5B4FC', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#4F46E5', whiteSpace: 'nowrap' }}
              >
                Add
              </button>
            </div>
            {form.locationRankings.length > 0 && (
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                {form.locationRankings.map((loc, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: i < form.locationRankings.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', minWidth: 20 }}>#{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{loc}</span>
                    <button onClick={() => moveLocation(i, -1)} disabled={i === 0} style={{ padding: '2px 7px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 4, cursor: i === 0 ? 'not-allowed' : 'pointer', color: '#64748B', opacity: i === 0 ? 0.35 : 1, fontSize: 12 }}>↑</button>
                    <button onClick={() => moveLocation(i, 1)} disabled={i === form.locationRankings.length - 1} style={{ padding: '2px 7px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 4, cursor: i === form.locationRankings.length - 1 ? 'not-allowed' : 'pointer', color: '#64748B', opacity: i === form.locationRankings.length - 1 ? 0.35 : 1, fontSize: 12 }}>↓</button>
                    <button onClick={() => removeLocation(i)} style={{ padding: '2px 7px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 4, cursor: 'pointer', color: '#EF4444', fontSize: 12 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Additional Notes">
            <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="Any relevant notes..." />
          </Field>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Save Provider'}
            </button>
          </div>
        </Modal>
      )}

      {/* Bulk roster upload modal */}
      {showUploadModal && (
        <Modal title="Upload Roster" onClose={() => !uploading && setShowUploadModal(false)}>
          {!uploadResult ? (
            <>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 16px' }}>
                Upload a <strong>CSV</strong> or <strong>Excel</strong> file with your current roster. Each row becomes a provider card you can edit afterward.
                <br />
                <span style={{ fontSize: 13, color: '#64748B' }}>
                  Tip: include the <strong>NPI</strong> column to auto-link providers to their SNAP profile.
                </span>
              </p>

              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={downloadTemplate}
                  style={{ background: 'none', border: 'none', color: '#6366F1', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  📄 Download blank template (.csv)
                </button>
              </div>

              <div style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: 24, textAlign: 'center', background: '#F8FAFC', marginBottom: 16 }}>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  style={{ display: 'block', margin: '0 auto' }}
                  disabled={uploading}
                />
                {uploadFile && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
                    Ready: <strong>{uploadFile.name}</strong> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              <details style={{ marginBottom: 16, fontSize: 13, color: '#64748B' }}>
                <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                  Expected columns
                </summary>
                <div style={{ marginTop: 8, padding: 12, background: '#F8FAFC', borderRadius: 8 }}>
                  <strong>Required:</strong>
                  <ul style={{ marginTop: 4, marginBottom: 8 }}>
                    <li><code>name</code> — provider full name</li>
                    <li><code>type</code> — CRNA / ANESTHESIOLOGIST / ANESTHESIA_ASSISTANT</li>
                    <li><code>employment</code> — FULL_TIME / PER_DIEM / LOCUMS</li>
                  </ul>
                  <strong>Recommended:</strong>
                  <ul style={{ marginTop: 4 }}>
                    <li><code>npi</code> — auto-links to existing provider profile</li>
                    <li><code>email</code>, <code>phone</code>, <code>license_number</code>, <code>license_expiration</code></li>
                    <li><code>hourly_rate</code> (per-diem/locums) or <code>annual_rate</code> + <code>fte_hours</code> (full-time)</li>
                  </ul>
                </div>
              </details>

              {uploadError && (
                <div style={{ background: '#FEF2F2', color: '#991B1B', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                  {uploadError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowUploadModal(false)} disabled={uploading} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                  Cancel
                </button>
                <button onClick={handleUpload} disabled={!uploadFile || uploading} style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: !uploadFile || uploading ? 'not-allowed' : 'pointer', opacity: !uploadFile || uploading ? 0.6 : 1 }}>
                  {uploading ? 'Importing…' : 'Import'}
                </button>
              </div>
            </>
          ) : (
            // Result summary
            <>
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#065F46', marginBottom: 8 }}>
                  ✓ Import complete
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, color: '#065F46' }}>
                  <div><strong>{uploadResult.summary.created}</strong> providers created</div>
                  <div><strong>{uploadResult.summary.matchedToProfiles}</strong> matched to existing SNAP profiles via NPI</div>
                  {uploadResult.summary.locationsCreated > 0 && <div><strong>{uploadResult.summary.locationsCreated}</strong> location credentialings imported</div>}
                  {uploadResult.summary.skipped > 0 && <div><strong>{uploadResult.summary.skipped}</strong> blank rows skipped</div>}
                  {uploadResult.summary.errors > 0 && <div><strong>{uploadResult.summary.errors}</strong> rows had errors (see below)</div>}
                </div>
              </div>

              {uploadResult.summary.needsNpiReview > 0 && (
                <div style={{ background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                    {uploadResult.summary.needsNpiReview} provider{uploadResult.summary.needsNpiReview !== 1 ? 's' : ''} need NPI review
                  </div>
                  <div style={{ fontSize: 13, color: '#92400E' }}>
                    We couldn't auto-match these to a single NPI. You can resolve them now or anytime from the roster page — your roster works either way.
                  </div>
                </div>
              )}

              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>Errors</div>
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {uploadResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#991B1B', padding: '4px 8px', borderBottom: '1px solid #FECACA' }}>
                        {e.row ? `Row ${e.row}` : (e.name || e.nameKey || 'row')} ({e.name || 'no name'}): {e.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                {uploadResult.summary.needsNpiReview > 0 && (
                  <button
                    onClick={async () => { setShowUploadModal(false); await loadNpiReview(); setShowNpiReview(true) }}
                    style={{ padding: '9px 20px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Review NPIs now
                  </button>
                )}
                <button onClick={async () => { setShowUploadModal(false); await load(); await loadNpiReview() }} style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {showNpiReview && (
        <NpiReviewModal
          rows={npiReviewRows}
          onClose={() => { setShowNpiReview(false); loadNpiReview() }}
          onAllResolved={() => { setShowNpiReview(false); loadNpiReview() }}
        />
      )}

      {timeOffMember && (
        <TimeOffModal member={timeOffMember} onClose={() => setTimeOffMember(null)} />
      )}
    </div>
  )
}
