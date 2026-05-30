import React, { useEffect, useState } from 'react'
import { credentialAPI } from '../../api.js'

const CRED_SECTIONS = [
  { type: 'STATE_LICENSE', label: 'State Medical License', fields: ['licenseNumber', 'state', 'expirationDate'] },
  { type: 'DEA_CERTIFICATE', label: 'DEA Certificate', fields: ['deaNumber', 'expirationDate'] },
  { type: 'MA_CS_LICENSE', label: 'MA Controlled Substance License', fields: ['licenseNumber', 'expirationDate'] },
  { type: 'BOARD_CERTIFICATION', label: 'Board Certification', fields: ['boardName', 'certificationStatus', 'initialDate', 'expirationDate'] },
  { type: 'MALPRACTICE_INSURANCE', label: 'Malpractice Insurance', fields: ['carrierName', 'coverageStart', 'coverageEnd'] },
  { type: 'MALPRACTICE_HISTORY', label: 'Malpractice History', fields: ['hasClaims', 'details'] },
  { type: 'ACLS_CERTIFICATION', label: 'ACLS Certification', fields: ['expirationDate'] },
  { type: 'BLS_CERTIFICATION', label: 'BLS Certification', fields: ['expirationDate'] },
  { type: 'EDUCATION_HISTORY', label: 'Education History', fields: [] },
  { type: 'HOSPITAL_PRIVILEGES', label: 'Hospital Privilege History', fields: [] },
  { type: 'WORK_HISTORY', label: 'Work History', fields: [] },
  { type: 'NPDB_AUTHORIZATION', label: 'NPDB Authorization', fields: ['authorizationStatus', 'authorizedDate'] },
  { type: 'CV', label: 'Curriculum Vitae', fields: [] },
]

const STATUS_COLORS = { ACTIVE: '#10B981', EXPIRING_SOON: '#F59E0B', EXPIRED: '#EF4444', MISSING: '#94A3B8', PENDING: '#6366F1' }
const STATUS_LABELS = { ACTIVE: 'Active', EXPIRING_SOON: 'Expiring Soon', EXPIRED: 'Expired', MISSING: 'Missing', PENDING: 'Pending' }

function CredStatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#94A3B8'
  return (
    <span style={{ padding: '3px 10px', borderRadius: 999, background: `${color}18`, color, fontSize: 11, fontWeight: 700 }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function CredentialSection({ section, credential, entityApi, permission, onRefresh }) {
  const [showNote, setShowNote] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [viewingDoc, setViewingDoc] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  const cred = credential
  const status = cred ? cred.status : 'MISSING'
  const verification = cred?.verifications?.[0]
  const flags = cred?.flags?.filter(f => !f.resolvedAt) || []
  const notes = cred?.notes || []

  async function handleVerify() {
    try { await entityApi.verify(section.type); onRefresh() }
    catch (err) { setActionMsg(err.message) }
  }

  async function handleUnverify() {
    try { await entityApi.unverify(section.type); onRefresh() }
    catch (err) { setActionMsg(err.message) }
  }

  async function handleFlag() {
    const reason = window.prompt('Flag reason (optional):')
    if (reason === null) return
    try { await entityApi.flag(section.type, reason); onRefresh() }
    catch (err) { setActionMsg(err.message) }
  }

  async function handleAddNote(e) {
    e.preventDefault()
    if (!noteText.trim()) return
    try {
      await entityApi.addNote(noteText, cred?.id)
      setNoteText(''); setShowNote(false); onRefresh()
    } catch (err) { setActionMsg(err.message) }
  }

  async function handleViewDoc() {
    try {
      const { url } = await entityApi.getDocToken(section.type)
      setViewingDoc(url)
    } catch (err) { setActionMsg('Failed to load document: ' + err.message) }
  }

  async function handleUpload(file) {
    setUploading(true)
    try { await entityApi.uploadDocument(section.type, file); onRefresh() }
    catch (err) { setActionMsg(err.message) }
    setUploading(false)
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: `1px solid ${flags.length > 0 ? '#FCA5A5' : '#E2E8F0'}`, padding: '20px 24px', marginBottom: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: cred ? 14 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {flags.length > 0 && <span style={{ fontSize: 16 }}>🚩</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{section.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CredStatusBadge status={status} />
          {cred?.expirationDate && (
            <span style={{ fontSize: 12, color: '#64748B' }}>
              Exp: {new Date(cred.expirationDate).toLocaleDateString('en-US')}
            </span>
          )}
        </div>
      </div>

      {/* Credential data fields */}
      {cred?.data && Object.keys(cred.data).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginBottom: 14 }}>
          {Object.entries(cred.data).map(([k, v]) => v && (
            <div key={k}>
              <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}: </span>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {/* Document actions */}
        {cred?.documentName && (
          <>
            <button onClick={handleViewDoc} style={actionBtn('#6366F1')}>View Document</button>
            <a href="#" onClick={e => { e.preventDefault(); handleViewDoc() }} style={{ ...actionBtn('#374151'), textDecoration: 'none', display: 'inline-block' }}>Download</a>
          </>
        )}

        {/* Upload */}
        {permission === 'COORDINATOR' && (
          <label style={{ ...actionBtn('#0F172A'), cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : cred?.documentName ? 'Replace Doc' : 'Upload Document'}
            <input type="file" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
          </label>
        )}

        {/* Verify */}
        {permission === 'COORDINATOR' && cred && (
          verification ? (
            <button onClick={handleUnverify} style={actionBtn('#10B981')}>
              ✓ Verified by {verification.verifiedBy?.name} · {new Date(verification.verifiedAt).toLocaleDateString()}
            </button>
          ) : (
            <button onClick={handleVerify} style={actionBtn('#64748B')}>Mark Verified</button>
          )
        )}

        {/* Flag */}
        {permission === 'COORDINATOR' && cred && (
          flags.length > 0 ? (
            <button onClick={() => entityApi.resolveFlag(section.type, flags[0].id).then(onRefresh)} style={actionBtn('#EF4444')}>
              🚩 Flagged — Click to Resolve
            </button>
          ) : (
            <button onClick={handleFlag} style={actionBtn('#94A3B8')}>Flag for Follow-up</button>
          )
        )}

        {/* Add note */}
        {permission === 'COORDINATOR' && (
          <button onClick={() => setShowNote(v => !v)} style={actionBtn('#6366F1')}>
            {showNote ? 'Cancel' : '+ Note'}
          </button>
        )}
      </div>

      {/* Note form */}
      {showNote && (
        <form onSubmit={handleAddNote} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13 }}
            placeholder="Internal note (not visible to provider)…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            autoFocus
          />
          <button type="submit" style={{ padding: '8px 16px', background: '#6366F1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
        </form>
      )}

      {/* Existing notes */}
      {notes.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
          {notes.map(n => (
            <div key={n.id} style={{ fontSize: 12, color: '#374151', background: '#FFFBEB', padding: '6px 10px', borderRadius: 6, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: '#92400E' }}>{n.createdBy?.name}: </span>
              {n.noteText}
              <span style={{ color: '#D97706', marginLeft: 6 }}>{new Date(n.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {actionMsg && <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444' }}>{actionMsg}</div>}

      {/* Document modal */}
      {viewingDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontWeight: 700, color: '#0F172A' }}>{section.label}</span>
              <button onClick={() => setViewingDoc(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748B' }}>×</button>
            </div>
            <iframe src={viewingDoc} style={{ flex: 1, border: 'none', minHeight: 500 }} title="Document viewer" />
          </div>
        </div>
      )}
    </div>
  )
}

function actionBtn(color) {
  return {
    padding: '6px 12px',
    background: `${color}12`,
    border: `1px solid ${color}30`,
    borderRadius: 7,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  }
}

function ActivityLog({ providerId }) {
  const [log, setLog] = useState([])

  useEffect(() => {
    credentialAPI.getProviderActivity(providerId).then(setLog).catch(() => {})
  }, [providerId])

  const icons = { VIEW_DOCUMENT: '👁', DOWNLOAD: '⬇️', UPLOAD_DOCUMENT: '⬆️', VIEW_PROFILE: '👤', note: '📝', verification: '✅', access: '🔍' }

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px', marginTop: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginTop: 0, marginBottom: 20 }}>Activity Log</h3>
      {log.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No activity recorded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {log.slice(0, 30).map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 13, color: '#374151' }}>
              <span style={{ fontSize: 14 }}>{icons[item.type] || icons[item.action] || '📌'}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{item.by}</span>: {item.action}
                {item.credentialType && <span style={{ color: '#6366F1', marginLeft: 6 }}>[{item.credentialType.replace(/_/g, ' ')}]</span>}
                {item.note && <div style={{ color: '#64748B', fontSize: 12, marginTop: 2, fontStyle: 'italic' }}>{item.note}</div>}
              </div>
              <span style={{ color: '#94A3B8', fontSize: 11, flexShrink: 0 }}>{new Date(item.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CredentialProviderFile({ providerId, rosterId, permission, onBack }) {
  const [provider, setProvider] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminderType, setReminderType] = useState('')
  const [reminderMsg, setReminderMsg] = useState('')

  const isRoster = !providerId && !!rosterId

  // Unified API adapter — same interface regardless of linked/unlinked
  const entityApi = {
    upload: isRoster
      ? (type, file) => credentialAPI.uploadRosterDocument(rosterId, type, file)
      : (type, file) => credentialAPI.uploadDocument(providerId, type, file),
    uploadDocument: isRoster
      ? (type, file) => credentialAPI.uploadRosterDocument(rosterId, type, file)
      : (type, file) => credentialAPI.uploadDocument(providerId, type, file),
    getDocToken: isRoster
      ? (type) => credentialAPI.getRosterDocToken(rosterId, type)
      : (type) => credentialAPI.getDocToken(providerId, type),
    verify: isRoster
      ? (type, notes) => credentialAPI.verifyRosterCredential(rosterId, type, notes)
      : (type, notes) => credentialAPI.verifyCredential(providerId, type, notes),
    unverify: isRoster
      ? (type) => credentialAPI.unverifyRosterCredential(rosterId, type)
      : (type) => credentialAPI.unverifyCredential(providerId, type),
    flag: isRoster
      ? (type, notes) => credentialAPI.flagRosterCredential(rosterId, type, notes)
      : (type, notes) => credentialAPI.flagCredential(providerId, type, notes),
    resolveFlag: isRoster
      ? (type, flagId) => credentialAPI.resolveRosterFlag(rosterId, type, flagId)
      : (type, flagId) => credentialAPI.resolveFlag(providerId, type, flagId),
    addNote: isRoster
      ? (noteText, credentialId) => credentialAPI.addRosterNote(rosterId, noteText, credentialId)
      : (noteText, credentialId) => credentialAPI.addNote(providerId, noteText, credentialId),
  }

  const load = () => {
    setLoading(true)
    const fetch = isRoster
      ? credentialAPI.getRosterFile(rosterId)
      : credentialAPI.getProvider(providerId)
    fetch
      .then(setProvider)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [providerId, rosterId])

  async function handleSendReminder(e) {
    e.preventDefault()
    if (isRoster) {
      alert('This provider has no linked SNAP account. Add their email in the roster to send reminders.')
      return
    }
    try {
      await credentialAPI.sendReminder(providerId, reminderType, reminderMsg)
      setShowReminderModal(false)
      alert('Reminder sent successfully.')
    } catch (err) {
      alert('Failed to send reminder: ' + err.message)
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading provider file…</div>
  if (error) return <div style={{ padding: 48, color: '#EF4444' }}>{error}</div>
  if (!provider) return null

  const credMap = {}
  for (const c of (provider.credentials || [])) credMap[c.credentialType] = c

  const statusColor = { GREEN: '#10B981', YELLOW: '#F59E0B', RED: '#EF4444' }[provider.status] || '#94A3B8'

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6366F1', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
        ← Back to providers
      </button>

      {/* Provider header */}
      <div style={{ background: '#fff', borderRadius: 16, border: `2px solid ${statusColor}30`, padding: '28px 32px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
          {provider.photoUrl && (
            <img src={provider.photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                {provider.firstName} {provider.lastName}
              </h2>
              {provider.specialty && (
                <span style={{ padding: '3px 10px', borderRadius: 999, background: '#EEF2FF', color: '#6366F1', fontSize: 12, fontWeight: 700 }}>{provider.specialty}</span>
              )}
              <span style={{ padding: '3px 10px', borderRadius: 999, background: `${statusColor}18`, color: statusColor, fontSize: 12, fontWeight: 700 }}>
                {provider.status || 'No Credentials'}
              </span>
              {isRoster && (
                <span style={{ padding: '3px 10px', borderRadius: 999, background: '#FEF3C7', color: '#D97706', fontSize: 11, fontWeight: 700 }}>
                  No SNAP Account
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#64748B' }}>NPI: <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{provider.npiNumber || '—'}</strong></span>
              {provider.email && <span style={{ fontSize: 13, color: '#64748B' }}>Email: <strong style={{ color: '#0F172A' }}>{provider.email}</strong></span>}
              {provider.memberSince && <span style={{ fontSize: 13, color: '#64748B' }}>Member since: <strong style={{ color: '#0F172A' }}>{new Date(provider.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</strong></span>}
            </div>
            <div style={{ marginTop: 12, maxWidth: 200 }}>
              <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>CREDENTIAL COMPLETION</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 8, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${provider.passportCompletion || 0}%`, height: '100%', background: provider.passportCompletion === 100 ? '#10B981' : '#6366F1', borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{provider.passportCompletion || 0}%</span>
              </div>
            </div>
          </div>

          {permission === 'COORDINATOR' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              {!isRoster && (
                <button onClick={() => setShowReminderModal(true)} style={{ padding: '8px 14px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, color: '#6366F1', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Send Reminder
                </button>
              )}
              <a
                href={credentialAPI.exportProviders()}
                style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 8, color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}
              >
                Export File
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Credential sections */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>Credentials</h3>
      {CRED_SECTIONS.map(section => (
        <CredentialSection
          key={section.type}
          section={section}
          credential={credMap[section.type] || null}
          entityApi={entityApi}
          permission={permission}
          onRefresh={load}
        />
      ))}

      {permission === 'COORDINATOR' && !isRoster && <ActivityLog providerId={providerId} />}

      {showReminderModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Send Reminder</h3>
            <form onSubmit={handleSendReminder}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Credential</label>
                <select
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                  value={reminderType}
                  onChange={e => setReminderType(e.target.value)}
                  required
                >
                  <option value="">Select credential…</option>
                  {CRED_SECTIONS.map(s => <option key={s.type} value={s.type}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Message (optional)</label>
                <textarea
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, minHeight: 80, boxSizing: 'border-box', resize: 'vertical' }}
                  placeholder="Additional context for the provider…"
                  value={reminderMsg}
                  onChange={e => setReminderMsg(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" style={{ flex: 1, padding: '11px', background: '#6366F1', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Send Reminder</button>
                <button type="button" onClick={() => setShowReminderModal(false)} style={{ padding: '11px 20px', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
