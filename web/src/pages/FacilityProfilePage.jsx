import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../api.js'

const FACILITY_TYPES = [
  'Ambulatory Surgery Center',
  'Hospital',
  'Surgical Hospital',
  'Specialty Clinic',
  'Other',
]

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  background: '#F8FAFC',
  border: '1.5px solid #E2E8F0',
  borderRadius: 10,
  fontSize: 14,
  color: '#0F172A',
  outline: 'none',
  transition: 'border-color 0.15s',
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
  marginBottom: 6,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const FIELDS = ['facilityName', 'facilityType', 'address', 'zipCode', 'description', 'caseMix', 'parking', 'whatToBring', 'photoUrls']

function computeCompletion(form) {
  const filled = FIELDS.filter((f) => {
    const v = form[f]
    return Array.isArray(v) ? v.length > 0 : v && v.toString().trim().length > 0
  }).length
  return Math.round((filled / FIELDS.length) * 100)
}

export default function FacilityProfilePage() {
  const [form, setForm] = useState({
    facilityName: '',
    facilityType: '',
    address: '',
    zipCode: '',
    description: '',
    caseMix: '',
    parking: '',
    whatToBring: '',
    photoUrls: [],
  })
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [error, setError]             = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError]   = useState('')

  useEffect(() => {
    facilityAPI.getMe()
      .then((data) => {
        setForm({
          facilityName: data.name || '',
          facilityType: data.facilityType || '',
          address: data.address || '',
          zipCode: data.zipCode || '',
          description: data.description || '',
          caseMix: data.caseMix || '',
          parking: data.parking || '',
          whatToBring: data.whatToBring || '',
          photoUrls: data.photoUrls || [],
        })
      })
      .catch(() => {
        setForm({
          facilityName: 'Boston Surgery Center',
          facilityType: 'Ambulatory Surgery Center',
          address: '123 Medical Plaza Dr',
          zipCode: '02101',
          description: '',
          caseMix: '',
          parking: '',
          whatToBring: '',
          photoUrls: [],
        })
      })
      .finally(() => setLoading(false))
  }, [])

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handlePhotoUpload(e) {
    const files = e.target.files
    if (!files?.length) return
    setPhotoError('')
    setPhotoUploading(true)
    try {
      const formData = new FormData()
      Array.from(files).slice(0, 5).forEach((f) => formData.append('photos', f))
      const result = await facilityAPI.uploadPhotos(formData)
      setForm((prev) => ({ ...prev, photoUrls: result.allPhotos }))
    } catch (err) {
      setPhotoError(err.message || 'Photo upload failed.')
    } finally {
      setPhotoUploading(false)
      e.target.value = ''
    }
  }

  async function handleDeletePhoto(url) {
    try {
      const result = await facilityAPI.deletePhoto(url)
      setForm((prev) => ({ ...prev, photoUrls: result.allPhotos }))
    } catch {
      // non-critical
    }
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const payload = {
        name: form.facilityName,
        facilityType: form.facilityType,
        address: form.address,
        zipCode: form.zipCode,
        description: form.description,
        caseMix: form.caseMix,
        parking: form.parking,
        whatToBring: form.whatToBring,
        photoUrls: form.photoUrls,
      }
      await facilityAPI.updateMe(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  const completion = computeCompletion(form)

  const hoverFocus = {
    onFocus: (e) => (e.target.style.borderColor = '#6366F1'),
    onBlur:  (e) => (e.target.style.borderColor = '#E2E8F0'),
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 800 }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Facility Profile</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          A complete profile helps providers choose your facility
        </p>
      </div>

      {/* Completion bar */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          padding: '20px 24px',
          marginBottom: 28,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Profile Completion</span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: completion === 100 ? '#10B981' : completion > 60 ? '#F59E0B' : '#EF4444',
            }}
          >
            {completion}%
          </span>
        </div>
        <div style={{ height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${completion}%`,
              borderRadius: 4,
              background: completion === 100 ? '#10B981' : completion > 60 ? '#F59E0B' : '#EF4444',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        {completion < 100 && (
          <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
            Complete all fields to maximize your visibility to top providers.
          </p>
        )}
      </div>

      {/* Form */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '32px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Section: Basic Info */}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #F1F5F9', paddingBottom: 10 }}>
              Basic Information
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Facility Name</label>
                <input
                  type="text"
                  value={form.facilityName}
                  onChange={(e) => set('facilityName', e.target.value)}
                  style={inputStyle}
                  {...hoverFocus}
                />
              </div>
              <div>
                <label style={labelStyle}>Facility Type</label>
                <select
                  value={form.facilityType}
                  onChange={(e) => set('facilityType', e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  {...hoverFocus}
                >
                  <option value="">Select type...</option>
                  {FACILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Street Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  style={inputStyle}
                  {...hoverFocus}
                />
              </div>
              <div>
                <label style={labelStyle}>ZIP Code</label>
                <input
                  type="text"
                  value={form.zipCode}
                  onChange={(e) => set('zipCode', e.target.value)}
                  placeholder="e.g. 02101"
                  maxLength={5}
                  style={inputStyle}
                  {...hoverFocus}
                />
              </div>
            </div>

            {/* Section: Provider-facing info */}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #F1F5F9', paddingBottom: 10, marginTop: 8 }}>
              Provider-Facing Details
            </div>

            <div>
              <label style={labelStyle}>Facility Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Tell providers about your facility — specialties, culture, team..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                {...hoverFocus}
              />
            </div>

            <div>
              <label style={labelStyle}>Case Mix</label>
              <textarea
                value={form.caseMix}
                onChange={(e) => set('caseMix', e.target.value)}
                placeholder="e.g., General surgery, orthopedics, GI, urology, laparoscopic procedures..."
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                {...hoverFocus}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Parking Instructions</label>
                <textarea
                  value={form.parking}
                  onChange={(e) => set('parking', e.target.value)}
                  placeholder="e.g., Free provider parking in Lot B, badge required..."
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                  {...hoverFocus}
                />
              </div>
              <div>
                <label style={labelStyle}>What to Bring</label>
                <textarea
                  value={form.whatToBring}
                  onChange={(e) => set('whatToBring', e.target.value)}
                  placeholder="e.g., ACLS card, drug testing results, scrubs provided..."
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                  {...hoverFocus}
                />
              </div>
            </div>

            {/* Facility Photos */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #F1F5F9', paddingBottom: 10, marginBottom: 16 }}>
                Facility Photos
              </div>

              {/* Existing photos */}
              {form.photoUrls.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                  {form.photoUrls.map((url, i) => (
                    <div key={i} style={{ position: 'relative', width: 100, height: 100 }}>
                      <img
                        src={url}
                        alt={`Facility photo ${i + 1}`}
                        style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E8F0' }}
                      />
                      <button
                        onClick={() => handleDeletePhoto(url)}
                        style={{
                          position: 'absolute', top: 4, right: 4,
                          background: 'rgba(239,68,68,0.85)', color: '#fff',
                          border: 'none', borderRadius: '50%', width: 20, height: 20,
                          cursor: 'pointer', fontSize: 12, lineHeight: '20px', textAlign: 'center', padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload area */}
              <label
                style={{
                  display: 'block',
                  border: '2px dashed #CBD5E1',
                  borderRadius: 12,
                  padding: '28px',
                  textAlign: 'center',
                  cursor: photoUploading || form.photoUrls.length >= 10 ? 'not-allowed' : 'pointer',
                  opacity: photoUploading ? 0.7 : 1,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { if (!photoUploading) e.currentTarget.style.borderColor = '#6366F1' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#CBD5E1' }}
              >
                {photoUploading ? (
                  <div style={{ fontSize: 14, color: '#6366F1', fontWeight: 600 }}>Uploading...</div>
                ) : form.photoUrls.length >= 10 ? (
                  <>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📷</div>
                    <div style={{ fontSize: 13, color: '#94A3B8' }}>Maximum 10 photos reached</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📷</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#64748B' }}>Click to upload photos</div>
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                      Up to 5 at a time · Max 10MB each · JPG, PNG, WebP
                      {form.photoUrls.length > 0 && ` · ${10 - form.photoUrls.length} slots remaining`}
                    </div>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePhotoUpload}
                  disabled={photoUploading || form.photoUrls.length >= 10}
                />
              </label>

              {photoError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#DC2626', marginTop: 8 }}>
                  {photoError}
                </div>
              )}
            </div>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '14px',
                background: saved ? '#10B981' : saving ? '#A5B4FC' : '#6366F1',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'background 0.3s',
                boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
              }}
            >
              {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
