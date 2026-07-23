import React, { useState } from 'react'
import { credentialAPI } from '../../api.js'

// The CV review popup used inside the file-cabinet dump: when the intake spots
// a CV, its full profile is already read — this shows the dossier for a glance,
// and saving both commits the profile to the provider's passport AND confirms
// the intake item so the CV file itself files to that same provider.

const LEVEL_LABEL = { COLLEGE: 'College / Nursing', MED_SCHOOL: 'Medical / CRNA School', RESIDENCY: 'Residency', FELLOWSHIP: 'Fellowship' }

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '3px 0', alignItems: 'baseline' }}>
      <div style={{ width: 120, flexShrink: 0, fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13.5, color: value ? '#0F172A' : '#CBD5E1' }}>{value || '—'}</div>
    </div>
  )
}

function Sec({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0', paddingBottom: 5, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export default function CvDossierModal({ item, onClose, onSaved }) {
  const p = item.cvProfile || {}
  const npi = (item.suggestedNpi || '').replace(/\D/g, '')
  const providerName = item.suggestedProviderName || `${p.identity?.firstName || ''} ${p.identity?.lastName || ''}`.trim()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const low = p.confidence !== 'HIGH'

  const flat = [...Object.values(p.identity || {}), ...Object.values(p.contact || {})].filter(Boolean).length
  const total = flat + (p.education?.length || 0) + (p.workHistory?.length || 0) + (p.affiliations?.length || 0)

  async function save() {
    if (!npi) { setError('This CV has no NPI match yet — set the provider’s NPI on the card first, then review.'); return }
    setSaving(true); setError('')
    try {
      const result = await credentialAPI.commitCv(p, npi)
      if (!result.committed) {
        setError(result.staged ? 'This provider hasn’t claimed their passport yet — it’ll attach when they join.' : 'Could not save.')
        setSaving(false)
        return
      }
      await onSaved(item) // marks the intake item CONFIRMED so the CV file files to this provider too
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={saving ? undefined : onClose}>
      <div style={{ width: '100%', maxWidth: 620, maxHeight: '88vh', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16.5, fontWeight: 800, color: '#0F172A' }}>✨ Profile read from this CV</div>
              <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                {total} details for <strong>{providerName || 'this provider'}</strong>{npi ? ` · NPI ${npi}` : ''}. Glance, then save — the CV files to them too.
              </div>
            </div>
            {low && <span style={{ fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>Give it a glance</span>}
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 22px', flex: 1 }}>
          <Sec title="Identity & Contact">
            <Row label="Name" value={[p.identity?.firstName, p.identity?.middleName, p.identity?.lastName, p.identity?.suffix].filter(Boolean).join(' ')} />
            {p.identity?.formerNames && <Row label="Former" value={p.identity.formerNames} />}
            <Row label="Specialty" value={p.identity?.specialty} />
            <Row label="Email" value={p.contact?.email} />
            <Row label="Phone" value={p.contact?.phone} />
            <Row label="Address" value={[p.contact?.addressStreet, p.contact?.addressCity, p.contact?.addressState, p.contact?.addressZip].filter(Boolean).join(', ')} />
          </Sec>
          {p.education?.length > 0 && (
            <Sec title="Education & Training">
              {p.education.map((e, i) => (
                <div key={i} style={{ fontSize: 13, color: '#0F172A', padding: '2px 0' }}>
                  <strong>{LEVEL_LABEL[e.level] || e.level}</strong>{e.institution ? ` — ${e.institution}` : ''}{e.graduationDate ? <span style={{ color: '#94A3B8' }}> · {e.graduationDate}</span> : null}
                </div>
              ))}
            </Sec>
          )}
          {p.workHistory?.length > 0 && (
            <Sec title="Work History">
              {p.workHistory.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: '#0F172A', padding: '2px 0' }}>
                  <strong>{w.role || 'Position'}</strong>{w.employer ? ` — ${w.employer}` : ''}<span style={{ color: '#94A3B8' }}> · {w.startDate || '?'}–{w.currentlyEmployed ? 'present' : (w.endDate || '?')}</span>
                </div>
              ))}
            </Sec>
          )}
          {p.affiliations?.length > 0 && (
            <Sec title="Affiliations">
              {p.affiliations.map((h, i) => <div key={i} style={{ fontSize: 13, color: '#0F172A', padding: '2px 0' }}><strong>{h.hospitalName}</strong></div>)}
            </Sec>
          )}
          {p.notes && <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>⚠️ {p.notes}</div>}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
          {error && <span style={{ color: '#DC2626', fontSize: 12.5 }}>{error}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: '9px 16px', background: '#F1F5F9', border: 'none', borderRadius: 9, color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Later</button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 20px', background: '#16A34A', border: 'none', borderRadius: 9, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Looks right — save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
