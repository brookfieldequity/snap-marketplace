import React, { useEffect, useMemo, useRef, useState } from 'react'
import { credMapAPI, credentialAPI } from '../../api.js'

// Facility Applications — set up a facility's application template once; every
// provider's packet populates from the passport. Hub (template cards +
// sticky-note reminders) plus the builder (AI-proposed items → review →
// confirm). Sticky notes and drag-and-drop reuse the Shifts request-board
// design language (Kalam font).

const FULFILLMENT = {
  AUTO_PASSPORT: { label: 'Auto from Passport', icon: '⚡', bg: '#DCFCE7', fg: '#166534' },
  DOCUMENT: { label: 'Document', icon: '📄', bg: '#DBEAFE', fg: '#1E40AF' },
  SIGNATURE: { label: 'Signature', icon: '✍️', bg: '#EDE9FE', fg: '#5B21B6' },
  MANUAL: { label: 'Manual', icon: '🛠️', bg: '#FEF3C7', fg: '#92400E' },
}

const OUTPUT_MODES = [
  { key: 'PDF_PACKET', label: 'Fillable PDF packet' },
  { key: 'DOC_BUNDLE', label: 'Email / document bundle' },
  { key: 'PORTAL_EXPORT', label: 'Software portal export' },
]

const CONFIDENCE_DOT = { HIGH: '#22C55E', MEDIUM: '#F59E0B', LOW: '#EF4444' }

const TASK_STATUS = {
  AUTO_FILLED: { label: 'Auto-filled', icon: '⚡', bg: '#DCFCE7', fg: '#166534' },
  DONE: { label: 'Done', icon: '✓', bg: '#DCFCE7', fg: '#166534' },
  WAIVED: { label: 'Waived', icon: '—', bg: '#F1F5F9', fg: '#94A3B8' },
  NEEDS_DOCUMENT: { label: 'Needs document', icon: '📄', bg: '#DBEAFE', fg: '#1E40AF' },
  NEEDS_SIGNATURE: { label: 'Needs signature', icon: '✍️', bg: '#EDE9FE', fg: '#5B21B6' },
  NEEDS_ACTION: { label: 'Needs action', icon: '🛠️', bg: '#FEF3C7', fg: '#92400E' },
}

const PACKET_STATUS = {
  IN_PROGRESS: { label: 'In progress', bg: '#FEF3C7', fg: '#92400E' },
  READY: { label: 'Ready', bg: '#DCFCE7', fg: '#166534' },
  SENT: { label: 'Sent', bg: '#DBEAFE', fg: '#1E40AF' },
}

function fmtShortDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`
}

// Marketplace CredentialType (on map items) → passport-plane credential type.
// Mirror of the backend PASSPORT_TYPE map in routes/credmap.js.
const PASSPORT_TYPE_UI = {
  STATE_LICENSE: 'STATE_LICENSE',
  MA_CS_LICENSE: 'STATE_CS_LICENSE',
  DEA_CERTIFICATE: 'DEA',
  BOARD_CERTIFICATION: 'BOARD_CERTIFICATION',
  MALPRACTICE_INSURANCE: 'MALPRACTICE_INSURANCE',
  ACLS_CERTIFICATION: 'ACLS',
  BLS_CERTIFICATION: 'BLS',
}

// ── Packet preview — the rendered document the coordinator can trust ─────────
// A paper-style view of the packet AS IT STANDS: every requirement with the
// actual passport values (identifier, expiry, documents) or a clearly-marked
// pending slot. Printable (interim export until the Anvil-filled PDF lands).

function PacketPreview({ packet, passportDetail, onBack }) {
  useEffect(() => {
    if (!document.getElementById('snap-packet-print')) {
      const style = document.createElement('style')
      style.id = 'snap-packet-print'
      style.textContent = `@media print {
        body * { visibility: hidden !important; }
        #packet-preview, #packet-preview * { visibility: visible !important; }
        #packet-preview { position: absolute !important; top: 0; left: 0; width: 100%; box-shadow: none !important; margin: 0 !important; }
        .no-print { display: none !important; }
      }`
      document.head.appendChild(style)
    }
  }, [])

  const detailByType = useMemo(() => {
    const m = {}
    for (const c of passportDetail?.credentials || []) m[c.type] = c
    return m
  }, [passportDetail])

  const groups = []
  for (const t of packet.tasks) {
    const section = t.item.section || 'General'
    const last = groups[groups.length - 1]
    if (last && last.section === section) last.tasks.push(t)
    else groups.push({ section, tasks: [t] })
  }

  const completeCount = packet.tasks.filter((t) => ['AUTO_FILLED', 'DONE', 'WAIVED'].includes(t.status)).length

  // Real profile substance for data-plane sections — the coordinator reads
  // actual entries, not a checkmark. Returns null when we have no renderer
  // (or no data) for the canonical type, falling back to the generic line.
  const S = passportDetail?.sections
  const prov = passportDetail?.provider
  const rowStyle = { fontSize: 12.5, color: '#0F172A', padding: '2px 0' }
  const subStyle = { color: '#64748B' }
  // Provenance is stated ONCE in the footer (blanket "unless otherwise
  // noted" rule) — per-item stamps read as noise on a real packet.
  const passportTag = null
  const emptyNote = (what) => (
    <div style={{ fontSize: 12.5, color: '#92400E' }}>Nothing recorded on the passport for {what} yet — worth a check before sending.</div>
  )

  function sectionContent(canonicalType) {
    if (!S) return null
    switch (canonicalType) {
      case 'APPLICATION_FORM': {
        if (!prov) return null
        return (
          <div>
            <div style={rowStyle}><strong>{prov.firstName} {prov.lastName}</strong>{prov.specialty ? <span style={subStyle}> · {prov.specialty}</span> : null}</div>
            <div style={rowStyle}><span style={subStyle}>NPI</span> <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{prov.npi}</span>
              {prov.dateOfBirth ? <span style={subStyle}> · DOB {prov.dateOfBirth}</span> : null}
              {prov.licenseState ? <span style={subStyle}> · Licensed in {prov.licenseState}</span> : null}</div>
            {passportTag}
          </div>
        )
      }
      case 'WORK_HISTORY_CV': {
        const rows = S.workHistory || []
        if (rows.length === 0) return emptyNote('work history')
        return (
          <div>
            {rows.map((w, i) => (
              <div key={i} style={rowStyle}>
                <strong>{w.role || 'Position'}</strong> — {w.employer || 'Employer'}
                <span style={subStyle}> · {w.startDate || '?'} – {w.currentlyEmployed ? 'present' : (w.endDate || '?')}</span>
              </div>
            ))}
            {passportTag}
          </div>
        )
      }
      case 'EDUCATION_TRAINING': {
        const rows = S.education || []
        if (rows.length === 0) return emptyNote('education & training')
        const levelLabel = { HIGH_SCHOOL: 'High school', COLLEGE: 'College', MED_SCHOOL: 'Medical school', RESIDENCY: 'Residency', FELLOWSHIP: 'Fellowship' }
        return (
          <div>
            {rows.map((e, i) => (
              <div key={i} style={rowStyle}>
                <strong>{levelLabel[e.level] || e.level}</strong>{e.institution ? ` — ${e.institution}` : ''}
                {e.graduationDate ? <span style={subStyle}> · {e.graduationDate}</span> : null}
              </div>
            ))}
            {passportTag}
          </div>
        )
      }
      case 'HOSPITAL_PRIVILEGES': {
        const rows = S.hospitalPrivileges || []
        if (rows.length === 0) return emptyNote('hospital privileges')
        return (
          <div>
            {rows.map((h, i) => {
              const flags = [h.denied && 'DENIED', h.suspended && 'SUSPENDED', h.revoked && 'REVOKED'].filter(Boolean)
              return (
                <div key={i} style={rowStyle}>
                  <strong>{h.hospitalName || 'Hospital'}</strong>
                  <span style={subStyle}> · {h.startDate || '?'} – {h.currentlyActive ? 'present' : (h.endDate || '?')}</span>
                  {flags.length > 0 && <span style={{ color: '#DC2626', fontWeight: 800 }}> · {flags.join(', ')}</span>}
                </div>
              )
            })}
            {passportTag}
          </div>
        )
      }
      case 'MALPRACTICE_HISTORY': {
        const m = S.malpractice || {}
        if (m.hasHistory === false) {
          return <div><div style={rowStyle}>No malpractice history reported <span style={subStyle}>· attested by provider</span></div>{passportTag}</div>
        }
        const rows = m.incidents || []
        if (rows.length === 0) return emptyNote('malpractice history')
        return (
          <div>
            {rows.map((inc, i) => (
              <div key={i} style={rowStyle}>
                <strong>{inc.type}</strong>{inc.year ? <span style={subStyle}> · {inc.year}</span> : null}
                {inc.amount ? <span style={subStyle}> · {inc.amount}</span> : null}
                {inc.resolved ? <span style={{ color: '#16A34A', fontWeight: 700 }}> · resolved</span> : null}
                {inc.description ? <div style={{ fontSize: 11.5, color: '#64748B' }}>{inc.description}</div> : null}
              </div>
            ))}
            {passportTag}
          </div>
        )
      }
      case 'NPDB_QUERY': {
        if (S.npdbAuthorized) {
          return <div><div style={rowStyle}>NPDB self-query authorization on file ✓</div>{passportTag}</div>
        }
        return emptyNote('NPDB authorization')
      }
      case 'MALPRACTICE_INSURANCE': {
        // Credential row renders the cert; add the carrier when we know it.
        return S.malpractice?.carrier
          ? <div><div style={rowStyle}><strong>{S.malpractice.carrier}</strong> <span style={subStyle}>· current certificate on passport</span></div>{passportTag}</div>
          : null
      }
      default:
        return null
    }
  }

  function valueBlock(t) {
    const cred = t.item.credentialType ? detailByType[PASSPORT_TYPE_UI[t.item.credentialType]] : null
    if (t.status === 'AUTO_FILLED' && cred) {
      return (
        <div>
          <div style={{ fontSize: 13.5, color: '#0F172A' }}>
            {cred.identifier && <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{cred.identifier}</span>}
            {cred.identifier && (cred.expirationDate || cred.status) && <span style={{ color: '#94A3B8' }}> · </span>}
            {cred.expirationDate && <span>expires {fmtShortDate(cred.expirationDate)}</span>}
            {cred.status && <span style={{ color: '#94A3B8' }}> · {cred.status}</span>}
          </div>
          {(cred.documents || []).map((d) => (
            <a key={d.id} className="no-print" href={d.downloadUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', color: '#2563EB', fontSize: 12, textDecoration: 'none', marginRight: 12, marginTop: 2 }}>
              📄 {d.filename}
            </a>
          ))}
        </div>
      )
    }
    if (t.status === 'AUTO_FILLED') {
      const rendered = sectionContent(t.item.canonicalType)
      if (rendered) return rendered
      return <div style={{ fontSize: 12.5, color: '#166534' }}>Included from the provider's passport profile <span style={{ fontSize: 10.5, fontWeight: 700 }}>⚡</span></div>
    }
    if (t.status === 'DONE') {
      return <div style={{ fontSize: 12.5, color: '#166534' }}>✓ Provided by coordinator{t.note ? ` — ${t.note}` : ''}</div>
    }
    if (t.status === 'WAIVED') {
      return <div style={{ fontSize: 12.5, color: '#94A3B8', textDecoration: 'line-through' }}>Waived{t.note ? ` — ${t.note}` : ''}</div>
    }
    const st = TASK_STATUS[t.status] || TASK_STATUS.NEEDS_ACTION
    return (
      <div style={{ border: '1.5px dashed #FCD34D', background: '#FFFBEB', borderRadius: 6, padding: '6px 10px', fontSize: 12.5, color: '#92400E' }}>
        {st.icon} Awaiting — {st.label.toLowerCase()} · {t.assignee === 'PROVIDER' ? 'with the provider' : 'with the coordinator'}
        {t.item.fulfillment === 'SIGNATURE' && !t.item.esignOk ? ' · wet ink required' : ''}
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>← Back to workspace</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={{ padding: '9px 16px', background: '#0F172A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
          🖨 Print / Save PDF
        </button>
      </div>

      {/* The paper */}
      <div id="packet-preview" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, boxShadow: '0 10px 40px rgba(15,23,42,0.08)', padding: '44px 52px' }}>
        {/* Letterhead */}
        <div style={{ borderBottom: '3px solid #0F172A', paddingBottom: 16, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A' }}>{packet.map?.name}</div>
              <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
                Credentialing {packet.cycle === 'RENEWAL' ? 'Reappointment' : 'Initial Appointment'} Packet
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{packet.providerName || `NPI ${packet.npi}`}</div>
              <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'monospace' }}>NPI {packet.npi}</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#94A3B8', marginBottom: 24 }}>
          <span>Prepared with SNAP Credentialing · {fmtShortDate(new Date())}</span>
          <span>{completeCount} of {packet.tasks.length} items complete</span>
        </div>

        {groups.map((g) => (
          <div key={g.section + g.tasks[0].id} style={{ marginBottom: 22, breakInside: 'avoid' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid #E2E8F0', paddingBottom: 5, marginBottom: 10 }}>
              {g.section}
            </div>
            {g.tasks.map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 18, padding: '7px 0', alignItems: 'flex-start' }}>
                <div style={{ width: 250, flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {t.item.label}
                  {!t.item.required && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#94A3B8' }}>OPTIONAL</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>{valueBlock(t)}</div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid #E2E8F0', fontSize: 10.5, color: '#94A3B8' }}>
          Unless otherwise noted, all information and documents in this packet were populated directly from the provider's verified SNAP Passport, read live at the time of generation. Coordinator-provided, waived, and pending items are noted individually above.
        </div>
      </div>
    </div>
  )
}

const NOTE_COLORS = ['#FEF08A', '#FBCFE8', '#BAE6FD', '#BBF7D0', '#FED7AA']

function useKalamFont() {
  useEffect(() => {
    if (!document.getElementById('snap-kalam-font')) {
      const link = document.createElement('link')
      link.id = 'snap-kalam-font'
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap'
      document.head.appendChild(link)
    }
    if (!document.getElementById('snap-postit-kf')) {
      const style = document.createElement('style')
      style.id = 'snap-postit-kf'
      style.textContent = `@keyframes postitDeal{0%{transform:translateY(10px) rotate(0deg);opacity:0}100%{opacity:1}}`
      document.head.appendChild(style)
    }
  }, [])
}

function StatusPill({ status }) {
  const meta = {
    DRAFT: { label: 'Draft', bg: '#F1F5F9', fg: '#475569' },
    CONFIRMED: { label: 'Confirmed', bg: '#DCFCE7', fg: '#166534' },
    ARCHIVED: { label: 'Archived', bg: '#F1F5F9', fg: '#94A3B8' },
  }[status] || { label: status, bg: '#F1F5F9', fg: '#475569' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  )
}

function AutoFillBar({ stats }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>
          ⚡ {stats.autoCount} of {stats.itemCount} items auto-fill from the SNAP Passport
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#166534' }}>{stats.autoPct}%</span>
      </div>
      <div style={{ height: 8, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${stats.autoPct}%`, height: '100%', background: 'linear-gradient(90deg, #22C55E, #16A34A)', borderRadius: 999, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// ── Sticky notes ─────────────────────────────────────────────────────────────

function StickyNotesStrip({ notes, onAdd, onDone, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [color, setColor] = useState(NOTE_COLORS[0])

  async function submit() {
    if (!text.trim()) return
    await onAdd(text.trim(), color)
    setText('')
    setAdding(false)
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>📌 Reminders</span>
        <button
          onClick={() => setAdding((v) => !v)}
          style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {adding ? 'Cancel' : '+ Add note'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {adding && (
          <div style={{ width: 170, background: color, borderRadius: 4, padding: '10px 12px', boxShadow: '0 4px 10px rgba(0,0,0,0.12)' }}>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="Write a reminder…"
              rows={3}
              style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', fontFamily: "'Kalam', cursive", fontSize: 14, color: '#374151', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {NOTE_COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: color === c ? '2px solid #334155' : '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
              <button onClick={submit} style={{ fontSize: 11, fontWeight: 800, background: '#0F172A', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>Stick it</button>
            </div>
          </div>
        )}
        {notes.map((n, i) => (
          <div
            key={n.id}
            style={{
              width: 170, background: n.color || '#FEF08A', borderRadius: 4, padding: '10px 12px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
              transform: `rotate(${(i % 3) - 1}deg)`,
              animation: 'postitDeal 0.3s ease both',
            }}
          >
            <div style={{ fontFamily: "'Kalam', cursive", fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button title="Done" onClick={() => onDone(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, color: '#16A34A', fontWeight: 800 }}>✓</button>
              <button title="Delete" onClick={() => onDelete(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, color: '#94A3B8', fontWeight: 800 }}>×</button>
            </div>
          </div>
        ))}
        {!adding && notes.length === 0 && (
          <span style={{ fontSize: 12, color: '#94A3B8' }}>No reminders — stick one up.</span>
        )}
      </div>
    </div>
  )
}

// ── New map modal ────────────────────────────────────────────────────────────

function NewMapModal({ aiAvailable, onClose, onAnalyze, onCreate }) {
  const [mode, setMode] = useState(aiAvailable ? 'upload' : 'scratch')
  const [files, setFiles] = useState([])
  const [name, setName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function pickFiles(list) {
    const arr = Array.from(list || []).filter((f) =>
      ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)
    ).slice(0, 5)
    if (arr.length) setFiles(arr)
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      if (mode === 'upload') {
        if (files.length === 0) { setError('Drop the facility\'s blank application first.'); setBusy(false); return }
        await onAnalyze(files, name.trim() || undefined)
      } else {
        if (!name.trim()) { setError('Give the template a name (usually the facility).'); setBusy(false); return }
        await onCreate(name.trim(), true)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setBusy(false)
    }
  }

  const tabBtn = (key, label) => (
    <button
      onClick={() => setMode(key)}
      style={{
        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: mode === key ? '#EFF6FF' : '#fff', color: mode === key ? '#2563EB' : '#64748B',
        border: 'none', borderBottom: `2px solid ${mode === key ? '#2563EB' : '#E2E8F0'}`,
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={busy ? undefined : onClose}>
      <div style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>New Facility Application Template</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16 }}>
            Set up this facility's application once — every provider's packet populates from the passport.
          </div>
        </div>
        <div style={{ display: 'flex' }}>
          {tabBtn('upload', '✨ Upload their application')}
          {tabBtn('scratch', '📋 Standard checklist')}
        </div>
        <div style={{ padding: 24 }}>
          {busy ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: 34 }}>🔍</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>
                {mode === 'upload' ? 'Reading the application…' : 'Setting up…'}
              </div>
              {mode === 'upload' && (
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 6 }}>
                  SNAP is finding every requirement and wiring the passport auto-fill. ~30 seconds.
                </div>
              )}
            </div>
          ) : (
            <>
              {mode === 'upload' && (
                <>
                  {!aiAvailable && (
                    <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '9px 13px', fontSize: 12.5, color: '#92400E', marginBottom: 14 }}>
                      AI packet analysis isn't configured on this server yet — use the standard checklist for now.
                    </div>
                  )}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files) }}
                    onClick={() => inputRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragOver ? '#2563EB' : '#CBD5E1'}`, borderRadius: 12,
                      background: dragOver ? '#EFF6FF' : '#F8FAFC', padding: '28px 16px',
                      textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 28 }}>📥</div>
                    {files.length > 0 ? (
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A', marginTop: 8 }}>
                        {files.map((f) => f.name).join(', ')}
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#334155', marginTop: 8 }}>
                          Drop the facility's blank application
                        </div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>PDF or scans · up to 5 files · 25 MB each</div>
                      </>
                    )}
                    <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={(e) => pickFiles(e.target.files)} />
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Template name (optional — SNAP reads it off the application)"
                    style={{ width: '100%', marginTop: 14, padding: '11px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
                  />
                </>
              )}
              {mode === 'scratch' && (
                <>
                  <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
                    Starts the template with the 17 requirements on essentially every ASC application — then tailor it to this facility.
                  </div>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                    placeholder='e.g. "Beacon Harbor ASC — Medical Staff Application"'
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A', boxSizing: 'border-box', outline: 'none' }}
                  />
                </>
              )}
              {error && <div style={{ marginTop: 12, padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={onClose} style={{ flex: 1, padding: '11px 0', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={submit}
                  disabled={mode === 'upload' && !aiAvailable}
                  style={{
                    flex: 2, padding: '11px 0', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                    background: mode === 'upload' && !aiAvailable ? '#CBD5E1' : '#2563EB', color: '#fff',
                    cursor: mode === 'upload' && !aiAvailable ? 'not-allowed' : 'pointer',
                  }}
                >
                  {mode === 'upload' ? '✨ Analyze application' : 'Create template'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Generate packet modal ────────────────────────────────────────────────────

function GeneratePacketModal({ map, onClose, onGenerated }) {
  const [roster, setRoster] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [cycle, setCycle] = useState('INITIAL')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    credentialAPI.getPortalRoster()
      .then((d) => setRoster((d.roster || []).filter((r) => r.npi)))
      .catch((e) => { setRoster([]); setError(e.message || 'Failed to load roster') })
  }, [])

  const filtered = (roster || []).filter((r) =>
    !query.trim() || (r.providerName || '').toLowerCase().includes(query.trim().toLowerCase())
  )

  async function generate() {
    if (!selected) { setError('Pick a provider first.'); return }
    setBusy(true); setError('')
    try {
      const { packet } = await credMapAPI.generatePacket(map.id, selected.npi, cycle)
      onGenerated(packet.id)
    } catch (e) {
      setError(e.message || 'Generation failed.')
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={busy ? undefined : onClose}>
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>⚡ Generate a packet</div>
        <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 4, marginBottom: 14 }}>
          {map.name} — SNAP fills every passport-covered item from the provider's passport and opens tasks for the rest.
        </div>
        {busy ? (
          <div style={{ textAlign: 'center', padding: '26px 0' }}>
            <div style={{ fontSize: 30 }}>⚡</div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>Reading {selected?.providerName}'s passport…</div>
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the roster…"
              style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 13.5, color: '#0F172A', boxSizing: 'border-box', outline: 'none', marginBottom: 10 }}
            />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #F1F5F9', borderRadius: 10 }}>
              {roster === null ? (
                <div style={{ padding: 14, fontSize: 13, color: '#94A3B8' }}>Loading roster…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 14, fontSize: 13, color: '#94A3B8' }}>No roster providers with an NPI match.</div>
              ) : filtered.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{
                    padding: '9px 13px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: selected?.id === r.id ? '#EFF6FF' : '#fff', borderBottom: '1px solid #F8FAFC',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>{r.providerName}</div>
                    <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{r.providerType || ''} · NPI {r.npi}</div>
                  </div>
                  {r.passport?.hasGrant
                    ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#166534', background: '#DCFCE7', borderRadius: 999, padding: '2px 8px' }}>PASSPORT ✓</span>
                    : r.passport?.exists
                      ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '2px 8px' }}>NO ACCESS</span>
                      : <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94A3B8', background: '#F1F5F9', borderRadius: 999, padding: '2px 8px' }}>NO PASSPORT</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600 }}>Cycle</label>
              <select value={cycle} onChange={(e) => setCycle(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff' }}>
                <option value="INITIAL">Initial appointment</option>
                <option value="RENEWAL">Renewal / reappointment</option>
              </select>
            </div>
            {error && <div style={{ marginTop: 10, padding: '8px 12px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 12.5 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '11px 0', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={generate} disabled={!selected} style={{ flex: 2, padding: '11px 0', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, background: selected ? '#2563EB' : '#CBD5E1', color: '#fff', cursor: selected ? 'pointer' : 'not-allowed' }}>
                ⚡ Generate for {selected ? selected.providerName.split(' ').slice(-1)[0] : '…'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Packet workspace (Stage 3) ───────────────────────────────────────────────

function PacketWorkspace({ packetId, onBack }) {
  const [data, setData] = useState(null)
  const [fullPassport, setFullPassport] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState('')
  const [busyTask, setBusyTask] = useState(null)
  const [signLink, setSignLink] = useState(null) // { link, emailedTo, itemCount }
  const [sendingLink, setSendingLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [renderNote, setRenderNote] = useState('')

  async function renderPdf() {
    setRendering(true)
    setError(''); setRenderNote('')
    try {
      const result = await credMapAPI.renderPacketPdf(packetId)
      await load()
      if (result.engine === 'clean-packet') setRenderNote('This form couldn’t be auto-read confidently, so SNAP produced a clean, complete packet instead. Open Facility PDF setup to map it onto their exact form.')
      else if (result.engine === 'overlay') setRenderNote(`Filled ${result.filledCount} field${result.filledCount === 1 ? '' : 's'} onto the facility’s form. Check it, and fix any placement in Facility PDF setup.`)
      if (result.docToken) window.open(credMapAPI.docUrl(result.docToken), '_blank')
    } catch (e) { setError(e.message) }
    finally { setRendering(false) }
  }

  async function renderNative() {
    setRendering(true)
    setError(''); setRenderNote('')
    try {
      const result = await credMapAPI.renderNativeForm(packetId)
      await load()
      if (result.engine === 'native') setRenderNote(`SNAP built its digital form of this application — ${result.sections} section${result.sections === 1 ? '' : 's'}, filled from the passport${result.signatureStamped ? ', signature stamped' : ''}. Always renders perfectly, no placement to fix.`)
      else if (result.engine === 'clean-packet') setRenderNote('SNAP’s digital form isn’t ready for this template yet — SNAP produced a clean packet instead. Confirm the template (or use Rebuild SNAP’s digital form) to mirror the facility’s application exactly.')
      if (result.docToken) window.open(credMapAPI.docUrl(result.docToken), '_blank')
    } catch (e) { setError(e.message) }
    finally { setRendering(false) }
  }

  const load = () => credMapAPI.getPacket(packetId).then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [packetId])

  async function sendSignLink() {
    setSendingLink(true)
    try { setSignLink(await credMapAPI.sendSignLink(packetId)) }
    catch (e) { setError(e.message) }
    finally { setSendingLink(false) }
  }

  // Full passport detail (identifiers + documents) for the workspace cards
  // and the preview — richer than the summary the generate pass uses.
  useEffect(() => {
    const npi = data?.packet?.npi
    if (!npi) return
    credentialAPI.getPassport(npi).then(setFullPassport).catch(() => setFullPassport(null))
  }, [data?.packet?.npi])

  const detailByType = useMemo(() => {
    const m = {}
    for (const c of fullPassport?.credentials || []) m[c.type] = c
    return m
  }, [fullPassport])

  async function setTask(task, patch) {
    setBusyTask(task.id)
    try { await credMapAPI.updatePacketTask(packetId, task.id, patch); await load() }
    catch (e) { setError(e.message) }
    finally { setBusyTask(null) }
  }

  async function setPacketStatus(status) {
    try { await credMapAPI.updatePacket(packetId, { status }); await load() }
    catch (e) { setError(e.message) }
  }

  async function refresh() {
    try { await credMapAPI.refreshPacket(packetId); await load() }
    catch (e) { setError(e.message) }
  }

  if (!data) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>← Back</button>
        <div style={{ color: '#94A3B8', fontSize: 14, marginTop: 20 }}>{error || 'Loading…'}</div>
      </div>
    )
  }

  const { packet, passport } = data

  if (showPreview) {
    return <PacketPreview packet={packet} passportDetail={fullPassport} onBack={() => setShowPreview(false)} />
  }

  const ps = PACKET_STATUS[packet.status] || PACKET_STATUS.IN_PROGRESS
  const openTasks = packet.tasks.filter((t) => !['AUTO_FILLED', 'DONE', 'WAIVED'].includes(t.status))
  const providerTasks = openTasks.filter((t) => t.assignee === 'PROVIDER')
  const openSignatures = openTasks.filter((t) => t.status === 'NEEDS_SIGNATURE' && t.item.fulfillment === 'SIGNATURE' && t.item.esignOk)

  // Group tasks by their item's section, in item order.
  const groups = []
  for (const t of packet.tasks) {
    const section = t.item.section || 'General'
    const last = groups[groups.length - 1]
    if (last && last.section === section) last.tasks.push(t)
    else groups.push({ section, tasks: [t] })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← {packet.map?.name || 'Application'}</button>

      {/* Header */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#0F172A' }}>{packet.providerName || `NPI ${packet.npi}`}</div>
            <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>
              NPI {packet.npi} · {packet.cycle === 'RENEWAL' ? 'Renewal' : 'Initial appointment'} · generated {fmtShortDate(packet.createdAt)}
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: ps.bg, color: ps.fg }}>{ps.label}</span>
          <button onClick={() => setShowPreview(true)} style={{ padding: '9px 16px', background: '#0F172A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            👁 Preview packet
          </button>
          {openSignatures.length > 0 && (
            <button onClick={sendSignLink} disabled={sendingLink} style={{ padding: '9px 16px', background: '#7C3AED', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: sendingLink ? 'wait' : 'pointer' }}>
              {sendingLink ? 'Creating link…' : `✍️ Send for signature (${openSignatures.length})`}
            </button>
          )}
          <button onClick={renderNative} disabled={rendering} title="SNAP builds its own clean digital form of the facility's application, filled from the verified passport — always perfect, nothing to place" style={{ padding: '9px 16px', background: '#16A34A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: rendering ? 'wait' : 'pointer' }}>
            {rendering ? 'Building form…' : '📋 Generate SNAP’s digital form'}
          </button>
          <button onClick={renderPdf} disabled={rendering} title="Fallback: type the provider's passport data onto the facility's own PDF — only for facilities that require their exact form" style={{ padding: '9px 14px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10, color: '#475569', fontSize: 12.5, fontWeight: 700, cursor: rendering ? 'wait' : 'pointer' }}>
            {rendering ? '…' : '📄 Fill facility PDF'}
          </button>
          {data.generatedDoc?.token && (
            <a href={credMapAPI.docUrl(data.generatedDoc.token)} target="_blank" rel="noreferrer" style={{ padding: '9px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, color: '#166534', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
              ⬇ {data.generatedDoc.name || 'Filled packet'}
            </a>
          )}
          <button onClick={refresh} title="Re-check the passport for anything new" style={{ padding: '8px 13px', background: '#F1F5F9', border: 'none', borderRadius: 9, color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ↺ Refresh auto-fill
          </button>
          {packet.status === 'IN_PROGRESS' && (
            <button onClick={() => setPacketStatus('READY')} disabled={packet.completeness < 100} title={packet.completeness < 100 ? 'Complete every item first' : 'Mark ready to send'} style={{ padding: '9px 16px', background: packet.completeness >= 100 ? '#16A34A' : '#CBD5E1', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: packet.completeness >= 100 ? 'pointer' : 'not-allowed' }}>
              Mark ready ✓
            </button>
          )}
          {packet.status === 'READY' && (
            <button onClick={() => setPacketStatus('SENT')} style={{ padding: '9px 16px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              Mark sent to facility →
            </button>
          )}
        </div>

        {/* Completeness */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: packet.completeness >= 100 ? '#166534' : '#475569' }}>
              {packet.tasks.filter((t) => ['AUTO_FILLED', 'DONE', 'WAIVED'].includes(t.status)).length} of {packet.tasks.length} items complete
              {providerTasks.length > 0 ? ` · ${providerTasks.length} waiting on the provider` : ''}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: packet.completeness >= 100 ? '#166534' : '#475569' }}>{packet.completeness}%</span>
          </div>
          <div style={{ height: 8, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${packet.completeness}%`, height: '100%', background: packet.completeness >= 100 ? 'linear-gradient(90deg, #22C55E, #16A34A)' : 'linear-gradient(90deg, #60A5FA, #2563EB)', borderRadius: 999, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {(!passport.exists || !passport.hasGrant) && (
          <div style={{ marginTop: 14, background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#92400E' }}>
            {passport.bridgeUnconfigured ? 'Passport bridge is not configured — auto-fill is unavailable.'
              : !passport.exists ? 'No SNAP Passport found for this NPI — invite the provider to claim their passport, then hit Refresh.'
              : 'This provider hasn\'t granted your facility passport access yet — request access from their provider file, then hit Refresh.'}
          </div>
        )}
      </div>

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {renderNote && <div style={{ padding: '9px 13px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, color: '#1E40AF', fontSize: 12.5, marginBottom: 12 }}>{renderNote}</div>}

      {signLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSignLink(null)}>
          <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>✍️ Signature link ready</div>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>
              {signLink.emailedTo
                ? <>Emailed to <strong>{signLink.emailedTo}</strong> — one tap, they sign all {signLink.itemCount} item{signLink.itemCount === 1 ? '' : 's'} on their phone, and this board updates automatically.</>
                : <>No SNAP email on file for this provider — copy the link below and text or email it to them directly. It signs all {signLink.itemCount} item{signLink.itemCount === 1 ? '' : 's'}.</>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <input readOnly value={signLink.link} onFocus={(e) => e.target.select()} style={{ flex: 1, padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 12, color: '#475569', boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace' }} />
              <button
                onClick={() => { navigator.clipboard?.writeText(signLink.link); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                style={{ padding: '10px 16px', background: copied ? '#16A34A' : '#0F172A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 10 }}>Link expires in 14 days. Signatures are recorded with identity, timestamp, and device for the audit trail.</div>
            <button onClick={() => setSignLink(null)} style={{ width: '100%', marginTop: 14, padding: '10px 0', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}

      {/* Tasks by section */}
      {groups.map((g) => (
        <div key={g.section + g.tasks[0].id} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{g.section}</div>
          {g.tasks.map((t) => {
            const st = TASK_STATUS[t.status] || TASK_STATUS.NEEDS_ACTION
            const complete = ['AUTO_FILLED', 'DONE', 'WAIVED'].includes(t.status)
            // Prefer the full passport detail (identifier + docs) over the
            // lighter summary the generate pass stored on the task.
            const cred = (t.item.credentialType && detailByType[PASSPORT_TYPE_UI[t.item.credentialType]]) || t.passportCredential
            return (
              <div key={t.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', marginBottom: 8, opacity: busyTask === t.id ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.icon} {st.label}</span>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: complete ? '#64748B' : '#0F172A' }}>
                      {t.item.label}
                      {!t.item.required && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>OPTIONAL</span>}
                      {t.item.fulfillment === 'SIGNATURE' && !t.item.esignOk && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, color: '#B91C1C' }}>✒️ WET INK</span>}
                    </div>
                    {cred && (
                      <div style={{ fontSize: 11.5, color: '#166534', marginTop: 2 }}>
                        ⚡ {cred.identifier ? <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{cred.identifier}</span> : 'On passport'}
                        {cred.jurisdiction ? ` · ${cred.jurisdiction}` : ''}{cred.expirationDate ? ` · expires ${fmtShortDate(cred.expirationDate)}` : ''} · {cred.status}
                        {(cred.documents || []).map((d) => (
                          <a key={d.id} href={d.downloadUrl || '#'} target="_blank" rel="noreferrer" style={{ marginLeft: 10, color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}>📄 view</a>
                        ))}
                      </div>
                    )}
                    {t.note && <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>{t.note}</div>}
                  </div>
                  {!complete && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => setTask(t, { assignee: t.assignee === 'PROVIDER' ? 'COORDINATOR' : 'PROVIDER' })} title="Who owes this item" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: '1px solid #E2E8F0', background: t.assignee === 'PROVIDER' ? '#EFF6FF' : '#F8FAFC', color: t.assignee === 'PROVIDER' ? '#2563EB' : '#64748B', cursor: 'pointer' }}>
                        {t.assignee === 'PROVIDER' ? '👤 Provider' : '🗂 Coordinator'}
                      </button>
                      <button onClick={() => setTask(t, { status: 'DONE' })} style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 8, border: 'none', background: '#DCFCE7', color: '#166534', cursor: 'pointer' }}>Mark done</button>
                      <button onClick={() => setTask(t, { status: 'WAIVED' })} style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 8, border: 'none', background: '#F1F5F9', color: '#64748B', cursor: 'pointer' }}>Waive</button>
                    </div>
                  )}
                  {complete && t.status !== 'AUTO_FILLED' && (
                    <button onClick={() => setTask(t, { status: t.item.fulfillment === 'SIGNATURE' ? 'NEEDS_SIGNATURE' : t.item.fulfillment === 'DOCUMENT' ? 'NEEDS_DOCUMENT' : 'NEEDS_ACTION' })} style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', cursor: 'pointer' }}>Reopen</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Renewals board — the recredentialing control tower ───────────────────────
// Every tracked provider × facility with their appointment clock. Dates are
// coordinator-recorded (the facility board's date — never the packet-sent
// date); nextDue defaults to appointed + the map's cycle but is editable
// because facilities override cycles all the time. Supports backfill so
// pre-SNAP credentialing history is trackable day one.

function isoDay(d) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

function daysLeft(d) {
  if (!d) return null
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const t = new Date(d)
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  return Math.round((end - start) / 86400000)
}

function RenewalsView({ maps, onOpenPacket }) {
  const [appointments, setAppointments] = useState(null)
  const [roster, setRoster] = useState([])
  const [adding, setAdding] = useState(false)
  const [addMapId, setAddMapId] = useState('')
  const [addNpi, setAddNpi] = useState('')
  const [addDate, setAddDate] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const load = () => credMapAPI.getRenewals().then((d) => setAppointments(d.appointments)).catch((e) => setError(e.message))
  useEffect(() => {
    load()
    credentialAPI.getPortalRoster().then((d) => setRoster((d.roster || []).filter((r) => r.npi))).catch(() => {})
  }, [])

  const confirmedMaps = maps.filter((m) => m.status !== 'ARCHIVED')

  async function patch(a, data) {
    setBusyId(a.id)
    try { await credMapAPI.updateRenewal(a.id, data); await load() }
    catch (e) { setError(e.message) }
    finally { setBusyId(null) }
  }

  async function add() {
    if (!addMapId || !addNpi) { setError('Pick a facility application and a provider.'); return }
    setError('')
    const r = roster.find((x) => x.npi === addNpi)
    try {
      await credMapAPI.addRenewal({ mapId: addMapId, npi: addNpi, providerName: r?.providerName, appointedAt: addDate || null })
      setAdding(false); setAddNpi(''); setAddDate('')
      await load()
    } catch (e) { setError(e.message) }
  }

  async function renew(a) {
    setBusyId(a.id)
    try {
      const { packet } = await credMapAPI.generatePacket(a.mapId, a.npi, 'RENEWAL')
      onOpenPacket(packet.id)
    } catch (e) { setError(e.message); setBusyId(null) }
  }

  if (appointments === null) {
    return <div style={{ color: '#94A3B8', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>{error || 'Loading…'}</div>
  }

  const buckets = { OVERDUE: [], SOON: [], UPCOMING: [], NO_DATE: [] }
  for (const a of appointments) {
    const d = daysLeft(a.nextDueAt)
    if (d === null) buckets.NO_DATE.push({ ...a, _days: null })
    else if (d < 0) buckets.OVERDUE.push({ ...a, _days: d })
    else if (d <= 90) buckets.SOON.push({ ...a, _days: d })
    else buckets.UPCOMING.push({ ...a, _days: d })
  }

  const stat = (label, count, color) => (
    <div style={{ flex: 1, minWidth: 120, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '14px 18px' }}>
      <div style={{ fontSize: 26, fontWeight: 900, color }}>{count}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )

  const BUCKET_META = [
    ['OVERDUE', '🔴 Overdue', '#DC2626'],
    ['SOON', '🟠 Due within 90 days', '#D97706'],
    ['UPCOMING', '🟢 Up to date', '#16A34A'],
    ['NO_DATE', '⚪ Awaiting appointment date', '#94A3B8'],
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {stat('Overdue', buckets.OVERDUE.length, buckets.OVERDUE.length ? '#DC2626' : '#CBD5E1')}
        {stat('Due ≤ 90 days', buckets.SOON.length, buckets.SOON.length ? '#D97706' : '#CBD5E1')}
        {stat('Up to date', buckets.UPCOMING.length, '#16A34A')}
        {stat('Tracked', appointments.length, '#0F172A')}
      </div>

      {/* Track a provider (backfill) */}
      {adding ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '12px 16px', marginBottom: 18 }}>
          <select value={addMapId} onChange={(e) => setAddMapId(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', maxWidth: 220 }}>
            <option value="">Facility application…</option>
            {confirmedMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={addNpi} onChange={(e) => setAddNpi(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', maxWidth: 220 }}>
            <option value="">Provider…</option>
            {roster.map((r) => <option key={r.id} value={r.npi}>{r.providerName}</option>)}
          </select>
          <label style={{ fontSize: 12, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            Appointed
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} style={{ padding: '7px 9px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5 }} />
          </label>
          <button onClick={add} style={{ padding: '8px 16px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>Track</button>
          <button onClick={() => setAdding(false)} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ marginBottom: 18, padding: '10px 18px', background: 'none', border: '1px dashed #CBD5E1', borderRadius: 10, color: '#64748B', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Track a provider (backfill existing credentialing)
        </button>
      )}

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {appointments.length === 0 && (
        <div style={{ background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>🕰️</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>No renewal clocks yet</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, maxWidth: 440, margin: '6px auto 0' }}>
            Providers land here when a packet is marked Sent, or track one manually above — record their appointment date once and SNAP watches the clock forever.
          </div>
        </div>
      )}

      {BUCKET_META.map(([key, title, color]) => buckets[key].length > 0 && (
        <div key={key} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color, marginBottom: 8 }}>{title} ({buckets[key].length})</div>
          {buckets[key].map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#fff', border: '1px solid #E2E8F0', borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8, opacity: busyId === a.id ? 0.5 : 1 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>{a.providerName || `NPI ${a.npi}`}</div>
                <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{a.map?.name}{a.map?.recredCycleMonths ? ` · ${a.map.recredCycleMonths}-month cycle` : ''}</div>
              </div>
              <label style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                Appointed
                <input type="date" defaultValue={isoDay(a.appointedAt)} onBlur={(e) => { if (e.target.value !== isoDay(a.appointedAt)) patch(a, { appointedAt: e.target.value || null }) }} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                Next due
                <input type="date" defaultValue={isoDay(a.nextDueAt)} onBlur={(e) => { if (e.target.value !== isoDay(a.nextDueAt)) patch(a, { nextDueAt: e.target.value || null }) }} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12 }} />
              </label>
              {a._days !== null && (
                <span style={{ fontSize: 11.5, fontWeight: 800, color, whiteSpace: 'nowrap', width: 76, textAlign: 'center' }}>
                  {a._days < 0 ? `${-a._days}d over` : `${a._days}d left`}
                </span>
              )}
              <button onClick={() => renew(a)} title="Generate a renewal packet — the template fills it from the passport" style={{ padding: '7px 13px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                ⚡ Renew
              </button>
              <button onClick={() => credMapAPI.deleteRenewal(a.id).then(load).catch((e) => setError(e.message))} title="Stop tracking" style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: 15, cursor: 'pointer', padding: '0 2px', fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Field-mapping review panel ───────────────────────────────────────────────
// Transparency + correction: every fillable field in the facility's PDF, the
// label printed next to it, and what SNAP types there — editable. Diagnoses an
// under-filled form (generic field names, or genuinely sparse passport data)
// and lets the coordinator fix any mis-map, saved on the map for every provider.

const VALUE_KEY_LABEL = {
  LEAVE_BLANK: '— leave blank —',
  'provider.fullName': 'Provider full name',
  'provider.firstName': 'First name',
  'provider.lastName': 'Last name',
  'provider.npi': 'NPI',
  'provider.dateOfBirth': 'Date of birth',
  'provider.specialty': 'Specialty',
  'provider.licenseState': 'License state',
  'cred.STATE_LICENSE.identifier': 'State license #',
  'cred.STATE_LICENSE.expirationDate': 'State license expiry',
  'cred.STATE_CS_LICENSE.identifier': 'State CS license #',
  'cred.STATE_CS_LICENSE.expirationDate': 'State CS license expiry',
  'cred.DEA.identifier': 'DEA #',
  'cred.DEA.expirationDate': 'DEA expiry',
  'cred.BOARD_CERTIFICATION.identifier': 'Board cert #',
  'cred.BOARD_CERTIFICATION.expirationDate': 'Board cert expiry',
  'cred.MALPRACTICE_INSURANCE.identifier': 'Malpractice policy #',
  'cred.MALPRACTICE_INSURANCE.expirationDate': 'Malpractice expiry',
  'cred.ACLS.expirationDate': 'ACLS expiry',
  'cred.BLS.expirationDate': 'BLS expiry',
  'malpractice.carrier': 'Malpractice carrier',
  today: "Today's date",
}

// SNAP-side, one-time-per-form: paste the Anvil PDF Template id and map its
// field aliases to passport data. Once a template id is set, this map's
// "Fill facility PDF" fills the facility's real (flat) form via Anvil — used
// when the packet isn't a fillable AcroForm PDF.
function AnvilSetup({ mapId, map }) {
  const [castEid, setCastEid] = useState(map.anvilCastEid || '')
  const [rows, setRows] = useState(() =>
    Object.entries(map.anvilAliasMap || {}).map(([alias, key]) => ({ alias, key }))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  function setRow(i, patch) { setRows((r) => r.map((row, j) => j === i ? { ...row, ...patch } : row)); setSaved(false) }

  async function save() {
    setSaving(true); setErr('')
    try {
      const aliasMap = {}
      for (const r of rows) if (r.alias.trim() && r.key) aliasMap[r.alias.trim()] = r.key
      await credMapAPI.saveAnvil(mapId, castEid.trim() || null, aliasMap)
      setSaved(true)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ borderTop: '1px solid #E2E8F0', padding: '14px 24px', background: '#FAFAFF' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#5B21B6' }}>🖇 Anvil template (flat / print-to-fill forms)</div>
      <div style={{ fontSize: 11.5, color: '#64748B', margin: '3px 0 10px' }}>
        For forms that aren't fillable PDFs. Build the template once in Anvil, paste its ID here, and map each Anvil field alias to passport data. When set, this form fills via Anvil for every provider.
      </div>
      <input
        value={castEid}
        onChange={(e) => { setCastEid(e.target.value); setSaved(false) }}
        placeholder="Anvil PDF Template ID (castEid)"
        style={{ width: '100%', padding: '8px 11px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, color: '#0F172A', boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace', marginBottom: 10 }}
      />
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input value={r.alias} onChange={(e) => setRow(i, { alias: e.target.value })} placeholder="Anvil field alias" style={{ flex: 1, padding: '6px 9px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontFamily: 'monospace' }} />
          <span style={{ color: '#94A3B8' }}>→</span>
          <select value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} style={{ flex: 1, padding: '6px 9px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, background: '#fff' }}>
            {Object.entries(VALUE_KEY_LABEL).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          <button onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: 15, cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <button onClick={() => setRows((r) => [...r, { alias: '', key: 'LEAVE_BLANK' }])} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>+ Add field</button>
        <div style={{ flex: 1 }} />
        {err && <span style={{ color: '#DC2626', fontSize: 12 }}>{err}</span>}
        {saved && <span style={{ color: '#16A34A', fontSize: 12, fontWeight: 700 }}>Saved ✓</span>}
        <button onClick={save} disabled={saving} style={{ padding: '7px 14px', background: '#7C3AED', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Anvil setup'}</button>
      </div>
    </div>
  )
}

function FieldMappingPanel({ mapId, map, roster, onClose }) {
  const [data, setData] = useState(null)
  const [previewNpi, setPreviewNpi] = useState('')
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState('')

  async function rebuild() {
    setRebuilding(true); setError('')
    try {
      await credMapAPI.rebuildFieldMap(mapId)
      setEdits({})
      load(previewNpi)
    } catch (e) { setError(e.message) }
    finally { setRebuilding(false) }
  }

  const load = (npi) => {
    setData(null)
    credMapAPI.getFieldMap(mapId, npi).then(setData).catch((e) => setError(e.message))
  }
  useEffect(() => { load(previewNpi) }, [previewNpi])

  function setField(name, source) {
    setEdits((e) => ({ ...e, [name]: source }))
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const fieldMap = {}
      for (const f of data.fields) fieldMap[f.name] = edits[f.name] ?? f.source
      await credMapAPI.saveFieldMap(mapId, fieldMap)
      setSaved(true)
      load(previewNpi)
      setEdits({})
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 760, maxHeight: '88vh', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>Facility PDF — what SNAP types where</div>
              <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 3 }}>
                {!data ? 'Reading the facility form…'
                  : data.cleanPacket ? 'No facility form uploaded — SNAP produces a clean, complete packet instead.'
                  : `${data.mappedCount} of ${data.totalCount} ${data.engine === 'overlay' ? 'fields auto-detected on the form' : 'fields mapped'}. Correct any below — saved for every provider on this form.`}
                {data?.engine === 'overlay' && data?.cleanFallback && (
                  <span style={{ color: '#92400E', fontWeight: 700 }}> · low read confidence — this form will deliver as the clean SNAP packet unless you map fields below.</span>
                )}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Preview values for</span>
            <select value={previewNpi} onChange={(e) => setPreviewNpi(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, color: '#0F172A', background: '#fff' }}>
              <option value="">— no provider —</option>
              {roster.map((r) => <option key={r.id} value={r.npi}>{r.providerName}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            {data && !data.cleanPacket && (
              <button onClick={rebuild} disabled={rebuilding} title="Re-run the AI detection using the labels printed on the form" style={{ padding: '6px 12px', background: '#EDE9FE', border: 'none', borderRadius: 8, color: '#5B21B6', fontSize: 12, fontWeight: 800, cursor: rebuilding ? 'wait' : 'pointer' }}>
                {rebuilding ? 'Re-mapping…' : '✨ Re-run AI mapping'}
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 24px', flex: 1 }}>
          {data?.cleanPacket ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748B', fontSize: 13.5 }}>
              No facility form is uploaded to this template, so “Fill facility PDF” produces a clean, complete SNAP packet from the passport — nothing to map here.
            </div>
          ) : !data ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13.5 }}>Loading…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Field / label on form</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>SNAP fills with</th>
                  {previewNpi && <th style={{ textAlign: 'left', padding: '8px 6px', color: '#64748B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Value</th>}
                </tr>
              </thead>
              <tbody>
                {data.fields.map((f) => {
                  const cur = edits[f.name] ?? f.source
                  return (
                    <tr key={f.name} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '7px 6px', maxWidth: 260 }}>
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>{f.label || <span style={{ color: '#94A3B8', fontWeight: 400 }}>(no label)</span>}</div>
                        <div style={{ fontSize: 10.5, color: '#CBD5E1', fontFamily: 'monospace' }}>{f.name}</div>
                      </td>
                      <td style={{ padding: '7px 6px' }}>
                        <select value={cur} onChange={(e) => setField(f.name, e.target.value)} style={{ padding: '5px 7px', border: `1px solid ${cur !== 'LEAVE_BLANK' ? '#BFDBFE' : '#E2E8F0'}`, borderRadius: 7, fontSize: 12, color: cur !== 'LEAVE_BLANK' ? '#1E40AF' : '#94A3B8', background: '#fff', maxWidth: 200 }}>
                          {Object.entries(VALUE_KEY_LABEL).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                        </select>
                      </td>
                      {previewNpi && (
                        <td style={{ padding: '7px 6px', color: f.value ? '#166534' : '#CBD5E1', fontWeight: f.value ? 600 : 400 }}>
                          {f.value || '—'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
          {error && <span style={{ color: '#DC2626', fontSize: 12.5 }}>{error}</span>}
          {saved && <span style={{ color: '#16A34A', fontSize: 12.5, fontWeight: 700 }}>Saved ✓</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: '9px 16px', background: '#F1F5F9', border: 'none', borderRadius: 9, color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Close</button>
          {data && !data.cleanPacket && (
            <button onClick={save} disabled={saving || Object.keys(edits).length === 0} style={{ padding: '9px 18px', background: Object.keys(edits).length === 0 ? '#CBD5E1' : '#2563EB', border: 'none', borderRadius: 9, color: '#fff', fontSize: 13, fontWeight: 800, cursor: Object.keys(edits).length === 0 ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save mapping'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Map builder ──────────────────────────────────────────────────────────────

function ItemRow({ item, taxonomy, onUpdate, onDelete, dragHandlers, dragging, dragTarget }) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [label, setLabel] = useState(item.label)
  const f = FULFILLMENT[item.fulfillment] || FULFILLMENT.MANUAL

  useEffect(() => { setLabel(item.label) }, [item.label])

  function commitLabel() {
    setEditingLabel(false)
    if (label.trim() && label.trim() !== item.label) onUpdate({ label: label.trim() })
    else setLabel(item.label)
  }

  return (
    <div
      draggable
      {...dragHandlers}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: '#fff', border: `1px solid ${dragTarget ? '#2563EB' : '#E2E8F0'}`,
        borderRadius: 10, marginBottom: 8, opacity: dragging ? 0.4 : 1,
        boxShadow: dragTarget ? '0 0 0 2px rgba(37,99,235,0.25)' : 'none',
        cursor: 'grab',
      }}
    >
      <span style={{ color: '#CBD5E1', fontSize: 14, userSelect: 'none' }}>⠿</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editingLabel ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setLabel(item.label); setEditingLabel(false) } }}
            style={{ width: '100%', fontSize: 13.5, fontWeight: 600, color: '#0F172A', border: '1px solid #2563EB', borderRadius: 6, padding: '3px 8px', outline: 'none', boxSizing: 'border-box' }}
          />
        ) : (
          <div onClick={() => setEditingLabel(true)} title="Click to edit" style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}>
            {item.aiConfidence && (
              <span title={`AI confidence: ${item.aiConfidence}`} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: CONFIDENCE_DOT[item.aiConfidence] || '#94A3B8', marginRight: 7, verticalAlign: 'middle' }} />
            )}
            {item.label}
            {!item.required && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>OPTIONAL</span>}
          </div>
        )}
        {item.notes && <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notes}</div>}
      </div>

      {item.fulfillment === 'SIGNATURE' && (
        <button
          onClick={() => onUpdate({ esignOk: !item.esignOk })}
          title={item.esignOk ? 'E-signature accepted — click if this facility demands wet ink' : 'Wet ink / notarization required — click if e-sign is OK'}
          style={{
            fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
            background: item.esignOk ? '#EDE9FE' : '#FEE2E2', color: item.esignOk ? '#5B21B6' : '#B91C1C',
            border: 'none', whiteSpace: 'nowrap',
          }}
        >
          {item.esignOk ? 'e-sign OK' : 'WET INK'}
        </button>
      )}

      <select
        value={item.fulfillment}
        onChange={(e) => onUpdate({ fulfillment: e.target.value })}
        style={{
          fontSize: 11.5, fontWeight: 700, padding: '4px 6px', borderRadius: 999, border: 'none',
          background: f.bg, color: f.fg, cursor: 'pointer', appearance: 'none', textAlign: 'center',
        }}
      >
        {Object.entries(FULFILLMENT).map(([k, v]) => (
          <option key={k} value={k}>{v.icon} {v.label}</option>
        ))}
      </select>

      <select
        value={item.canonicalType || 'OTHER'}
        onChange={(e) => onUpdate({ canonicalType: e.target.value })}
        title="Canonical requirement type — drives the passport auto-fill wiring"
        style={{ fontSize: 11.5, color: '#64748B', padding: '4px 6px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC', cursor: 'pointer', maxWidth: 150 }}
      >
        {taxonomy.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>

      <button onClick={onDelete} title="Remove item" style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: 16, cursor: 'pointer', padding: '0 2px', fontWeight: 700 }}>×</button>
    </div>
  )
}

function MapBuilder({ mapId, taxonomy, onBack, onChanged, onOpenPacket }) {
  const [map, setMap] = useState(null)
  const [packets, setPackets] = useState([])
  const [showGen, setShowGen] = useState(false)
  const [showFieldMap, setShowFieldMap] = useState(false)
  const [roster, setRoster] = useState([])
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('OTHER')
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [building, setBuilding] = useState(false)
  const [structureNote, setStructureNote] = useState('')

  async function buildNative() {
    setBuilding(true); setError(''); setStructureNote('')
    try {
      const { stats, truncated } = await credMapAPI.buildFormStructure(mapId)
      await load()
      setStructureNote(`SNAP’s digital form is ready — ${stats.sections} section${stats.sections === 1 ? '' : 's'}. SNAP auto-fills ${stats.passport}, provider answers ${stats.provider + stats.attestation}, ${stats.signature} to sign.${truncated ? ' ⚠️ This form is very long — the tail may be cut off; review SNAP’s digital form and rebuild if sections are missing.' : ' Generate a packet, then open “📋 Generate SNAP’s digital form”.'}`)
      onChanged()
    } catch (e) { setError(e.message) }
    finally { setBuilding(false) }
  }

  // Confirming the template finishes setup end to end: flip to CONFIRMED and,
  // when the facility uploaded an application, auto-build SNAP's digital form so
  // the coordinator never has to treat it as a separate step.
  async function confirmSetup() {
    await patchMap({ status: 'CONFIRMED' })
    if (map?.sourceDocName && !hasNativeForm) await buildNative()
  }

  const hasNativeForm = Boolean(map?.formStructure && Array.isArray(map.formStructure.sections) && map.formStructure.sections.length > 0)

  const load = () => credMapAPI.getMap(mapId).then(({ map }) => setMap(map)).catch((e) => setError(e.message))
  const loadPackets = () => credMapAPI.getPackets(mapId).then((d) => setPackets(d.packets)).catch(() => {})
  useEffect(() => {
    load(); loadPackets()
    credentialAPI.getPortalRoster().then((d) => setRoster((d.roster || []).filter((r) => r.npi))).catch(() => {})
  }, [mapId])

  const grouped = useMemo(() => {
    if (!map) return []
    const groups = []
    for (const item of map.items) {
      const section = item.section || 'General'
      const last = groups[groups.length - 1]
      if (last && last.section === section) last.items.push(item)
      else groups.push({ section, items: [item] })
    }
    return groups
  }, [map])

  async function patchMap(data) {
    try {
      const { map: updated } = await credMapAPI.updateMap(mapId, data)
      setMap(updated)
      onChanged()
    } catch (e) { setError(e.message) }
  }

  async function patchItem(itemId, data) {
    try {
      await credMapAPI.updateItem(mapId, itemId, data)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  async function removeItem(itemId) {
    try {
      await credMapAPI.deleteItem(mapId, itemId)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  async function addItem() {
    if (!newLabel.trim()) return
    try {
      await credMapAPI.addItem(mapId, { label: newLabel.trim(), canonicalType: newType })
      setNewLabel(''); setNewType('OTHER'); setAddOpen(false)
      await load(); onChanged()
    } catch (e) { setError(e.message) }
  }

  // Native drag-and-drop reorder. Dropping onto an item in another section
  // moves the dragged item there AND adopts that section.
  async function handleDrop(targetItem) {
    const sourceId = dragId
    setDragId(null); setDragOverId(null)
    if (!sourceId || sourceId === targetItem.id) return
    const items = [...map.items]
    const from = items.findIndex((i) => i.id === sourceId)
    const to = items.findIndex((i) => i.id === targetItem.id)
    if (from < 0 || to < 0) return
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    setMap({ ...map, items }) // optimistic
    try {
      if ((moved.section || null) !== (targetItem.section || null)) {
        await credMapAPI.updateItem(mapId, moved.id, { section: targetItem.section })
      }
      await credMapAPI.reorderItems(mapId, items.map((i) => i.id))
      await load(); onChanged()
    } catch (e) { setError(e.message); load() }
  }

  if (!map) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>← All applications</button>
        <div style={{ color: '#94A3B8', fontSize: 14, marginTop: 20 }}>{error || 'Loading…'}</div>
      </div>
    )
  }

  const wetInkCount = map.items.filter((i) => i.fulfillment === 'SIGNATURE' && !i.esignOk).length

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← All applications</button>

      {/* Header card */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            value={map.name}
            onChange={(e) => setMap({ ...map, name: e.target.value })}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== map.name) patchMap({ name: e.target.value.trim() }) }}
            style={{ flex: 1, minWidth: 240, fontSize: 19, fontWeight: 800, color: '#0F172A', border: 'none', outline: 'none', background: 'transparent' }}
          />
          <StatusPill status={map.status} />
          <button
            onClick={() => { if (map.status === 'CONFIRMED') setShowGen(true) }}
            disabled={map.status !== 'CONFIRMED'}
            title={map.status === 'CONFIRMED' ? 'Generate a provider’s packet from this template' : 'Confirm & finish setup first to start generating packets'}
            style={{ padding: '9px 16px', background: map.status === 'CONFIRMED' ? '#2563EB' : '#E2E8F0', border: 'none', borderRadius: 10, color: map.status === 'CONFIRMED' ? '#fff' : '#94A3B8', fontSize: 13, fontWeight: 800, cursor: map.status === 'CONFIRMED' ? 'pointer' : 'not-allowed' }}
          >
            ⚡ Generate packet
          </button>
          {map.sourceDocName && (
            <button onClick={buildNative} disabled={building} title="Rebuild SNAP's own clean digital form from the facility's application — normally built automatically when you confirm the template" style={{ padding: '9px 16px', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 10, color: '#475569', fontSize: 13, fontWeight: 700, cursor: building ? 'wait' : 'pointer' }}>
              {building ? 'Reading their form…' : hasNativeForm ? '📋 Rebuild SNAP’s digital form' : '📋 Build SNAP’s digital form'}
            </button>
          )}
          {map.sourceDocName && (
            <button onClick={() => setShowFieldMap(true)} title="Facility PDF fallback: see and correct what SNAP types onto the facility's own PDF" style={{ padding: '9px 14px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, color: '#94A3B8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              🧩 Facility PDF setup
            </button>
          )}
          {map.status === 'DRAFT' ? (
            <button onClick={confirmSetup} disabled={building} title="Confirm this template — SNAP finishes setup and builds its digital form" style={{ padding: '9px 18px', background: '#16A34A', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 800, cursor: building ? 'wait' : 'pointer' }}>
              {building ? 'Finishing setup…' : 'Confirm & finish setup ✓'}
            </button>
          ) : (
            <button onClick={() => patchMap({ status: 'DRAFT' })} style={{ padding: '9px 14px', background: '#F1F5F9', border: 'none', borderRadius: 10, color: '#475569', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              Reopen draft
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            Recredentialing every
            <input
              type="number" min={1} max={120}
              value={map.recredCycleMonths ?? ''}
              placeholder="—"
              onChange={(e) => setMap({ ...map, recredCycleMonths: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={(e) => patchMap({ recredCycleMonths: e.target.value === '' ? null : Number(e.target.value) })}
              style={{ width: 54, padding: '5px 8px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', outline: 'none' }}
            />
            months
          </label>
          <label style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            Output
            <select
              value={map.outputMode}
              onChange={(e) => patchMap({ outputMode: e.target.value })}
              style={{ padding: '5px 8px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', cursor: 'pointer' }}
            >
              {OUTPUT_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          {map.sourceDocName && (
            <span style={{ fontSize: 12, color: '#94A3B8' }}>📎 {map.sourceDocName}</span>
          )}
        </div>

        {map.aiNotes && (
          <div style={{ marginTop: 14, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#1E40AF' }}>
            ✨ {map.aiNotes}
          </div>
        )}

        {structureNote && (
          <div style={{ marginTop: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#166534' }}>
            📋 {structureNote}
          </div>
        )}
        {!structureNote && hasNativeForm && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
            📋 SNAP’s digital form is ready — {map.formStructure.sections.length} section{map.formStructure.sections.length === 1 ? '' : 's'} mirror this facility’s application.
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <AutoFillBar stats={map.stats} />
          {wetInkCount > 0 && (
            <div style={{ fontSize: 11.5, color: '#B91C1C', fontWeight: 600, marginTop: 6 }}>
              ✒️ {wetInkCount} item{wetInkCount > 1 ? 's' : ''} require wet-ink signature — these stay manual.
            </div>
          )}
        </div>
      </div>

      {/* Packets off this map */}
      {packets.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '14px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>📦 Provider packets</div>
          {packets.map((p) => {
            const ps = PACKET_STATUS[p.status] || PACKET_STATUS.IN_PROGRESS
            return (
              <div key={p.id} onClick={() => onOpenPacket(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', borderTop: '1px solid #F8FAFC', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0F172A' }}>{p.providerName || `NPI ${p.npi}`}</span>
                  <span style={{ fontSize: 11.5, color: '#94A3B8', marginLeft: 8 }}>{p.cycle === 'RENEWAL' ? 'Renewal' : 'Initial'} · {fmtShortDate(p.createdAt)}</span>
                </div>
                <div style={{ width: 120, height: 6, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${p.completeness}%`, height: '100%', background: p.completeness >= 100 ? '#16A34A' : '#2563EB', borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#475569', width: 38, textAlign: 'right' }}>{p.completeness}%</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: ps.bg, color: ps.fg }}>{ps.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!window.confirm(`Delete the packet for ${p.providerName || p.npi}? Tasks and signatures on it are removed; the template and passport are untouched.`)) return
                    credMapAPI.deletePacket(p.id).then(loadPackets).catch((err) => setError(err.message))
                  }}
                  title="Delete packet"
                  style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: 15, cursor: 'pointer', padding: '0 2px', fontWeight: 700 }}
                >×</button>
              </div>
            )
          })}
        </div>
      )}

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Items, grouped by section */}
      {grouped.map((g) => (
        <div key={g.section + g.items[0].id} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{g.section}</div>
          {g.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              taxonomy={taxonomy}
              dragging={dragId === item.id}
              dragTarget={dragOverId === item.id && dragId !== item.id}
              dragHandlers={{
                onDragStart: (e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move' },
                onDragEnd: () => { setDragId(null); setDragOverId(null) },
                onDragOver: (e) => { e.preventDefault(); setDragOverId(item.id) },
                onDrop: (e) => { e.preventDefault(); handleDrop(item) },
              }}
              onUpdate={(data) => patchItem(item.id, data)}
              onDelete={() => removeItem(item.id)}
            />
          ))}
        </div>
      ))}

      {/* Add item */}
      {addOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 10, padding: '10px 14px' }}>
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') setAddOpen(false) }}
            placeholder="Requirement as the facility words it…"
            style={{ flex: 1, fontSize: 13.5, border: 'none', outline: 'none', color: '#0F172A' }}
          />
          <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ fontSize: 12, color: '#64748B', padding: '5px 8px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
            {taxonomy.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <button onClick={addItem} style={{ padding: '7px 14px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)} style={{ width: '100%', padding: '11px 0', background: 'none', border: '1px dashed #CBD5E1', borderRadius: 10, color: '#64748B', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Add requirement
        </button>
      )}

      {/* Danger zone — demo resets and dead maps. Maps with packets refuse
          to delete (409) until their packets are removed above. */}
      <div style={{ marginTop: 26, textAlign: 'right' }}>
        <button
          onClick={() => {
            if (!window.confirm(`Delete the application template "${map.name}" and all its requirements? Packets must be deleted first; this cannot be undone.`)) return
            credMapAPI.deleteMap(mapId).then(onBack).catch((err) => setError(err.message))
          }}
          style={{ background: 'none', border: 'none', color: '#DC2626', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, opacity: 0.7 }}
        >
          Delete this application template
        </button>
      </div>

      {showGen && (
        <GeneratePacketModal
          map={map}
          onClose={() => setShowGen(false)}
          onGenerated={(packetId) => { setShowGen(false); loadPackets(); onOpenPacket(packetId) }}
        />
      )}

      {showFieldMap && (
        <FieldMappingPanel mapId={mapId} map={map} roster={roster} onClose={() => setShowFieldMap(false)} />
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CredMapPage() {
  useKalamFont()
  const [maps, setMaps] = useState(null)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [taxonomy, setTaxonomy] = useState([])
  const [notes, setNotes] = useState([])
  const [openMapId, setOpenMapId] = useState(null)
  const [openPacketId, setOpenPacketId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [tab, setTab] = useState('maps') // 'maps' | 'renewals'
  const [error, setError] = useState('')

  const loadMaps = () => credMapAPI.getMaps().then((d) => { setMaps(d.maps); setAiAvailable(d.aiAvailable) }).catch((e) => setError(e.message))
  const loadNotes = () => credMapAPI.getNotes().then((d) => setNotes(d.notes)).catch(() => {})

  useEffect(() => {
    loadMaps(); loadNotes()
    credMapAPI.getTaxonomy().then((d) => setTaxonomy(d.taxonomy)).catch(() => {})
  }, [])

  async function handleAnalyze(files, name) {
    const { map } = await credMapAPI.analyzePacket(files, name)
    await loadMaps()
    setShowNew(false)
    setOpenMapId(map.id)
  }

  async function handleCreate(name, useStarter) {
    const { map } = await credMapAPI.createMap(name, useStarter)
    await loadMaps()
    setShowNew(false)
    setOpenMapId(map.id)
  }

  if (openPacketId) {
    return <PacketWorkspace packetId={openPacketId} onBack={() => setOpenPacketId(null)} />
  }

  if (openMapId) {
    return (
      <MapBuilder
        mapId={openMapId}
        taxonomy={taxonomy}
        onBack={() => { setOpenMapId(null); loadMaps() }}
        onChanged={() => {}}
        onOpenPacket={(id) => setOpenPacketId(id)}
      />
    )
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>Facility Applications</h1>
          <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 4 }}>
            Set up each facility's application template once — then any provider's packet builds itself from the passport, renewals included.
          </div>
        </div>
        {tab === 'maps' && (
          <button onClick={() => setShowNew(true)} style={{ padding: '11px 20px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
            + New facility
          </button>
        )}
      </div>

      {/* Maps / Renewals tabs */}
      <div style={{ display: 'flex', gap: 4, margin: '16px 0 0', borderBottom: '1px solid #E2E8F0' }}>
        {[['maps', '📦 Facilities'], ['renewals', '🔄 Renewals']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', background: 'none',
              border: 'none', borderBottom: `2.5px solid ${tab === key ? '#2563EB' : 'transparent'}`,
              color: tab === key ? '#2563EB' : '#64748B', marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'maps' && (
        <div style={{ margin: '20px 0 0' }}>
          <StickyNotesStrip
            notes={notes}
            onAdd={async (text, color) => { await credMapAPI.addNote({ text, color }); loadNotes() }}
            onDone={async (n) => { await credMapAPI.updateNote(n.id, { done: true }); loadNotes() }}
            onDelete={async (n) => { await credMapAPI.deleteNote(n.id); loadNotes() }}
          />
        </div>
      )}

      {error && <div style={{ padding: '9px 13px', background: '#FEE2E2', borderRadius: 8, color: '#DC2626', fontSize: 13, marginBottom: 12, marginTop: tab === 'renewals' ? 20 : 0 }}>{error}</div>}

      {tab === 'renewals' ? (
        <div style={{ marginTop: 20 }}>
          <RenewalsView maps={maps || []} onOpenPacket={(id) => setOpenPacketId(id)} />
        </div>
      ) : maps === null ? (
        <div style={{ color: '#94A3B8', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : maps.length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>🗺️</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginTop: 10 }}>No facility applications set up yet</div>
          <div style={{ fontSize: 13.5, color: '#64748B', marginTop: 6, maxWidth: 440, margin: '6px auto 0' }}>
            Upload a facility's blank application and SNAP learns their whole template in about a minute. Set it up once — it works for every provider, every renewal.
          </div>
          <button onClick={() => setShowNew(true)} style={{ marginTop: 18, padding: '11px 22px', background: '#2563EB', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
            ✨ Set up your first facility
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
          {maps.map((m) => (
            <div
              key={m.id}
              onClick={() => setOpenMapId(m.id)}
              style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '18px 20px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', lineHeight: 1.3 }}>{m.name}</div>
                <StatusPill status={m.status} />
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
                {m.stats.itemCount} requirements
                {m.recredCycleMonths ? ` · recred every ${m.recredCycleMonths} mo` : ''}
                {m._count?.packets ? ` · ${m._count.packets} packets` : ''}
              </div>
              <div style={{ marginTop: 14 }}>
                <AutoFillBar stats={m.stats} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewMapModal
          aiAvailable={aiAvailable}
          onClose={() => setShowNew(false)}
          onAnalyze={handleAnalyze}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
