import React, { useEffect, useMemo, useRef, useState } from 'react'
import { credentialAPI } from '../../api.js'

// CV Reader — upload a provider's CV, watch a full profile assemble itself,
// glance, and save to the passport. The anti-spreadsheet review: a readable
// dossier that fills itself, not a grid. Values sit filled-in; only low-
// confidence items ask for a glance. One button commits to the passport.

const LEVEL_LABEL = { COLLEGE: 'College / Nursing', MED_SCHOOL: 'Medical / CRNA School', RESIDENCY: 'Residency', FELLOWSHIP: 'Fellowship' }

function Reveal({ name }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ fontSize: 40 }}>📄</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginTop: 12 }}>Reading {name || 'the CV'}…</div>
      <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>SNAP is pulling the full profile — contact, training, work history, certifications.</div>
    </div>
  )
}

function Field({ label, value, editable, onChange, low }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  const empty = !value
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', alignItems: 'baseline' }}>
      <div style={{ width: 130, flexShrink: 0, fontSize: 11.5, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      {editing ? (
        <input
          autoFocus value={v} onChange={(e) => setV(e.target.value)}
          onBlur={() => { setEditing(false); if (v !== (value || '')) onChange(v) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          style={{ flex: 1, fontSize: 14, color: '#0F172A', border: '1px solid #2563EB', borderRadius: 6, padding: '2px 8px', outline: 'none' }}
        />
      ) : (
        <div
          onClick={editable ? () => setEditing(true) : undefined}
          title={editable ? 'Click to edit' : undefined}
          style={{
            flex: 1, fontSize: 14, color: empty ? '#CBD5E1' : '#0F172A', cursor: editable ? 'text' : 'default',
            borderBottom: low && !empty ? '2px solid #FCD34D' : '2px solid transparent', paddingBottom: 1,
          }}
        >
          {value || (editable ? '— add —' : '—')}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0', paddingBottom: 6, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

// ⚠️ TESTING ONLY — REMOVE BEFORE GENERAL RELEASE (2026-07-23) ⚠️
// Wipes a provider's CV-populated passport data so the full flow can be re-run.
function TestingReset({ roster }) {
  const [npi, setNpi] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function reset() {
    const r = roster.find((x) => x.npi === npi)
    if (!npi) return
    if (!window.confirm(`TESTING RESET — wipe ${r?.providerName || npi}'s CV-populated passport data (contact, education, work history, affiliations, CV docs)? Identity is kept. This cannot be undone.`)) return
    setBusy(true); setMsg('')
    try {
      const res = await credentialAPI.resetCvProvider(npi)
      setMsg(res.reset ? `Reset ✓ — cleared ${res.cleared?.education || 0} edu, ${res.cleared?.workHistory || 0} work, ${res.cleared?.affiliations || 0} affiliations, ${res.cleared?.cvDocuments || 0} CV docs.` : 'No passport found for that NPI.')
    } catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }
  return (
    <div style={{ border: '1px dashed #FCA5A5', background: '#FEF2F2', borderRadius: 10, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>🧪 Testing reset</span>
      <select value={npi} onChange={(e) => setNpi(e.target.value)} style={{ padding: '6px 9px', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12.5, background: '#fff' }}>
        <option value="">Provider…</option>
        {roster.map((r) => <option key={r.id} value={r.npi}>{r.providerName}</option>)}
      </select>
      <button onClick={reset} disabled={busy || !npi} style={{ padding: '6px 13px', background: !npi ? '#FCA5A5' : '#DC2626', border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 800, cursor: !npi ? 'not-allowed' : 'pointer' }}>{busy ? 'Resetting…' : 'Wipe & re-test'}</button>
      {msg && <span style={{ fontSize: 12, color: '#B91C1C' }}>{msg}</span>}
      <span style={{ fontSize: 11, color: '#94A3B8' }}>(remove before launch)</span>
    </div>
  )
}

export default function CredCvReader() {
  const [roster, setRoster] = useState([])
  const [npi, setNpi] = useState('')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    credentialAPI.getPortalRoster().then((d) => setRoster((d.roster || []).filter((r) => r.npi))).catch(() => {})
  }, [])

  function pick(list) {
    const f = Array.from(list || []).find((x) => ['application/pdf', 'image/jpeg', 'image/png'].includes(x.type))
    if (f) { setFile(f); read(f) }
  }

  async function read(f) {
    setReading(true); setError(''); setProfile(null); setDone(null)
    try {
      const p = await credentialAPI.extractCv(f)
      if (!p?.cvDetected) { setError("That doesn't look like a CV — try a different file."); setReading(false); return }
      setProfile(p)
    } catch (e) { setError(e.message || 'Failed to read the CV.') }
    finally { setReading(false) }
  }

  function setField(group, key, value) {
    setProfile((p) => ({ ...p, [group]: { ...(p[group] || {}), [key]: value || null } }))
  }

  async function save() {
    if (!npi) { setError('Pick which provider this CV belongs to first.'); return }
    setSaving(true); setError('')
    try {
      const result = await credentialAPI.commitCv(profile, npi)
      if (result.committed) setDone(result)
      else if (result.staged) setError('This provider hasn’t claimed their SNAP passport yet — invite them first, then the CV profile attaches automatically.')
      else setError('Could not save — try again.')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const low = profile?.confidence === 'LOW' || profile?.confidence === 'MEDIUM'
  const filledCount = useMemo(() => {
    if (!profile) return 0
    const idn = profile.identity || {}, con = profile.contact || {}
    const flat = [...Object.values(idn), ...Object.values(con)].filter(Boolean).length
    return flat + (profile.education?.length || 0) + (profile.workHistory?.length || 0) + (profile.affiliations?.length || 0)
  }, [profile])

  const selectedName = roster.find((r) => r.npi === npi)?.providerName

  return (
    <div style={{ padding: '28px 32px', maxWidth: 780 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>Read a CV</h1>
      <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 4, marginBottom: 20 }}>
        Upload a provider's CV and SNAP fills their whole profile — contact, training, work history, certifications. Glance, then save. No typing.
      </div>

      {/* ⚠️ TESTING ONLY — remove before general release (2026-07-23) */}
      <TestingReset roster={roster} />


      {done ? (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 28 }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 14 }}>Saved to {selectedName || 'the'} passport</div>
          <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 8 }}>
            Added {done.counts?.education || 0} education/training, {done.counts?.workHistory || 0} work-history, and {done.counts?.affiliations || 0} affiliation entries, plus contact details. Every Cred Map packet for this provider now fills from it.
          </div>
          <button onClick={() => { setProfile(null); setFile(null); setDone(null); setNpi('') }} style={{ marginTop: 18, padding: '11px 22px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>Read another CV</button>
        </div>
      ) : reading ? (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16 }}><Reveal name={file?.name} /></div>
      ) : !profile ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            style={{ border: `2px dashed ${dragOver ? '#2563EB' : '#CBD5E1'}`, borderRadius: 14, background: dragOver ? '#EFF6FF' : '#F8FAFC', padding: '44px 20px', textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 34 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#334155', marginTop: 10 }}>Drop a provider's CV</div>
            <div style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 4 }}>PDF or scan · SNAP reads it in about 20 seconds</div>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={(e) => pick(e.target.files)} />
          </div>
          {error && <div style={{ marginTop: 14, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}
        </>
      ) : (
        <>
          {/* Provider picker + summary */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>✨ Read {filledCount} details from the CV</span>
            {low && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '3px 10px' }}>Give the amber items a glance</span>}
            <div style={{ flex: 1 }} />
            <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600 }}>Save to</label>
            <select value={npi} onChange={(e) => setNpi(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff' }}>
              <option value="">Pick provider…</option>
              {roster.map((r) => <option key={r.id} value={r.npi}>{r.providerName}</option>)}
            </select>
          </div>

          {/* The dossier */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '24px 28px' }}>
            <Section title="Identity">
              <Field label="First name" value={profile.identity?.firstName} editable low={low} onChange={(v) => setField('identity', 'firstName', v)} />
              <Field label="Middle" value={profile.identity?.middleName} editable low={low} onChange={(v) => setField('identity', 'middleName', v)} />
              <Field label="Last name" value={profile.identity?.lastName} editable low={low} onChange={(v) => setField('identity', 'lastName', v)} />
              <Field label="Suffix" value={profile.identity?.suffix} editable onChange={(v) => setField('identity', 'suffix', v)} />
              <Field label="Former names" value={profile.identity?.formerNames} editable onChange={(v) => setField('identity', 'formerNames', v)} />
              <Field label="Specialty" value={profile.identity?.specialty} editable low={low} onChange={(v) => setField('identity', 'specialty', v)} />
              <Field label="NPI" value={profile.identity?.npi} editable onChange={(v) => setField('identity', 'npi', v)} />
            </Section>
            <Section title="Contact">
              <Field label="Email" value={profile.contact?.email} editable low={low} onChange={(v) => setField('contact', 'email', v)} />
              <Field label="Phone" value={profile.contact?.phone} editable low={low} onChange={(v) => setField('contact', 'phone', v)} />
              <Field label="Street" value={profile.contact?.addressStreet} editable low={low} onChange={(v) => setField('contact', 'addressStreet', v)} />
              <Field label="City" value={profile.contact?.addressCity} editable low={low} onChange={(v) => setField('contact', 'addressCity', v)} />
              <Field label="State" value={profile.contact?.addressState} editable low={low} onChange={(v) => setField('contact', 'addressState', v)} />
              <Field label="ZIP" value={profile.contact?.addressZip} editable low={low} onChange={(v) => setField('contact', 'addressZip', v)} />
            </Section>
            {(profile.education?.length > 0) && (
              <Section title="Education & Training">
                {profile.education.map((e, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '3px 0' }}>
                    <strong>{LEVEL_LABEL[e.level] || e.level}</strong>{e.institution ? ` — ${e.institution}` : ''}
                    {e.degreeOrProgram ? <span style={{ color: '#64748B' }}> · {e.degreeOrProgram}</span> : null}
                    {e.graduationDate ? <span style={{ color: '#94A3B8' }}> · {e.graduationDate}</span> : null}
                  </div>
                ))}
              </Section>
            )}
            {(profile.workHistory?.length > 0) && (
              <Section title="Work History">
                {profile.workHistory.map((w, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '3px 0' }}>
                    <strong>{w.role || 'Position'}</strong>{w.employer ? ` — ${w.employer}` : ''}
                    <span style={{ color: '#94A3B8' }}> · {w.startDate || '?'} – {w.currentlyEmployed ? 'present' : (w.endDate || '?')}</span>
                    {w.location ? <span style={{ color: '#64748B' }}> · {w.location}</span> : null}
                  </div>
                ))}
              </Section>
            )}
            {(profile.affiliations?.length > 0) && (
              <Section title="Hospital Affiliations">
                {profile.affiliations.map((h, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '3px 0' }}>
                    <strong>{h.hospitalName}</strong>
                    <span style={{ color: '#94A3B8' }}> · {h.startDate || '?'} – {h.currentlyActive ? 'present' : (h.endDate || '?')}</span>
                  </div>
                ))}
              </Section>
            )}
            {profile.boardCertification?.certifyingBoard && (
              <Section title="Board Certification">
                <div style={{ fontSize: 13.5, color: '#0F172A' }}>
                  <strong>{profile.boardCertification.certifyingBoard}</strong>
                  {profile.boardCertification.specialty ? <span style={{ color: '#64748B' }}> · {profile.boardCertification.specialty}</span> : null}
                  {profile.boardCertification.status ? <span style={{ color: '#166534', fontWeight: 700 }}> · {profile.boardCertification.status}</span> : null}
                </div>
              </Section>
            )}
            {profile.notes && <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>⚠️ {profile.notes}</div>}
          </div>

          {error && <div style={{ marginTop: 14, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={() => { setProfile(null); setFile(null) }} style={{ padding: '11px 18px', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Start over</button>
            <div style={{ flex: 1 }} />
            <button onClick={save} disabled={saving || !npi} style={{ padding: '12px 26px', background: !npi ? '#CBD5E1' : '#16A34A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: !npi ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : `Looks right — save to ${selectedName ? selectedName.split(' ').slice(-1)[0] + "'s" : ''} passport`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
