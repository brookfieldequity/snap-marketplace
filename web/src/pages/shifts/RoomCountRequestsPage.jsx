import React, { useState, useEffect, useMemo } from 'react'
import { facilityAPI } from '../../api.js'

// Coordinator side of the Facility Room-Count Card: store 1-2 contacts per
// site, one-click send the monthly tokenized link to each site, and watch the
// status board. Returned cards feed the schedule builder as the demand source.

const NAVY = '#0F172A', ROYAL = '#2563EB', SLATE = '#475569', MUTED = '#94A3B8', LINE = '#E2E8F0'
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const STATUS_META = {
  RETURNED: { label: 'Returned', bg: '#F0FDF4', fg: '#166534', bd: '#BBF7D0' },
  SENT: { label: 'Awaiting', bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE' },
  LOCKED_NO_RESPONSE: { label: 'No response', bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A' },
  NOT_SENT: { label: 'Not sent', bg: '#F1F5F9', fg: '#64748B', bd: '#E2E8F0' },
}

// Default target = next month.
function defaultTarget() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
function defaultDeadline(year, month) {
  // 25th of the month before the target (schedules get built end of prior month).
  const d = new Date(year, month - 1, 0) // last day of prior month
  d.setDate(Math.min(25, d.getDate()))
  return d.toISOString().slice(0, 10)
}

export default function RoomCountRequestsPage() {
  const init = defaultTarget()
  const [year, setYear] = useState(init.year)
  const [month, setMonth] = useState(init.month)
  const [deadline, setDeadline] = useState(defaultDeadline(init.year, init.month))
  const [locations, setLocations] = useState([]) // [{location, contacts:[{id,name,email}]}]
  const [status, setStatus] = useState({}) // location -> row
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newContact, setNewContact] = useState({}) // location -> {name,email}

  async function load() {
    setLoading(true)
    try {
      const [locRes, statRes] = await Promise.all([
        facilityAPI.getRoomLocations(),
        facilityAPI.getRoomRequestStatus(year, month),
      ])
      setLocations(locRes.locations || [])
      const map = {}
      for (const r of statRes.locations || []) map[r.location] = r
      setStatus(map)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const withContacts = useMemo(() => locations.filter((l) => l.contacts.length > 0), [locations])

  async function addContact(location) {
    const c = newContact[location] || {}
    if (!c.email || !c.email.trim()) return
    try {
      await facilityAPI.addRoomContact({ location, name: c.name || '', email: c.email.trim() })
      setNewContact((p) => ({ ...p, [location]: { name: '', email: '' } }))
      await load()
    } catch (e) { alert(e.message || 'Could not add contact') }
  }
  async function removeContact(id) {
    try { await facilityAPI.deleteRoomContact(id); await load() } catch (e) { alert(e.message) }
  }

  async function sendAll() {
    if (!withContacts.length) return alert('Add at least one site contact first.')
    if (!window.confirm(`Send room-count requests for ${MONTHS[month]} ${year} to ${withContacts.length} site${withContacts.length === 1 ? '' : 's'}?`)) return
    setBusy(true)
    try {
      const res = await facilityAPI.sendRoomRequests({ year, month, deadline })
      const sent = (res.results || []).filter((r) => r.sent).length
      await load()
      alert(`Sent ${sent} request${sent === 1 ? '' : 's'}.`)
    } catch (e) { alert(e.message || 'Send failed') } finally { setBusy(false) }
  }

  async function remind(requestId) {
    try { await facilityAPI.remindRoomRequest(requestId); alert('Reminder sent.') } catch (e) { alert(e.message) }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 25, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: '-0.02em' }}>Room-Count Cards</h1>
          <p style={{ fontSize: 14, color: SLATE, margin: '6px 0 0', maxWidth: 560, lineHeight: 1.55 }}>
            Ask each site how many rooms will run each day next month, before you build the schedule. Returned counts
            become the source of truth in the Schedule Builder — so you staff to exactly what's running.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, margin: '18px 0 24px' }}>
        <Field label="Month">
          <select value={month} onChange={(e) => { const m = Number(e.target.value); setMonth(m); setDeadline(defaultDeadline(year, m)) }} style={ctrl}>
            {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); setDeadline(defaultDeadline(y, month)) }} style={ctrl}>
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Submit by">
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={ctrl} />
        </Field>
        <button onClick={sendAll} disabled={busy || !withContacts.length} style={{ ...primaryBtn, opacity: busy || !withContacts.length ? 0.6 : 1 }}>
          {busy ? 'Sending…' : `Send to ${withContacts.length} site${withContacts.length === 1 ? '' : 's'} →`}
        </button>
      </div>

      {loading ? (
        <div style={{ color: MUTED, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : locations.length === 0 ? (
        <Empty />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {locations.map(({ location, contacts }) => {
            const st = status[location] || { status: 'NOT_SENT' }
            const meta = STATUS_META[st.status] || STATUS_META.NOT_SENT
            const nc = newContact[location] || { name: '', email: '' }
            return (
              <div key={location} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '16px 18px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>{location}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: meta.fg, background: meta.bg, border: `1px solid ${meta.bd}`, padding: '4px 10px', borderRadius: 999 }}>{meta.label}</span>
                    {st.status === 'RETURNED' && (
                      <span style={{ fontSize: 12.5, color: SLATE }}>{st.daysSubmitted} days · {st.submittedAt ? new Date(st.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                    )}
                    {(st.status === 'SENT' || st.status === 'LOCKED_NO_RESPONSE') && st.requestId && (
                      <button onClick={() => remind(st.requestId)} style={ghostBtn}>Remind</button>
                    )}
                  </div>
                </div>

                {/* Contacts */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
                  {contacts.map((c) => (
                    <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: SLATE, background: '#F1F5F9', border: `1px solid ${LINE}`, borderRadius: 8, padding: '5px 8px 5px 10px' }}>
                      {c.name ? <strong style={{ color: NAVY, fontWeight: 700 }}>{c.name}</strong> : null} {c.email}
                      <button onClick={() => removeContact(c.id)} aria-label="Remove contact" style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    </span>
                  ))}
                  {contacts.length < 2 && (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input placeholder="Name (optional)" value={nc.name} onChange={(e) => setNewContact((p) => ({ ...p, [location]: { ...nc, name: e.target.value } }))} style={{ ...miniInput, width: 130 }} />
                      <input placeholder="site-scheduler@email" value={nc.email} onChange={(e) => setNewContact((p) => ({ ...p, [location]: { ...nc, email: e.target.value } }))} style={{ ...miniInput, width: 190 }} />
                      <button onClick={() => addContact(location)} style={ghostBtn}>Add</button>
                    </span>
                  )}
                  {contacts.length === 0 && <span style={{ fontSize: 12.5, color: MUTED }}>Add a site contact to send this location a card.</span>}
                </div>

                {/* Day notes the site left */}
                {st.notes && st.notes.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      ✎ {st.notes.length} day note{st.notes.length === 1 ? '' : 's'} from the site
                    </div>
                    {st.notes.map((n) => (
                      <div key={n.date} style={{ fontSize: 13, color: SLATE, lineHeight: 1.5 }}>
                        <strong style={{ color: NAVY }}>{new Date(n.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>
                        {' '}({n.roomsRequired} rm{n.roomsRequired === 1 ? '' : 's'}): {n.note}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  )
}
function Empty() {
  return (
    <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: MUTED }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: SLATE, marginBottom: 6 }}>No locations yet</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>Locations come from your coverage templates. Set up a coverage template with your sites, then add a contact for each here.</div>
    </div>
  )
}

const ctrl = { fontSize: 14, fontWeight: 600, color: NAVY, border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 12px', background: '#fff' }
const miniInput = { fontSize: 13, color: NAVY, border: `1px solid ${LINE}`, borderRadius: 7, padding: '6px 9px', background: '#fff' }
const primaryBtn = { padding: '11px 20px', background: ROYAL, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.3)', marginLeft: 'auto' }
const ghostBtn = { padding: '6px 12px', background: '#fff', color: ROYAL, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
