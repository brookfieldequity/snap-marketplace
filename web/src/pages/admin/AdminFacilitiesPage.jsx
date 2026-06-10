import React, { useState, useEffect, useCallback } from 'react'
import { adminAPI } from '../../api.js'

const TIER_COLORS = {
  BASIC:        { bg: '#EFF6FF', text: '#1D4ED8', border: '#A5B4FC' },
  PROFESSIONAL: { bg: '#F3E8FF', text: '#1E3A8A', border: '#DDD6FE' },
  ENTERPRISE:   { bg: '#0F172A', text: '#fff',    border: '#334155' },
}

const TIER_PRICES = { BASIC: '$750', PROFESSIONAL: '$2,000', ENTERPRISE: '$5,000' }

const FACILITY_TYPES = [
  '',
  'ASC',
  'HOSPITAL',
  'OFFICE_BASED',
  'OTHER',
]

const ROLE_OPTIONS = [
  { value: 'ADMIN',       label: 'Administrator' },
  { value: 'COORDINATOR', label: 'Coordinator' },
  { value: 'VIEWER',      label: 'Viewer (read-only)' },
]

// ────────────────────────────────────────────────────────────────────────────────

export default function AdminFacilitiesPage({ onOpenRoi } = {}) {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [updating, setUpdating]     = useState({})
  const [search, setSearch]         = useState('')
  const [showNew, setShowNew]       = useState(false)
  const [inviteTarget, setInviteTarget] = useState(null)  // facility row to invite into
  const [invitesTarget, setInvitesTarget] = useState(null)  // facility row to view invites

  const load = useCallback(() => {
    setLoading(true)
    adminAPI.getFacilities()
      .then(setFacilities)
      .catch(() => setFacilities([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleTierChange(facilityId, newTier) {
    setUpdating((prev) => ({ ...prev, [facilityId]: true }))
    try {
      await adminAPI.updateSubscription(facilityId, newTier)
      setFacilities((prev) =>
        prev.map((f) => f.id === facilityId
          ? { ...f, subscription: { ...(f.subscription || {}), tier: newTier } }
          : f)
      )
    } catch {
      alert('Failed to update subscription.')
    } finally {
      setUpdating((prev) => ({ ...prev, [facilityId]: false }))
    }
  }

  // TEMPORARY (test-period teardown): force-delete a facility + ALL its data +
  // orphaned coordinator logins. Guarded by typing the exact facility name so a
  // mis-click can't nuke the real CAPA facility. Remove this + the button after
  // the pilot.
  async function handleDeleteFacility(id, name) {
    const typed = window.prompt(
      `⚠️ PERMANENTLY delete "${name}"?\n\n` +
      `This removes the facility and ALL its data — roster, schedules, coverage ` +
      `templates, shifts, ROI, credentialing — plus orphaned coordinator logins. ` +
      `This CANNOT be undone.\n\nType the facility name exactly to confirm:`
    )
    if (typed === null) return
    if (typed.trim() !== name) { alert('Name did not match — delete cancelled.'); return }
    try {
      const res = await adminAPI.deleteFacility(id, true)
      const logins = res?.loginsDeleted || []
      alert(
        `Deleted "${res?.facility?.name || name}".\n` +
        `Membership links removed: ${res?.facilityUsersDeleted ?? 0}\n` +
        `Logins deleted: ${logins.length ? logins.join(', ') : 'none'}`
      )
      load()
    } catch (e) {
      alert('Delete failed: ' + (e?.message || e))
    }
  }

  const normalize = (f) => ({
    ...f,
    _name: f.name || '',
    _tier: f.subscription?.tier || 'BASIC',
    _shifts: f._count?.shifts ?? 0,
    _location: [f.address, f.state, f.zipCode].filter(Boolean).join(', ') || '—',
  })

  const filtered = facilities.map(normalize).filter((f) =>
    !search ||
    f._name.toLowerCase().includes(search.toLowerCase()) ||
    (f.zipCode || '').toLowerCase().includes(search.toLowerCase()) ||
    (f.address || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Facilities</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{facilities.length} registered facilities</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            background: '#2563EB', color: '#fff', border: 'none',
            padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 1px 3px rgba(37,99,235,0.3)',
          }}
        >
          + New Facility
        </button>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        {['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].map((tier) => {
          const cfg = TIER_COLORS[tier]
          const count = facilities.filter((f) => (f.subscription?.tier) === tier).length
          return (
            <div key={tier} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '12px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cfg.text, letterSpacing: '0.05em', marginBottom: 4 }}>{tier}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: cfg.text }}>{count}</div>
              <div style={{ fontSize: 12, color: cfg.text, opacity: 0.7 }}>{TIER_PRICES[tier]}/mo</div>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 20 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔍</span>
        <input
          type="text"
          placeholder="Search facilities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px 10px 36px',
            background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10,
            fontSize: 14, color: '#0F172A', outline: 'none',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
          onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 60px 160px 220px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Facility', 'Location', 'Tier', 'Shifts', 'Update Tier', 'Actions'].map((h) => (
            <div key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </div>
          ))}
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            No facilities yet. Click <strong>+ New Facility</strong> to get started.
          </div>
        )}

        {filtered.map((f, i) => {
          const cfg = TIER_COLORS[f._tier] || TIER_COLORS.BASIC
          return (
            <div key={f.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.4fr 1fr 60px 160px 220px',
              borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
              background: i % 2 === 0 ? '#fff' : '#FAFAFA',
              alignItems: 'center',
            }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>
                  {f._name || <span style={{ color: '#CBD5E1', fontStyle: 'italic' }}>Unnamed facility</span>}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{f.facilityType || '—'}</div>
              </div>

              <div style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>{f._location}</div>

              <div style={{ padding: '14px 16px' }}>
                <span style={{
                  background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
                  borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700,
                }}>
                  {f._tier}
                </span>
              </div>

              <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                {f._shifts}
              </div>

              <div style={{ padding: '14px 16px' }}>
                <select
                  value={f._tier}
                  onChange={(e) => handleTierChange(f.id, e.target.value)}
                  disabled={updating[f.id]}
                  style={{
                    padding: '7px 10px', background: updating[f.id] ? '#F8FAFC' : '#fff',
                    border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13,
                    color: '#374151', cursor: updating[f.id] ? 'not-allowed' : 'pointer',
                    outline: 'none', width: '100%',
                  }}
                >
                  {['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].map((t) => (
                    <option key={t} value={t}>{t} — {TIER_PRICES[t]}/mo</option>
                  ))}
                </select>
              </div>

              <div style={{ padding: '14px 16px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setInviteTarget({ id: f.id, name: f._name })}
                  title="Invite a coordinator to this facility"
                  style={{ padding: '6px 10px', background: '#fff', color: '#2563EB', border: '1.5px solid #C7D2FE', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  📧 Invite
                </button>
                <button
                  onClick={() => setInvitesTarget({ id: f.id, name: f._name })}
                  title="View pending and claimed invites"
                  style={{ padding: '6px 10px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  📋 Invites
                </button>
                {onOpenRoi && (
                  <button
                    onClick={() => onOpenRoi(f.id)}
                    title="Open this facility's ROI tracker"
                    style={{ padding: '6px 10px', background: '#fff', color: '#059669', border: '1.5px solid #6EE7B7', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    💰 ROI
                  </button>
                )}
                {/* TEMPORARY test-teardown button — remove after the pilot */}
                <button
                  onClick={() => handleDeleteFacility(f.id, f._name)}
                  title="TEST TEARDOWN — permanently delete this facility, its data, and orphaned logins"
                  style={{ padding: '6px 10px', background: '#fff', color: '#DC2626', border: '1.5px solid #FECACA', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {showNew && (
        <NewFacilityModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load() }}
        />
      )}

      {inviteTarget && (
        <InviteUserModal
          facility={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onSent={() => { setInviteTarget(null) }}
        />
      )}

      {invitesTarget && (
        <InvitesListModal
          facility={invitesTarget}
          onClose={() => setInvitesTarget(null)}
        />
      )}
    </div>
  )
}

// ── Modals ──────────────────────────────────────────────────────────────────────

function ModalShell({ title, subtitle, onClose, children, maxWidth = 520 }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, maxWidth, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{title}</h2>
            {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748B' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94A3B8', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: '24px 28px 28px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', letterSpacing: '0.03em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1.5px solid #E2E8F0', borderRadius: 8,
  fontSize: 14, color: '#0F172A', outline: 'none',
  boxSizing: 'border-box',
}

function NewFacilityModal({ onClose, onCreated }) {
  const [name, setName]                 = useState('')
  const [facilityType, setFacilityType] = useState('')
  const [address, setAddress]           = useState('')
  const [zipCode, setZipCode]           = useState('')
  const [state, setState]               = useState('MA')
  const [tier, setTier]                 = useState('BASIC')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState(null)

  async function submit(e) {
    e?.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Facility name is required.'); return }
    setSubmitting(true)
    try {
      await adminAPI.createFacility({
        name: name.trim(),
        facilityType: facilityType || null,
        address: address.trim() || null,
        zipCode: zipCode.trim() || null,
        state,
        tier,
      })
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not create facility.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title="New Facility"
      subtitle="Set the customer up so when they receive their invite, everything is ready."
      onClose={onClose}
      maxWidth={560}
    >
      <form onSubmit={submit}>
        <Field label="Facility name *" hint="e.g. CAPA Pilot, Atrius Health Surgical Center">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="CAPA Pilot"
            style={inputStyle}
          />
        </Field>

        <Field label="Type">
          <select value={facilityType} onChange={(e) => setFacilityType(e.target.value)} style={inputStyle}>
            {FACILITY_TYPES.map((t) => <option key={t || 'none'} value={t}>{t || '— Select —'}</option>)}
          </select>
        </Field>

        <Field label="Address">
          <input
            type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
          <Field label="ZIP">
            <input
              type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)}
              placeholder="02101"
              style={inputStyle}
            />
          </Field>
          <Field label="State">
            <input
              type="text" value={state} onChange={(e) => setState(e.target.value)}
              maxLength={2}
              style={{ ...inputStyle, textTransform: 'uppercase' }}
            />
          </Field>
        </div>

        <Field label="Subscription tier">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {['BASIC', 'PROFESSIONAL', 'ENTERPRISE'].map((t) => {
              const active = tier === t
              const cfg = TIER_COLORS[t]
              return (
                <button
                  key={t} type="button" onClick={() => setTier(t)}
                  style={{
                    padding: '10px 8px',
                    background: active ? cfg.bg : '#fff',
                    border: `1.5px solid ${active ? cfg.text : '#E2E8F0'}`,
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: 12, fontWeight: 700,
                    color: active ? cfg.text : '#64748B',
                    textAlign: 'center',
                  }}
                >
                  {t}<br/>
                  <span style={{ fontWeight: 500, opacity: 0.75 }}>{TIER_PRICES[t]}/mo</span>
                </button>
              )
            })}
          </div>
        </Field>

        {error && <div style={{ padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Creating…' : 'Create Facility'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function InviteUserModal({ facility, onClose, onSent }) {
  const [recipientName, setRecipientName] = useState('')
  const [email, setEmail]                 = useState('')
  const [role, setRole]                   = useState('ADMIN')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState(null)
  const [result, setResult]               = useState(null)

  async function submit(e) {
    e?.preventDefault()
    setError(null)
    if (!email.trim()) { setError('Email is required.'); return }
    setSubmitting(true)
    try {
      const r = await adminAPI.inviteFacilityUser(
        facility.id,
        email.trim().toLowerCase(),
        role,
        recipientName.trim() || undefined,
      )
      setResult(r.invite || { email: email.trim().toLowerCase() })
    } catch (err) {
      setError(err.message || 'Could not send invite.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title={result ? 'Invite sent ✓' : `Invite to ${facility.name}`}
      subtitle={result ? null : 'They’ll receive an email with a secure link to set their password and log in.'}
      onClose={onClose}
    >
      {!result && (
        <form onSubmit={submit}>
          <Field label="Their first name" hint="Greets them by name in the email (“Hi Ryan,”). We’ll derive it from the email if you skip.">
            <input
              type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Ryan"
              autoFocus
              style={inputStyle}
            />
          </Field>

          <Field label="Their email address *">
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="ryan@example.com"
              style={inputStyle}
            />
          </Field>

          <Field label="Their role" hint="What they’ll be able to do once they log in.">
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>

          {error && <div style={{ padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: '#0F172A', lineHeight: 1.6 }}>
            Sent an invite email to <strong>{result.email}</strong>. They’ll receive a link to set their password and log in.
          </p>
          {result.expiresAt && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748B' }}>
              The invite expires <strong>{new Date(result.expiresAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>.
            </p>
          )}
          {result.resent && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
              Note: a previous invite already existed — that one has been refreshed with a new link.
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button onClick={onSent} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

function InvitesListModal({ facility, onClose }) {
  const [invites, setInvites] = useState(null)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    adminAPI.listFacilityInvites(facility.id)
      .then((rows) => { if (!cancelled) setInvites(rows) })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load invites.') })
    return () => { cancelled = true }
  }, [facility.id])

  return (
    <ModalShell
      title={`Invites — ${facility.name}`}
      subtitle="Everyone you've invited to this facility."
      onClose={onClose}
      maxWidth={600}
    >
      {invites === null && !error && <div style={{ padding: 20, color: '#94A3B8', fontSize: 14 }}>Loading…</div>}
      {error && <div style={{ padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: '#B91C1C', fontSize: 13 }}>{error}</div>}
      {invites && invites.length === 0 && (
        <div style={{ padding: 20, color: '#94A3B8', fontSize: 14, textAlign: 'center' }}>
          No invites sent yet for this facility.
        </div>
      )}
      {invites && invites.length > 0 && (
        <div>
          {invites.map((inv) => {
            const statusColor = inv.status === 'CLAIMED' ? '#059669'
              : inv.status === 'EXPIRED' ? '#DC2626' : '#D97706'
            const statusBg = inv.status === 'CLAIMED' ? '#ECFDF5'
              : inv.status === 'EXPIRED' ? '#FEF2F2' : '#FEF3C7'
            return (
              <div key={inv.id} style={{ padding: '12px 4px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14, marginBottom: 2 }}>{inv.email}</div>
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>
                    {inv.facilityRole} · sent {new Date(inv.createdAt).toLocaleDateString()}
                    {inv.invitedByName ? ` by ${inv.invitedByName}` : ''}
                  </div>
                </div>
                <span style={{ background: statusBg, color: statusColor, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
                  {inv.status}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}
