import React, { useEffect, useState, useCallback, useRef } from 'react'
import { credentialAPI } from '../../api.js'

// Phase 3 (one source of truth): this file page is a ZERO-STORAGE viewer over
// the provider's credentialing passport. Reads come from the passport backend
// (grant-scoped, documents via short-lived signed URLs, every access audited
// there). Coordinator edits (expiry dates, document uploads) WRITE THROUGH to
// the passport — nothing credential-shaped is stored marketplace-side.

const CRED_META = {
  STATE_LICENSE: { label: 'State Medical License', docType: 'LICENSE' },
  STATE_CS_LICENSE: { label: 'State Controlled-Substance License', docType: 'OTHER' },
  DEA: { label: 'DEA Registration', docType: 'DEA' },
  BOARD_CERTIFICATION: { label: 'Board Certification', docType: 'OTHER' },
  MALPRACTICE_INSURANCE: { label: 'Malpractice Insurance', docType: 'MALPRACTICE_FACE_SHEET' },
  ACLS: { label: 'ACLS Certification', docType: 'OTHER' },
  BLS: { label: 'BLS Certification', docType: 'OTHER' },
}
const REQUIRED_TYPES = ['STATE_LICENSE', 'DEA', 'BOARD_CERTIFICATION', 'MALPRACTICE_INSURANCE', 'ACLS', 'BLS']

const STATUS_STYLE = {
  ACTIVE: { color: '#10B981', label: 'Active' },
  EXPIRED: { color: '#EF4444', label: 'Expired' },
  LAPSED: { color: '#EF4444', label: 'Lapsed' },
  REVOKED: { color: '#7F1D1D', label: 'Revoked' },
  PENDING: { color: '#F59E0B', label: 'Pending' },
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}
function isoDay(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : ''
}

// CME date-range CSV export — client-side from the already-loaded entries.
// Cells are quoted and leading formula chars neutralized (same sanitizer rule
// as the other exports).
function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function CmeExportRow({ entries, providerName }) {
  const year = new Date().getFullYear()
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  const inRange = entries
    .filter((e) => {
      const day = String(e.date || '').slice(0, 10)
      return day && day >= from && day <= to
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const rangeHours = inRange.reduce((s, e) => s + (e.hours || 0), 0)

  function download() {
    const lines = [
      ['SNAP Medical — CME Summary'],
      [`Provider: ${providerName || '—'}`],
      [`Date range: ${from} to ${to}`],
      [`Generated: ${new Date().toISOString().slice(0, 10)}`],
      [],
      ['Date', 'End Date', 'Activity', 'Topic', 'Accrediting Body', 'Hours'],
      ...inRange.map((e) => [
        String(e.date).slice(0, 10),
        e.endDate ? String(e.endDate).slice(0, 10) : '',
        e.title || e.activity || 'CME activity',
        e.topic || '',
        e.accreditationBody || '',
        e.hours,
      ]),
      [],
      ['', '', '', '', 'TOTAL HOURS', rangeHours],
    ]
    const csv = lines.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CME-Summary-${(providerName || 'provider').replace(/\s+/g, '-')}-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Export range:</span>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12 }} />
      <span style={{ fontSize: 12, color: '#94A3B8' }}>to</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12 }} />
      <button
        onClick={download}
        disabled={inRange.length === 0}
        style={{ padding: '5px 12px', border: 'none', borderRadius: 7, background: inRange.length ? '#2563EB' : '#CBD5E1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: inRange.length ? 'pointer' : 'default' }}
      >
        Download CSV ({inRange.length} · {rangeHours} hr)
      </button>
    </div>
  )
}

export default function CredentialProviderFile({ rosterId, npi, permission, onBack }) {
  const [passport, setPassport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // credential type being edited
  const [editDate, setEditDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingType, setUploadingType] = useState(null)
  const [cme, setCme] = useState(null)
  const fileInputRef = useRef(null)
  const pendingUploadRef = useRef(null) // { credentialType, docType }

  const isCoordinator = permission === 'COORDINATOR'

  const load = useCallback(() => {
    setLoading(true)
    credentialAPI.getPassport(npi)
      .then((p) => { setPassport(p); setError(null) })
      .catch((err) => setError(err.message || 'Failed to load passport'))
      .finally(() => setLoading(false))
  }, [npi])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!rosterId) return
    credentialAPI.getRosterCme(rosterId).then(setCme).catch(() => setCme(null))
  }, [rosterId])

  async function saveExpiry(type) {
    setSaving(true)
    try {
      await credentialAPI.updatePassportCredential(npi, type, { expirationDate: editDate || null })
      setEditing(null)
      load()
    } catch (err) {
      alert(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function startUpload(credentialType) {
    pendingUploadRef.current = { credentialType, docType: CRED_META[credentialType]?.docType || 'OTHER' }
    fileInputRef.current?.click()
  }

  async function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const pending = pendingUploadRef.current
    if (!file || !pending) return
    setUploadingType(pending.credentialType)
    try {
      await credentialAPI.uploadPassportDocument(npi, file, { type: pending.docType, credentialType: pending.credentialType })
      load()
    } catch (err) {
      alert(err.message || 'Upload failed')
    } finally {
      setUploadingType(null)
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading passport…</div>

  if (error) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>← Back to providers</button>
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 20, color: '#B91C1C', fontSize: 14 }}>{error}</div>
      </div>
    )
  }

  const creds = passport?.credentials || []
  const credByType = Object.fromEntries(creds.map((c) => [c.type, c]))
  const missing = passport?.completeness?.missingRequired || []
  // One row per required type (present or missing) + any extras present.
  const rowTypes = [...REQUIRED_TYPES, ...creds.map((c) => c.type).filter((t) => !REQUIRED_TYPES.includes(t))]

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000, margin: '0 auto' }}>
      <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileChosen} />
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>← Back to providers</button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>
          {passport.provider.firstName} {passport.provider.lastName}
        </h1>
        <span style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'monospace' }}>NPI {passport.provider.npi}</span>
      </div>
      <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>
        Live from the provider's credentialing passport · shared with you by the provider
      </p>

      {/* Completeness banner */}
      <div style={{ background: missing.length ? '#FFFBEB' : '#F0FDF4', border: `1px solid ${missing.length ? '#FDE68A' : '#BBF7D0'}`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13.5, color: missing.length ? '#92400E' : '#166534' }}>
        {missing.length
          ? <><strong>{missing.length} required item{missing.length > 1 ? 's' : ''} missing:</strong> {missing.map((t) => CRED_META[t]?.label || t).join(', ')}</>
          : <strong>All required credentials present.</strong>}
        {passport.completeness?.expiringSoon?.length > 0 && (
          <span> · {passport.completeness.expiringSoon.length} expiring within 90 days</span>
        )}
      </div>

      {/* Credentials table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <tr>
              {['Credential', 'Identifier', 'Expiration', 'Status', 'Documents', ''].map((h) => (
                <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowTypes.map((type, i) => {
              const c = credByType[type]
              const meta = CRED_META[type] || { label: type }
              const st = c ? (STATUS_STYLE[c.status] || STATUS_STYLE.PENDING) : null
              const isEditing = editing === type
              return (
                <tr key={type} style={{ borderTop: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                  <td style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 700, color: c ? '#0F172A' : '#94A3B8' }}>{meta.label}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{c?.identifier || '—'}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13 }}>
                    {isEditing ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12.5 }} />
                        <button onClick={() => saveExpiry(type)} disabled={saving} style={{ padding: '5px 10px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{saving ? '…' : 'Save'}</button>
                        <button onClick={() => setEditing(null)} style={{ padding: '5px 8px', background: 'none', border: 'none', color: '#64748B', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                      </span>
                    ) : (
                      <span style={{ color: c?.expirationDate ? '#374151' : '#CBD5E1' }}>
                        {fmtDate(c?.expirationDate)}
                        {isCoordinator && (
                          <button
                            onClick={() => { setEditing(type); setEditDate(isoDay(c?.expirationDate)) }}
                            title={c ? 'Correct the expiration date' : 'Record this credential (e.g. expiry from a face sheet)'}
                            style={{ marginLeft: 8, padding: '2px 9px', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#2563EB' }}
                          >✎ Edit</button>
                        )}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    {c ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: `${st.color}18`, color: st.color, fontSize: 12, fontWeight: 700 }}>{st.label}</span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>Missing</span>
                    )}
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 13 }}>
                    {(c?.documents || []).length === 0 ? (
                      <span style={{ color: '#CBD5E1' }}>—</span>
                    ) : (
                      c.documents.map((d) => (
                        <a key={d.id} href={d.downloadUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', color: d.downloadUrl ? '#2563EB' : '#94A3B8', fontSize: 12.5, textDecoration: 'none', marginBottom: 2 }}>
                          📄 {d.filename}
                        </a>
                      ))
                    )}
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isCoordinator && (
                      <button
                        onClick={() => startUpload(type)}
                        disabled={uploadingType === type}
                        style={{ padding: '6px 12px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                      >
                        {uploadingType === type ? 'Uploading…' : '⬆ Upload doc'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Profile — contact, education/training, work history, affiliations,
          documents. Populated by the CV Reader; read live from the passport. */}
      {(() => {
        const p = passport.provider || {}
        const S = passport.sections || {}
        const docs = passport.profileDocuments || []
        const LEVEL = { COLLEGE: 'College / Nursing', MED_SCHOOL: 'Medical / CRNA School', RESIDENCY: 'Residency', FELLOWSHIP: 'Fellowship' }
        const card = { background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: 24 }
        const head = { fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }
        const row = (label, val) => (
          <div style={{ display: 'flex', gap: 12, padding: '3px 0' }}>
            <div style={{ width: 90, flexShrink: 0, fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 13.5, color: val ? '#0F172A' : '#CBD5E1' }}>{val || '—'}</div>
          </div>
        )
        const addr = [p.addressStreet, p.addressCity, p.addressState, p.addressZip].filter(Boolean).join(', ')
        return (
          <>
            <div style={card}>
              <div style={head}>👤 Contact & Demographics</div>
              {row('Name', [p.firstName, p.middleName, p.lastName, p.suffix].filter(Boolean).join(' ') || null)}
              {p.formerNames && row('Former', p.formerNames)}
              {row('Specialty', p.specialty)}
              {row('Email', p.email)}
              {row('Phone', p.phone)}
              {row('Address', addr)}
              {row('DOB', p.dateOfBirth)}
            </div>

            {(S.education?.length > 0) && (
              <div style={card}>
                <div style={head}>🎓 Education & Training</div>
                {S.education.map((e, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '4px 0', borderTop: i ? '1px solid #F1F5F9' : 'none' }}>
                    <strong>{LEVEL[e.level] || e.level}</strong>{e.institution ? ` — ${e.institution}` : ''}
                    {e.graduationDate ? <span style={{ color: '#94A3B8' }}> · {e.graduationDate}</span> : null}
                  </div>
                ))}
              </div>
            )}

            {(S.workHistory?.length > 0) && (
              <div style={card}>
                <div style={head}>💼 Work History</div>
                {S.workHistory.map((w, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '4px 0', borderTop: i ? '1px solid #F1F5F9' : 'none' }}>
                    <strong>{w.role || 'Position'}</strong>{w.employer ? ` — ${w.employer}` : ''}
                    <span style={{ color: '#94A3B8' }}> · {w.startDate || '?'} – {w.currentlyEmployed ? 'present' : (w.endDate || '?')}</span>
                  </div>
                ))}
              </div>
            )}

            {(S.hospitalPrivileges?.length > 0) && (
              <div style={card}>
                <div style={head}>🏥 Hospital Affiliations</div>
                {S.hospitalPrivileges.map((h, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: '#0F172A', padding: '4px 0', borderTop: i ? '1px solid #F1F5F9' : 'none' }}>
                    <strong>{h.hospitalName}</strong>
                    <span style={{ color: '#94A3B8' }}> · {h.startDate || '?'} – {h.currentlyActive ? 'present' : (h.endDate || '?')}</span>
                  </div>
                ))}
              </div>
            )}

            {(docs.length > 0) && (
              <div style={card}>
                <div style={head}>📎 Documents</div>
                {docs.map((d) => (
                  <a key={d.id} href={d.downloadUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 13, color: d.downloadUrl ? '#2563EB' : '#94A3B8', textDecoration: 'none', padding: '4px 0' }}>
                    📄 {d.filename} {d.type ? <span style={{ color: '#94A3B8', fontSize: 11.5 }}>· {d.type}</span> : null}
                  </a>
                ))}
              </div>
            )}
          </>
        )
      })()}

      {/* Signed documents (e-sign) */}
      {passport.signatures?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '16px 20px', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>✍️ Signed documents</div>
          {passport.signatures.map((s) => (
            <div key={s.id} style={{ fontSize: 13, color: '#374151', padding: '6px 0', borderTop: '1px solid #F1F5F9' }}>
              {s.documentName} <span style={{ color: '#94A3B8', fontSize: 12 }}>· signed {fmtDate(s.signedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {/* CME */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>🎓 CME credits</div>
        {!cme || !cme.found || (cme.entries || []).length === 0 ? (
          <div style={{ fontSize: 13, color: '#94A3B8' }}>
            {!cme ? 'Couldn’t load CME history — try refreshing.'
              : cme.bridgeUnconfigured ? 'CME service isn’t connected on this server.'
              : cme.reason === 'NO_ROSTER_NPI' ? 'This roster entry has no NPI — add one in Roster Settings to link CME.'
              : !cme.found ? 'No SNAP passport matches this provider’s NPI yet.'
              : 'No CME records yet — the provider logs credits in the SNAP app.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}><strong>{cme.totalHours}</strong> total hours</div>
            {(cme.entries || []).slice(0, 10).map((e2, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#64748B', padding: '4px 0', borderTop: '1px solid #F1F5F9' }}>
                {e2.title || e2.activity || 'CME activity'} — {e2.hours} hr{e2.hours === 1 ? '' : 's'} {e2.date ? `· ${fmtDate(e2.date)}` : ''}
              </div>
            ))}
            <CmeExportRow entries={cme.entries || []} providerName={`${passport?.provider?.firstName || ''} ${passport?.provider?.lastName || ''}`.trim()} />
          </>
        )}
      </div>
    </div>
  )
}
