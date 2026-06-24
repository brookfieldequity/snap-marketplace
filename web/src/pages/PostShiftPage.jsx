import React, { useState } from 'react'
import { facilityAPI } from '../api.js'

const SPECIALTIES = [
  { value: 'CRNA', label: 'CRNA' },
  { value: 'ANESTHESIOLOGIST', label: 'Anesthesiologist' },
  { value: 'ANESTHESIA_ASSISTANT', label: 'Anesthesia Assistant' },
]

// Monday-first weekday picker (i = JS getUTCDay value).
const WEEKDAYS = [
  { i: 1, label: 'Mon' }, { i: 2, label: 'Tue' }, { i: 3, label: 'Wed' },
  { i: 4, label: 'Thu' }, { i: 5, label: 'Fri' }, { i: 6, label: 'Sat' }, { i: 0, label: 'Sun' },
]

const ISO = /^\d{4}-\d{2}-\d{2}$/
// Mirror of backend services/recurrence.js so the on-screen preview is exactly
// what will be posted (UTC-based, today-or-future, deduped, capped at 90).
function expandPattern({ mode, startDate, endDate, daysOfWeek, dates }) {
  const cutoff = new Date().toISOString().slice(0, 10)
  const seen = new Set()
  const out = []
  const add = (ymd) => { if (!ISO.test(ymd) || ymd < cutoff || seen.has(ymd)) return; seen.add(ymd); out.push(ymd) }
  if (mode === 'DATES') {
    (dates || []).forEach((d) => add(String(d)))
  } else {
    const dow = new Set((daysOfWeek || []).map(Number))
    if (!ISO.test(startDate || '') || !ISO.test(endDate || '') || dow.size === 0) return []
    let cur = new Date(startDate); const end = new Date(endDate); let g = 0
    while (cur <= end && g++ < 400) {
      if (dow.has(cur.getUTCDay())) add(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }
  return out.sort().slice(0, 90)
}

function prettyDate(ymd) {
  // Render a YYYY-MM-DD as a friendly label without TZ drift.
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
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

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
  marginBottom: 6,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 20px',
        background: checked ? '#FAFAFE' : '#FAFAFA',
        border: `1.5px solid ${checked ? '#2563EB' : '#E2E8F0'}`,
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onClick={() => onChange(!checked)}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{description}</div>}
      </div>
      <div
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          background: checked ? '#2563EB' : '#CBD5E1',
          position: 'relative',
          flexShrink: 0,
          transition: 'background 0.2s',
          marginTop: 2,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            transition: 'left 0.2s',
          }}
        />
      </div>
    </div>
  )
}

export default function PostShiftPage({ onNavigate }) {
  const [step, setStep] = useState(1)
  const [postMode, setPostMode] = useState('SINGLE') // SINGLE | RECURRING
  const [form, setForm] = useState({
    specialty: '',
    date: '',
    startTime: '07:00',
    duration: '',
    payRate: '',
    featured: false,
    preferredEarlyAccess: false,
    preferredHours: 2,
    surgePricing: false,
    // recurring
    recurMode: 'WEEKLY',        // WEEKLY | DATES
    weeklyStart: '',
    weeklyEnd: '',
    daysOfWeek: [1, 2, 3, 4, 5],
    pickedDates: [],
    dateToAdd: '',
  })
  const [createdShift, setCreatedShift] = useState(null)
  const [createdSeries, setCreatedSeries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const pattern = form.recurMode === 'WEEKLY'
    ? { mode: 'WEEKLY', startDate: form.weeklyStart, endDate: form.weeklyEnd, daysOfWeek: form.daysOfWeek }
    : { mode: 'DATES', dates: form.pickedDates }
  const previewDates = postMode === 'RECURRING' ? expandPattern(pattern) : []

  function toggleDow(i) {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(i)
        ? prev.daysOfWeek.filter((d) => d !== i)
        : [...prev.daysOfWeek, i],
    }))
  }

  function addPickedDate() {
    if (!ISO.test(form.dateToAdd) || form.pickedDates.includes(form.dateToAdd)) return
    setForm((prev) => ({ ...prev, pickedDates: [...prev.pickedDates, prev.dateToAdd].sort(), dateToAdd: '' }))
  }

  function removePickedDate(d) {
    setForm((prev) => ({ ...prev, pickedDates: prev.pickedDates.filter((x) => x !== d) }))
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleFocus(e) { e.target.style.borderColor = '#2563EB' }
  function handleBlur(e)  { e.target.style.borderColor = '#E2E8F0' }

  async function handleCreate() {
    setError('')
    const shared = {
      specialty: form.specialty,
      startTime: form.startTime,
      durationHours: Number(form.duration),
      baseRate: Number(form.payRate),
      featured: form.featured,
      preferredAccessOnly: form.preferredEarlyAccess,
      preferredWindowHours: Number(form.preferredHours) || 2,
      surgeEnabled: form.surgePricing,
    }

    if (postMode === 'RECURRING') {
      if (!form.specialty || !form.startTime || !form.duration || !form.payRate) {
        setError('Please fill in specialty, start time, duration, and rate.')
        return
      }
      if (previewDates.length === 0) {
        setError('No dates selected yet — pick weekdays + a range, or add specific dates.')
        return
      }
      setLoading(true)
      try {
        const data = await facilityAPI.postShiftSeries({ ...shared, pattern })
        setCreatedSeries(data)
        setStep(2)
      } catch (err) {
        setError(err.message || 'Failed to create series.')
      } finally {
        setLoading(false)
      }
      return
    }

    // SINGLE
    if (!form.specialty || !form.date || !form.startTime || !form.duration || !form.payRate) {
      setError('Please fill in all required fields.')
      return
    }
    setLoading(true)
    try {
      const data = await facilityAPI.postShift({ ...shared, date: form.date })
      setCreatedShift(data.shift || data)
      setStep(2)
    } catch (err) {
      setError(err.message || 'Failed to create shift.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmDeposit() {
    setLoading(true)
    try {
      if (createdSeries) {
        await facilityAPI.confirmSeriesDeposit(createdSeries.recurrenceGroupId)
      } else if (createdShift) {
        await facilityAPI.confirmDeposit(createdShift.id || createdShift._id)
      } else {
        return
      }
      onNavigate('shifts')
    } catch (err) {
      setError(err.message || 'Failed to confirm deposit.')
    } finally {
      setLoading(false)
    }
  }

  const estimatedTotal = Number(form.payRate || 0) * Number(form.duration || 0)
  const deposit = Math.round(estimatedTotal * 0.25)

  // Step-2 series figures come from the server response when available.
  const isSeries = !!createdSeries
  const seriesCount = createdSeries?.count || 0
  const seriesEstimated = createdSeries?.totalEstimated ?? 0
  const seriesDeposit = createdSeries?.totalDeposit ?? 0
  const seriesRange = createdSeries?.dates?.length
    ? `${prettyDate(createdSeries.dates[0])}${createdSeries.dates.length > 1 ? ` – ${prettyDate(createdSeries.dates[createdSeries.dates.length - 1])}` : ''}`
    : ''

  return (
    <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <button
          onClick={() => step === 1 ? onNavigate('shifts') : setStep(1)}
          style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 }}
        >
          ← {step === 1 ? 'Back to Shifts' : 'Back to Shift Details'}
        </button>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          Post a Shift
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
          {step === 1 ? 'Step 1 — Shift details' : 'Step 2 — Confirm & fund shift'}
        </p>

        {/* Step bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {[1, 2].map((s) => (
            <div key={s} style={{ height: 4, flex: 1, borderRadius: 2, background: s <= step ? '#2563EB' : '#E2E8F0', transition: 'background 0.3s' }} />
          ))}
        </div>
      </div>

      {/* ── STEP 1 ─────────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '32px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Single vs Recurring mode */}
            <div style={{ display: 'flex', gap: 8, background: '#F1F5F9', padding: 4, borderRadius: 12 }}>
              {[{ k: 'SINGLE', label: 'Single date' }, { k: 'RECURRING', label: 'Recurring / multiple' }].map((m) => (
                <button
                  key={m.k}
                  onClick={() => setPostMode(m.k)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: 700,
                    background: postMode === m.k ? '#fff' : 'transparent',
                    color: postMode === m.k ? '#2563EB' : '#64748B',
                    boxShadow: postMode === m.k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Specialty */}
            <div>
              <label style={labelStyle}>Specialty *</label>
              <select
                value={form.specialty}
                onChange={(e) => set('specialty', e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
                onFocus={handleFocus}
                onBlur={handleBlur}
              >
                <option value="">Select specialty...</option>
                {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* SINGLE: Date + Start Time */}
            {postMode === 'SINGLE' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => set('date', e.target.value)}
                    style={inputStyle}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Start Time *</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => set('startTime', e.target.value)}
                    style={inputStyle}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                  />
                </div>
              </div>
            )}

            {/* RECURRING: pattern builder + start time */}
            {postMode === 'RECURRING' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* sub-mode */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ k: 'WEEKLY', label: 'Weekly pattern' }, { k: 'DATES', label: 'Pick specific dates' }].map((m) => (
                    <button
                      key={m.k}
                      onClick={() => set('recurMode', m.k)}
                      style={{
                        padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        border: form.recurMode === m.k ? '2px solid #2563EB' : '1.5px solid #E2E8F0',
                        background: form.recurMode === m.k ? '#EFF6FF' : '#fff',
                        color: form.recurMode === m.k ? '#2563EB' : '#64748B',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {form.recurMode === 'WEEKLY' ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={labelStyle}>From *</label>
                        <input type="date" value={form.weeklyStart} onChange={(e) => set('weeklyStart', e.target.value)} style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                      </div>
                      <div>
                        <label style={labelStyle}>To *</label>
                        <input type="date" value={form.weeklyEnd} onChange={(e) => set('weeklyEnd', e.target.value)} style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Repeat on *</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {WEEKDAYS.map((d) => {
                          const on = form.daysOfWeek.includes(d.i)
                          return (
                            <button
                              key={d.i}
                              onClick={() => toggleDow(d.i)}
                              style={{
                                width: 52, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                                border: on ? '2px solid #2563EB' : '1.5px solid #E2E8F0',
                                background: on ? '#2563EB' : '#fff',
                                color: on ? '#fff' : '#64748B',
                              }}
                            >
                              {d.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <label style={labelStyle}>Add dates *</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="date" value={form.dateToAdd} onChange={(e) => set('dateToAdd', e.target.value)} style={{ ...inputStyle, flex: 1 }} onFocus={handleFocus} onBlur={handleBlur} />
                      <button onClick={addPickedDate} style={{ padding: '0 18px', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Add</button>
                    </div>
                    {form.pickedDates.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {form.pickedDates.map((d) => (
                          <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#2563EB', borderRadius: 16, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                            {prettyDate(d)}
                            <span onClick={() => removePickedDate(d)} style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Start Time * (applies to every shift)</label>
                  <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>

                {/* Preview */}
                <div style={{ background: previewDates.length ? '#EFF6FF' : '#FFFBEB', border: `1px solid ${previewDates.length ? '#BFDBFE' : '#FCD34D'}`, borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: previewDates.length ? '#1D4ED8' : '#92400E' }}>
                    {previewDates.length
                      ? `This will create ${previewDates.length} shift${previewDates.length > 1 ? 's' : ''}`
                      : 'No dates selected yet'}
                  </div>
                  {previewDates.length > 0 && (
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 6, lineHeight: 1.7 }}>
                      {previewDates.slice(0, 8).map(prettyDate).join(' · ')}
                      {previewDates.length > 8 ? ` · +${previewDates.length - 8} more` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Duration + Pay Rate */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Duration (hours) *</label>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={form.duration}
                  onChange={(e) => set('duration', e.target.value)}
                  placeholder="8"
                  style={inputStyle}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
              </div>
              <div>
                <label style={labelStyle}>Pay Rate ($/hr) *</label>
                <input
                  type="number"
                  min="50"
                  value={form.payRate}
                  onChange={(e) => set('payRate', e.target.value)}
                  placeholder="250"
                  style={inputStyle}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
              </div>
            </div>

            {/* Live estimate */}
            {form.duration && form.payRate && (
              <div
                style={{
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13, color: '#15803D', fontWeight: 500 }}>
                  {postMode === 'RECURRING' && previewDates.length
                    ? `Estimated total (${previewDates.length} × ${fmt(estimatedTotal)})`
                    : 'Estimated shift cost'}
                </span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#15803D' }}>
                  {fmt(postMode === 'RECURRING' ? estimatedTotal * previewDates.length : estimatedTotal)}
                </span>
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 12, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Optional Enhancements
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Toggle
                  label="⭐ Featured Listing"
                  description="Your shift appears at the top of search results"
                  checked={form.featured}
                  onChange={(v) => set('featured', v)}
                />
                <Toggle
                  label="🔒 Preferred Provider Early Access"
                  description="Your preferred providers see this shift before the general pool"
                  checked={form.preferredEarlyAccess}
                  onChange={(v) => set('preferredEarlyAccess', v)}
                />
                {form.preferredEarlyAccess && (
                  <div style={{ marginLeft: 16, paddingLeft: 16, borderLeft: '2px solid #2563EB' }}>
                    <label style={labelStyle}>Early Access Window (hours)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[1, 2, 3, 4].map((h) => (
                        <button
                          key={h}
                          onClick={() => set('preferredHours', h)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 8,
                            border: form.preferredHours === h ? '2px solid #2563EB' : '1.5px solid #E2E8F0',
                            background: form.preferredHours === h ? '#EFF6FF' : '#fff',
                            color: form.preferredHours === h ? '#2563EB' : '#64748B',
                            fontWeight: form.preferredHours === h ? 700 : 400,
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Toggle
                  label="⚡ Surge Pricing"
                  description="Offer a premium to fill this shift faster"
                  checked={form.surgePricing}
                  onChange={(v) => set('surgePricing', v)}
                />
              </div>
            </div>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                background: loading ? '#A5B4FC' : '#2563EB',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
              }}
            >
              {loading
                ? 'Creating...'
                : postMode === 'RECURRING' && previewDates.length
                  ? `Continue — ${previewDates.length} shift${previewDates.length > 1 ? 's' : ''} →`
                  : 'Continue to Deposit →'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2 — Deposit Confirmation ──────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Summary card */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #2563EB, #1E3A8A)', padding: '20px 28px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em', marginBottom: 4 }}>
                {isSeries ? 'SERIES CREATED' : 'SHIFT CREATED'}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>
                {isSeries
                  ? `${seriesCount} ${form.specialty} shift${seriesCount > 1 ? 's' : ''}`
                  : `${form.specialty} — ${form.date}`}
              </div>
              {isSeries && seriesRange && (
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>{seriesRange}</div>
              )}
            </div>

            <div style={{ padding: '24px 28px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 }}>
                {[
                  { label: 'Start Time', value: form.startTime },
                  { label: 'Duration', value: `${form.duration} hours` },
                  { label: 'Pay Rate', value: `${fmt(form.payRate)}/hr` },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>{value}</div>
                  </div>
                ))}
              </div>

              {(form.featured || form.preferredEarlyAccess || form.surgePricing) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  {form.featured && (
                    <span style={{ background: '#FFF7ED', color: '#C2410C', border: '1px solid #FDBA74', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                      ⭐ Featured
                    </span>
                  )}
                  {form.preferredEarlyAccess && (
                    <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #A5B4FC', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                      🔒 Early Access {form.preferredHours}h
                    </span>
                  )}
                  {form.surgePricing && (
                    <span style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FCD34D', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                      ⚡ Surge
                    </span>
                  )}
                </div>
              )}

              <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: '#64748B' }}>
                    {isSeries
                      ? `Estimated Total (${seriesCount} shifts)`
                      : `Estimated Total (${form.duration}h × ${fmt(form.payRate)})`}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{fmt(isSeries ? seriesEstimated : estimatedTotal)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#FFFBEB',
                    border: '1px solid #FCD34D',
                    borderRadius: 10,
                    padding: '14px 16px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#92400E' }}>Required Deposit (25%)</div>
                    <div style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>
                      {isSeries ? 'Across the whole series · applied to your final invoice' : 'Applied to your final invoice'}
                    </div>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#D97706' }}>{fmt(isSeries ? seriesDeposit : deposit)}</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: '#15803D', lineHeight: 1.6 }}>
            <strong>How deposits work:</strong> A 25% deposit holds your shift slot and is fully credited toward the provider's final payment. If the shift is cancelled more than 24 hours in advance, the deposit is refunded.
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleConfirmDeposit}
            disabled={loading}
            style={{
              width: '100%',
              padding: '16px',
              background: loading ? '#A5B4FC' : '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontSize: 17,
              fontWeight: 800,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 20px rgba(37,99,235,0.4)',
              letterSpacing: '-0.01em',
            }}
          >
            {loading
              ? 'Processing...'
              : isSeries
                ? `✓ Confirm & Post ${seriesCount} Shifts — ${fmt(seriesDeposit)} Deposit`
                : `✓ Confirm & Post Shift — ${fmt(deposit)} Deposit`}
          </button>
        </div>
      )}
    </div>
  )
}
