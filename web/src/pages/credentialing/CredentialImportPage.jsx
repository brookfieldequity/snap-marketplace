import React, { useEffect, useState, useCallback, useRef } from 'react'
import { credentialAPI } from '../../api.js'

// Smart Document Intake — "ease of switch." Drop your existing credentialing
// files (PDFs, scans, or whole ZIP folders); AI reads each one, suggests what
// it is / whose it is / when it expires; you verify and commit. Committed
// items land on each provider's passport; documents for providers who haven't
// claimed a passport yet are held (encrypted) and attach automatically when
// they join.

const DOC_TYPES = ['LICENSE', 'DEA', 'MALPRACTICE_FACE_SHEET', 'CV', 'OTHER']
const CRED_TYPES = ['STATE_LICENSE', 'STATE_CS_LICENSE', 'DEA', 'BOARD_CERTIFICATION', 'MALPRACTICE_INSURANCE', 'ACLS', 'BLS']
const CONF_COLOR = { HIGH: '#10B981', MEDIUM: '#F59E0B', LOW: '#EF4444' }

function isoDay(d) { return d ? String(d).slice(0, 10) : '' }

export default function CredentialImportPage() {
  const [batches, setBatches] = useState([])
  const [batch, setBatch] = useState(null) // open batch detail
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [committing, setCommitting] = useState(false)
  const fileRef = useRef(null)
  const pollRef = useRef(null)

  const loadList = useCallback(() => {
    credentialAPI.listIntake().then((d) => setBatches(d.batches || [])).catch(() => setBatches([]))
  }, [])
  useEffect(() => { loadList() }, [loadList])

  const openBatch = useCallback((id) => {
    credentialAPI.getIntake(id).then(setBatch).catch((e) => setNotice(e.message))
  }, [])

  // Poll while the open batch is still processing.
  useEffect(() => {
    clearInterval(pollRef.current)
    if (batch && batch.status === 'PROCESSING') {
      pollRef.current = setInterval(() => openBatch(batch.id), 4000)
    }
    return () => clearInterval(pollRef.current)
  }, [batch?.id, batch?.status, openBatch])

  async function handleFiles(files) {
    if (!files?.length) return
    setUploading(true)
    setNotice(null)
    try {
      const r = await credentialAPI.createIntake([...files])
      setNotice(`Uploaded — reading ${r.itemCount} document${r.itemCount === 1 ? '' : 's'}…`)
      loadList()
      openBatch(r.batchId)
    } catch (e) {
      setNotice(`Upload failed: ${e.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveItem(item, fields) {
    try {
      const updated = await credentialAPI.updateIntakeItem(item.id, fields)
      setBatch((b) => ({ ...b, items: b.items.map((i) => (i.id === item.id ? { ...i, ...updated } : i)) }))
    } catch (e) {
      setNotice(`Save failed: ${e.message}`)
    }
  }

  async function handleCommit() {
    setCommitting(true)
    try {
      const r = await credentialAPI.commitIntake(batch.id)
      setNotice(`Done: ${r.committed} filed to passports, ${r.archived || 0} filed to archive, ${r.staged} held for providers who haven't joined yet (they'll attach automatically).`)
      openBatch(batch.id)
      loadList()
    } catch (e) {
      setNotice(`Commit failed: ${e.message}`)
    } finally {
      setCommitting(false)
    }
  }

  // Confirmed items file to passports; archive-marked items file to the
  // retained (facility-invisible) archive — both go in one commit.
  const confirmed = batch?.items?.filter((i) => ['CONFIRMED', 'ARCHIVE'].includes(i.status)).length || 0
  const pending = batch?.items?.filter((i) => ['PENDING'].includes(i.status)).length || 0

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '0 0 4px' }}>Import Documents</h1>
      <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 20px' }}>
        Bring your existing credentialing files with you — drop PDFs, scans, or a ZIP of your current folders.
        SNAP reads each document and suggests where it goes; you verify before anything is filed.
      </p>

      {notice && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1E40AF', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{ border: '2px dashed #94A3B8', borderRadius: 16, padding: '36px 20px', textAlign: 'center', background: '#fff', cursor: 'pointer', marginBottom: 24 }}
      >
        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.zip" style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
        <div style={{ fontSize: 34, marginBottom: 6 }}>📥</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
          {uploading ? 'Uploading…' : 'Drop credentialing files here, or click to choose'}
        </div>
        <div style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 4 }}>PDF, JPG, PNG, or a ZIP of folders · encrypted the moment they arrive</div>
      </div>

      {/* Batch list */}
      {!batch && batches.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>Previous imports</div>
          {batches.map((b) => (
            <div key={b.id} onClick={() => openBatch(b.id)} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 18px', borderTop: '1px solid #F1F5F9', cursor: 'pointer', fontSize: 13.5 }}>
              <span style={{ color: '#0F172A', fontWeight: 600 }}>{new Date(b.createdAt).toLocaleString('en-US')}</span>
              <span style={{ color: '#64748B' }}>
                {Object.entries(b.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')} — {b.status.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Review queue */}
      {batch && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <button onClick={() => { setBatch(null); loadList() }} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← All imports</button>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {batch.status === 'PROCESSING' && <span style={{ fontSize: 13, color: '#F59E0B', fontWeight: 700 }}>Reading documents… {pending} to go</span>}
              <button
                onClick={handleCommit}
                disabled={committing || confirmed === 0}
                style={{ padding: '9px 18px', background: confirmed ? '#2563EB' : '#CBD5E1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: confirmed ? 'pointer' : 'default' }}
              >
                {committing ? 'Filing…' : `File ${confirmed} item${confirmed === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {batch.items.map((item) => <IntakeCard key={item.id} item={item} onSave={saveItem} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function IntakeCard({ item, onSave }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({})
  // Filed states are read-only; REJECTED is read-only but restorable (a
  // mis-click must not be a dead end).
  const done = ['COMMITTED', 'STAGED', 'ARCHIVED', 'REJECTED'].includes(item.status)
  const restorable = item.status === 'REJECTED'
  const conf = CONF_COLOR[item.confidence] || '#94A3B8'

  const field = (k, fallback = '') => (f[k] !== undefined ? f[k] : item[k] ?? fallback)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  const statusChip = {
    PENDING: ['#94A3B8', 'Reading…'], ANALYZED: [conf, `${item.confidence || ''} confidence`],
    FAILED: ['#EF4444', 'Could not read'], CONFIRMED: ['#2563EB', 'Confirmed — ready to file'],
    COMMITTED: ['#10B981', 'Filed to passport'], STAGED: ['#8B5CF6', 'Held — attaches when provider joins'],
    REJECTED: ['#64748B', 'Rejected'],
    ARCHIVE: ['#0EA5E9', 'Marked for archive'], ARCHIVED: ['#0EA5E9', 'Filed to archive'],
  }[item.status] || ['#94A3B8', item.status]

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}>
          <a href={item.previewUrl || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 700, color: item.previewUrl ? '#2563EB' : '#0F172A', textDecoration: 'none' }}>
            📄 {item.filename}
          </a>
          {item.sourcePath && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{item.sourcePath}</div>}
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 999, background: `${statusChip[0]}18`, color: statusChip[0], fontSize: 12, fontWeight: 700 }}>{statusChip[1]}</span>
      </div>

      {item.status !== 'PENDING' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
          <Labeled label="Document type">
            <select disabled={done} value={field('suggestedDocType', 'OTHER')} onChange={set('suggestedDocType')} style={sel}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </Labeled>
          <Labeled label="Credential">
            <select disabled={done} value={field('suggestedCredentialType', '')} onChange={set('suggestedCredentialType')} style={sel}>
              <option value="">— none —</option>{CRED_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Labeled>
          <Labeled label="Provider">
            <input disabled={done} value={field('suggestedProviderName')} onChange={set('suggestedProviderName')} style={{ ...sel, width: 150 }} placeholder="Name" />
          </Labeled>
          <Labeled label="NPI">
            <input disabled={done} value={field('suggestedNpi')} onChange={set('suggestedNpi')} style={{ ...sel, width: 110, fontFamily: 'monospace' }} placeholder="10 digits" />
          </Labeled>
          <Labeled label="Number">
            <input disabled={done} value={field('suggestedIdentifier')} onChange={set('suggestedIdentifier')} style={{ ...sel, width: 110 }} />
          </Labeled>
          <Labeled label="Expires">
            <input disabled={done} type="date" value={isoDay(field('suggestedExpiration'))} onChange={set('suggestedExpiration')} style={sel} />
          </Labeled>
          {!done && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => onSave(item, { ...f, status: 'CONFIRMED' })}
                style={{ padding: '8px 14px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
              >✓ Confirm</button>
              <button
                title="Keep on file as a historical record — retained and auditable, never shown to facilities and never affects expiry tracking. For old expired licenses and superseded documents."
                onClick={() => onSave(item, { ...f, status: 'ARCHIVE' })}
                style={{ padding: '8px 12px', background: '#E0F2FE', color: '#0369A1', border: '1px solid #BAE6FD', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >🗄 Archive</button>
              <button
                onClick={() => onSave(item, { status: 'REJECTED' })}
                style={{ padding: '8px 12px', background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >Reject</button>
            </div>
          )}
          {restorable && (
            <button
              onClick={() => onSave(item, { status: 'ANALYZED' })}
              style={{ padding: '8px 12px', background: '#fff', color: '#2563EB', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >↩ Restore</button>
          )}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8' }}>
        {item.matchedProfileId
          ? '✅ Matched to an existing passport'
          : item.stagedForNpi
            ? `🕓 No passport yet for NPI ${item.stagedForNpi} — will attach when they join`
            : item.status !== 'PENDING' ? '⚠️ No provider match — set the NPI above' : null}
        {item.aiNotes && <span> · {item.aiNotes}</span>}
      </div>
    </div>
  )
}

const sel = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12.5, background: '#fff', color: '#0F172A' }

function Labeled({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  )
}
