import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { facilityAPI } from '../../api.js'

// Coordinator view of provider schedule requests (Task #21 + tiered triage).
//
// Providers ask for a day off or to work a date/site. Instead of a flat
// accept/decline, the coordinator triages WORK + DAY_OFF requests into four
// PRIORITY TIERS the schedule builder honors in order. Within a tier, requests
// auto-seed by seniority → first-come; the coordinator can then reorder them by
// hand. After a build, the build flow shows which requests made the schedule.
//
//   1 Locked   — honor unless literally impossible to cover the room.
//   2 Strong   — honor if at all possible (break only for OT/agency cost or an
//                uncovered room).
//   3 Moderate — honor only if it doesn't meaningfully disrupt the schedule.
//   4 Loose    — honor only if it costs nothing (a free slot already exists).
//
// PTO requests aren't tiered — they keep simple accept/decline (the PTO Builder
// owns ranked PTO allocation).

const TIERS = [
  { n: 1, label: 'Locked',   blurb: 'Honor unless impossible to cover',  color: '#6D28D9', bg: '#F5F3FF', border: '#DDD6FE' },
  { n: 2, label: 'Strong',   blurb: 'Honor if at all possible',          color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  { n: 3, label: 'Moderate', blurb: "If it doesn't disrupt much",        color: '#0E7490', bg: '#ECFEFF', border: '#A5F3FC' },
  { n: 4, label: 'Loose',    blurb: 'Only if it costs nothing',          color: '#475569', bg: '#F8FAFC', border: '#E2E8F0' },
]
const TIER_BY_N = Object.fromEntries(TIERS.map((t) => [t.n, t]))

const TYPE_STYLE = {
  DAY_OFF: { bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5', label: 'Wants off' },
  WORK:    { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Wants to work' },
  PTO:     { bg: '#EEF2FF', color: '#4338CA', border: '#C7D2FE', label: '🌴 PTO' },
}
const STATUS_STYLE = {
  PENDING:  { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', label: 'Pending' },
  ACCEPTED: { bg: '#ECFDF5', color: '#047857', border: '#6EE7B7', label: 'Accepted' },
  DECLINED: { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1', label: 'Declined' },
}

function fmtDate(d) {
  return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}
function dateLabel(r) {
  return r.endDate && String(r.endDate).slice(0, 10) > String(r.date).slice(0, 10)
    ? `${fmtDate(r.date)} – ${fmtDate(r.endDate)}`
    : fmtDate(r.date)
}

// Auto-seed order within a tier: most senior first (lower seniorityRank), then
// earliest request. Matches the builder's tie-break seed.
function seedSort(a, b) {
  const as = a.rosterEntry?.seniorityRank, bs = b.rosterEntry?.seniorityRank
  if (as != null || bs != null) return (as ?? 1e9) - (bs ?? 1e9)
  return new Date(a.createdAt) - new Date(b.createdAt)
}

export default function RequestsPage() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('TRIAGE')
  const [busy, setBusy] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Admin "log a request on a provider's behalf" modal + its roster/site data.
  const [showAdd, setShowAdd] = useState(false)
  const [roster, setRoster] = useState([])
  const [locations, setLocations] = useState([])
  // Working copy of tierable (WORK/DAY_OFF) requests during triage. Each carries
  // _status / _tier; array order defines the within-tier manual order.
  const [work, setWork] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    facilityAPI.getScheduleRequests()
      .then((r) => setRequests(r.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // (Re)seed the triage working copy whenever requests reload. Tierable =
  // WORK/DAY_OFF that are still PENDING, OR already ACCEPTED (so the coordinator
  // can re-tier them). Ordered: by tier, then manual order ?? seniority seed.
  useEffect(() => {
    const tierable = requests.filter(
      (r) => (r.type === 'WORK' || r.type === 'DAY_OFF') && r.status !== 'DECLINED'
    )
    const triaged = tierable.filter((r) => r.status === 'ACCEPTED' && r.tier)
    const untriaged = tierable.filter((r) => !(r.status === 'ACCEPTED' && r.tier))
    const ordered = []
    for (const t of TIERS) {
      triaged
        .filter((r) => r.tier === t.n)
        .sort((a, b) => {
          if (a.manualOrder != null || b.manualOrder != null) {
            return (a.manualOrder ?? 1e9) - (b.manualOrder ?? 1e9)
          }
          return seedSort(a, b)
        })
        .forEach((r) => ordered.push(r))
    }
    untriaged.sort(seedSort).forEach((r) => ordered.push(r))
    setWork(
      ordered.map((r) => ({
        ...r,
        _status: r.status === 'ACCEPTED' && r.tier ? 'ACCEPTED' : 'PENDING',
        _tier: r.status === 'ACCEPTED' && r.tier ? r.tier : null,
      }))
    )
    setSaved(false)
  }, [requests])

  const ptoPending = requests.filter((r) => r.type === 'PTO' && r.status === 'PENDING')

  // ── Triage mutations (local until Save) ──────────────────────────────────
  const assignTier = (id, tier) => {
    setSaved(false)
    setWork((prev) => {
      const item = prev.find((w) => w.id === id)
      if (!item) return prev
      const arr = prev.filter((w) => w.id !== id)
      const moved = { ...item, _status: 'ACCEPTED', _tier: tier }
      // Insert just after the last item already in this tier (keeps tiers grouped).
      let insertAt = arr.length
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i]._status === 'ACCEPTED' && arr[i]._tier === tier) { insertAt = i + 1; break }
      }
      arr.splice(insertAt, 0, moved)
      return arr
    })
  }
  const setItemStatus = (id, status) => {
    setSaved(false)
    setWork((prev) => prev.map((w) => (w.id === id ? { ...w, _status: status, _tier: null } : w)))
  }
  const move = (id, dir) => {
    setSaved(false)
    setWork((prev) => {
      const arr = [...prev]
      const idx = arr.findIndex((w) => w.id === id)
      if (idx < 0) return prev
      const tier = arr[idx]._tier
      const peers = arr
        .map((w, i) => ({ w, i }))
        .filter((x) => x.w._status === 'ACCEPTED' && x.w._tier === tier)
        .map((x) => x.i)
      const pos = peers.indexOf(idx)
      const swap = dir === 'up' ? peers[pos - 1] : peers[pos + 1]
      if (swap == null) return prev
      ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
      return arr
    })
  }

  async function saveTriage() {
    setSaving(true)
    try {
      // manualOrder = position within the item's tier group.
      const counters = {}
      const items = work.map((w) => {
        let manualOrder = null
        if (w._status === 'ACCEPTED' && w._tier) {
          manualOrder = counters[w._tier] || 0
          counters[w._tier] = manualOrder + 1
        }
        return { id: w.id, status: w._status, tier: w._tier, manualOrder }
      })
      await facilityAPI.triageScheduleRequests(items)
      setSaved(true)
      load()
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  function openAdd() {
    setShowAdd(true)
    // Lazy-load the roster (provider picker) + known sites the first time.
    if (roster.length === 0) facilityAPI.getRoster().then((r) => setRoster(Array.isArray(r) ? r : r?.roster || [])).catch(() => {})
    if (locations.length === 0) facilityAPI.getRosterLocations().then((r) => setLocations(r?.locations || [])).catch(() => {})
  }

  async function decidePto(id, decision) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await facilityAPI.decideScheduleRequest(id, decision)
      load()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const untriaged = work.filter((w) => w._status === 'PENDING')
  const declined = work.filter((w) => w._status === 'DECLINED')
  const tierGroups = useMemo(
    () => TIERS.map((t) => ({ t, items: work.filter((w) => w._status === 'ACCEPTED' && w._tier === t.n) })),
    [work]
  )
  const pendingBadge = untriaged.length + ptoPending.length

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1040, margin: '0 auto' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Provider Requests</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, maxWidth: 760 }}>
            Sort day-off and work requests into priority tiers before you build the schedule. The builder honors higher tiers first; within a tier it goes by seniority, then first-come — drag the order with the arrows to override. PTO is approved separately and booked straight to the calendar.
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{ flexShrink: 0, padding: '10px 18px', background: '#0F172A', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
        >
          + Add request
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { k: 'TRIAGE', label: `Triage${pendingBadge ? ` (${pendingBadge})` : ''}` },
          { k: 'ACCEPTED', label: 'Accepted' },
          { k: 'DECLINED', label: 'Declined' },
          { k: 'ALL', label: 'All' },
        ].map(({ k, label }) => {
          const active = tab === k
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? '#2563EB' : '#fff',
                color: active ? '#fff' : '#64748B',
                border: `1.5px solid ${active ? '#2563EB' : '#E2E8F0'}`,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '50px 0', color: '#94A3B8' }}>Loading...</div>}

      {/* ── TRIAGE BOARD ─────────────────────────────────────────────────── */}
      {!loading && tab === 'TRIAGE' && (
        <>
          {work.length === 0 && ptoPending.length === 0 && (
            <EmptyState label="requests to triage" />
          )}

          {/* Untriaged pool */}
          {untriaged.length > 0 && (
            <Section
              title={`Needs a tier (${untriaged.length})`}
              subtitle="Pick a priority for each, or decline."
              accent="#92400E" accentBg="#FFFBEB" accentBorder="#FDE68A"
            >
              {untriaged.map((r) => (
                <TriageCard key={r.id} r={r} onTier={assignTier} onDecline={() => setItemStatus(r.id, 'DECLINED')} />
              ))}
            </Section>
          )}

          {/* Tier columns */}
          {tierGroups.map(({ t, items }) => (
            <Section
              key={t.n}
              title={`Tier ${t.n} · ${t.label}`}
              subtitle={t.blurb}
              accent={t.color} accentBg={t.bg} accentBorder={t.border}
              count={items.length}
            >
              {items.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94A3B8', padding: '6px 2px' }}>No requests in this tier.</div>
              ) : (
                items.map((r, i) => (
                  <TriageCard
                    key={r.id}
                    r={r}
                    rank={i + 1}
                    onTier={assignTier}
                    onDecline={() => setItemStatus(r.id, 'DECLINED')}
                    onUp={i > 0 ? () => move(r.id, 'up') : null}
                    onDown={i < items.length - 1 ? () => move(r.id, 'down') : null}
                  />
                ))
              )}
            </Section>
          ))}

          {/* Declined bin */}
          {declined.length > 0 && (
            <Section title={`Declined (${declined.length})`} accent="#64748B" accentBg="#F8FAFC" accentBorder="#E2E8F0">
              {declined.map((r) => (
                <TriageCard key={r.id} r={r} declined onTier={assignTier} onRestore={() => setItemStatus(r.id, 'PENDING')} />
              ))}
            </Section>
          )}

          {/* PTO (not tiered) */}
          {ptoPending.length > 0 && (
            <Section title={`PTO requests (${ptoPending.length})`} subtitle="Approving books it on the calendar and counts toward the provider's annual PTO." accent="#4338CA" accentBg="#EEF2FF" accentBorder="#C7D2FE">
              {ptoPending.map((r) => (
                <div key={r.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</div>
                      <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}><strong>{dateLabel(r)}</strong></div>
                      {r.note && <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, fontStyle: 'italic' }}>“{r.note}”</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => decidePto(r.id, 'accept')} disabled={busy[r.id]} style={btnSolid('#10B981')}>Approve</button>
                      <button onClick={() => decidePto(r.id, 'decline')} disabled={busy[r.id]} style={btnGhost('#B91C1C', '#FCA5A5')}>Decline</button>
                    </div>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Sticky save bar */}
          {work.length > 0 && (
            <div style={{ position: 'sticky', bottom: 0, marginTop: 24, padding: '14px 0', background: 'linear-gradient(to top, #F8FAFC 70%, rgba(248,250,252,0))', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              {saved && <span style={{ fontSize: 13, color: '#047857', fontWeight: 700 }}>✓ Saved — used on your next build</span>}
              <button
                onClick={saveTriage}
                disabled={saving}
                style={{ padding: '11px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 2px 6px rgba(37,99,235,0.3)' }}
              >
                {saving ? 'Saving…' : 'Save priorities'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── READ-ONLY TABS ───────────────────────────────────────────────── */}
      {!loading && tab !== 'TRIAGE' && (
        <ReadOnlyList requests={requests} tab={tab} />
      )}

      {showAdd && (
        <AddRequestModal
          roster={roster}
          locations={locations}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); setTab('TRIAGE'); load() }}
        />
      )}
    </div>
  )
}

// ── Admin "log a request on a provider's behalf" modal ───────────────────────
function AddRequestModal({ roster, locations, onClose, onCreated }) {
  const [form, setForm] = useState({ rosterEntryId: '', type: 'WORK', date: '', endDate: '', siteName: '', note: '', tier: 2 })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.rosterEntryId) return setErr('Pick a provider.')
    if (!form.date) return setErr('Pick a date.')
    setSaving(true); setErr(null)
    try {
      await facilityAPI.createFacilityScheduleRequest({
        rosterEntryId: form.rosterEntryId,
        type: form.type,
        date: form.date,
        endDate: form.endDate || null,
        siteName: form.type === 'WORK' ? form.siteName || null : null,
        note: form.note || null,
        tier: form.tier,
      })
      onCreated()
    } catch (e) {
      setErr(e.message || 'Failed to add request')
    } finally {
      setSaving(false)
    }
  }

  const label = { fontSize: 12.5, fontWeight: 700, color: '#475569', marginBottom: 5, display: 'block' }
  const input = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1.5px solid #E2E8F0', fontSize: 14, color: '#0F172A', boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Add a request</div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 18 }}>Logged on the provider's behalf and pre-accepted at the tier you choose.</div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Provider</label>
          <select style={input} value={form.rosterEntryId} onChange={(e) => set('rosterEntryId', e.target.value)}>
            <option value="">Select a provider…</option>
            {[...roster].sort((a, b) => (a.providerName || '').localeCompare(b.providerName || '')).map((r) => (
              <option key={r.id} value={r.id}>{r.providerName}{r.providerType ? ` · ${r.providerType}` : ''}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ k: 'WORK', l: 'Wants to work' }, { k: 'DAY_OFF', l: 'Wants off' }].map(({ k, l }) => {
              const active = form.type === k
              return (
                <button key={k} onClick={() => set('type', k)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: active ? '#2563EB' : '#fff', color: active ? '#fff' : '#475569', border: `1.5px solid ${active ? '#2563EB' : '#E2E8F0'}` }}>{l}</button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Date</label>
            <input type="date" style={input} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>End date <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span></label>
            <input type="date" style={input} value={form.endDate} min={form.date || undefined} onChange={(e) => set('endDate', e.target.value)} />
          </div>
        </div>

        {form.type === 'WORK' && (
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Site <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span></label>
            <input list="req-sites" style={input} value={form.siteName} placeholder="Any site" onChange={(e) => set('siteName', e.target.value)} />
            <datalist id="req-sites">
              {locations.map((l) => <option key={l} value={l} />)}
            </datalist>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Priority tier</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {TIERS.map((t) => {
              const active = form.tier === t.n
              return (
                <button key={t.n} title={t.blurb} onClick={() => set('tier', t.n)} style={{ flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: active ? t.color : '#fff', color: active ? '#fff' : t.color, border: `1.5px solid ${active ? t.color : t.border}` }}>
                  {t.n} {t.label}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 5 }}>{TIER_BY_N[form.tier]?.blurb}</div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={label}>Note <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span></label>
          <input style={input} value={form.note} placeholder="e.g. Confirmed by phone" onChange={(e) => set('note', e.target.value)} />
        </div>

        {err && <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={btnGhost('#475569', '#E2E8F0')}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...btnSolid('#2563EB'), opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Adding…' : 'Add request'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Card with tier controls ──────────────────────────────────────────────────
function TriageCard({ r, rank, onTier, onDecline, onRestore, onUp, onDown, declined }) {
  const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
  return (
    <div style={{ ...cardStyle, opacity: declined ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Reorder arrows (only inside a tier) */}
        {(onUp || onDown) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ArrowBtn dir="up" onClick={onUp} disabled={!onUp} />
            <ArrowBtn dir="down" onClick={onDown} disabled={!onDown} />
          </div>
        )}
        {rank != null && (
          <div style={{ width: 22, textAlign: 'center', fontWeight: 800, color: '#94A3B8', fontSize: 14 }}>{rank}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
            <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{t.label}</span>
            {r.rosterEntry?.providerType && <span style={{ color: '#94A3B8', fontSize: 12 }}>{r.rosterEntry.providerType}</span>}
          </div>
          <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
            <strong>{dateLabel(r)}</strong>
            {r.siteName ? <span style={{ color: '#64748B' }}> · {r.siteName}</span> : null}
          </div>
          {r.note && <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, fontStyle: 'italic' }}>“{r.note}”</div>}
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {declined ? (
            <button onClick={onRestore} style={btnGhost('#2563EB', '#BFDBFE')}>Restore</button>
          ) : (
            <>
              {TIERS.map((tier) => {
                const active = r._tier === tier.n
                return (
                  <button
                    key={tier.n}
                    title={`Tier ${tier.n} · ${tier.label} — ${tier.blurb}`}
                    onClick={() => onTier(r.id, tier.n)}
                    style={{
                      width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 800,
                      background: active ? tier.color : '#fff',
                      color: active ? '#fff' : tier.color,
                      border: `1.5px solid ${active ? tier.color : tier.border}`,
                    }}
                  >
                    {tier.n}
                  </button>
                )
              })}
              <button onClick={onDecline} title="Decline" style={{ ...btnGhost('#B91C1C', '#FCA5A5'), padding: '7px 10px' }}>✕</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ArrowBtn({ dir, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: 22, height: 18, lineHeight: '14px', padding: 0, borderRadius: 5, fontSize: 10, cursor: disabled ? 'default' : 'pointer', background: '#fff', color: disabled ? '#CBD5E1' : '#475569', border: '1px solid #E2E8F0' }}
    >
      {dir === 'up' ? '▲' : '▼'}
    </button>
  )
}

function Section({ title, subtitle, count, accent, accentBg, accentBorder, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ display: 'inline-block', fontSize: 13, fontWeight: 800, color: accent, background: accentBg, border: `1px solid ${accentBorder}`, padding: '3px 10px', borderRadius: 8 }}>{title}{count != null ? ` · ${count}` : ''}</span>
        {subtitle && <span style={{ fontSize: 12.5, color: '#94A3B8' }}>{subtitle}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function EmptyState({ label }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>✋</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>No {label}</div>
      <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Requests your providers submit from the SNAP app appear here.</div>
    </div>
  )
}

function ReadOnlyList({ requests, tab }) {
  const visible = requests.filter((r) => (tab === 'ALL' ? true : r.status === tab))
  if (visible.length === 0) return <EmptyState label={`${tab === 'ALL' ? '' : tab.toLowerCase()} requests`} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {visible.map((r) => {
        const t = TYPE_STYLE[r.type] || TYPE_STYLE.WORK
        const s = STATUS_STYLE[r.status] || STATUS_STYLE.PENDING
        const tier = r.status === 'ACCEPTED' && r.tier ? TIER_BY_N[r.tier] : null
        return (
          <div key={r.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{r.rosterEntry?.providerName || 'Provider'}</span>
                  <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{t.label}</span>
                  <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>{s.label}</span>
                  {tier && <span style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}`, fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 20 }}>Tier {tier.n} · {tier.label}</span>}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginTop: 6 }}>
                  <strong>{dateLabel(r)}</strong>
                  {r.siteName ? <span style={{ color: '#64748B' }}> · {r.siteName}</span> : null}
                  {r.rosterEntry?.providerType ? <span style={{ color: '#94A3B8' }}> · {r.rosterEntry.providerType}</span> : null}
                </div>
                {r.note && <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, fontStyle: 'italic' }}>“{r.note}”</div>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const cardStyle = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }
const btnSolid = (bg) => ({ padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' })
const btnGhost = (color, border) => ({ padding: '8px 14px', background: '#fff', color, border: `1.5px solid ${border}`, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' })
