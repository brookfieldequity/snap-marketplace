import React, { useEffect, useState } from 'react'
import { facilityAPI } from '../api.js'

// Welcome checklist shown at the top of the facility dashboard. The
// principle (locked 2026-06-09 in facility-invite-spec.md):
//
//   "Welcome to {facility}, {name} 👋
//    Your facility is set up. Here's what's ready: …
//    Next steps: …"
//
// The component reads the actual facility state and:
//   - Renders green ✓ for items that are done.
//   - Renders hollow ☐ for items still to do, with a "Next step" CTA.
//   - Hides itself (returns null) when every checklist item is done — so
//     long-term users get a clean dashboard, not perpetual welcome wagon.

export default function FacilitySetupChecklist({ facility, onNavigate }) {
  const [roster, setRoster]       = useState(null)
  const [locations, setLocations] = useState(null)
  const [hasSchedule, setHasSchedule] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [dismissed, setDismissed] = useState(() => {
    // Per-facility dismissal — if the coordinator hit "I'm all set" once for
    // this facility, don't re-show the checklist.
    try { return localStorage.getItem(`snapChecklistDismissed:${facility?.id}`) === '1' } catch { return false }
  })

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      facilityAPI.getRoster(),
      facilityAPI.getRosterLocations(),
      facilityAPI.scheduleExists(),
    ]).then(([rRes, lRes, sRes]) => {
      if (cancelled) return
      setRoster(rRes.status === 'fulfilled' ? (rRes.value || []) : [])
      // /roster/locations returns { locations: [...] } — unwrap it.
      setLocations(lRes.status === 'fulfilled' ? (lRes.value?.locations || []) : [])
      setHasSchedule(sRes.status === 'fulfilled' ? !!sRes.value?.exists : false)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (dismissed) return null

  const rosterCount    = Array.isArray(roster) ? roster.length : 0
  const locationsCount = Array.isArray(locations) ? locations.length : 0
  // Heuristic for "facility info complete" — name + at least an address or
  // ZIP. Loose so the coordinator isn't blocked by an unset address.
  const facilityInfoDone = !!(facility?.name && (facility?.address || facility?.zipCode))
  const sitesDone        = locationsCount > 0
  const rosterDone       = rosterCount > 0
  // True once any schedule grid or build run exists for the facility
  // (across all months — a future-month build counts). See GET /schedule/exists.
  const firstScheduleDone = hasSchedule

  const allDone = facilityInfoDone && sitesDone && rosterDone && firstScheduleDone

  if (allDone) {
    // Once everything is done, fall through to dismiss + hide.
    try { localStorage.setItem(`snapChecklistDismissed:${facility?.id}`, '1') } catch {}
    return null
  }

  function dismiss() {
    try { localStorage.setItem(`snapChecklistDismissed:${facility?.id}`, '1') } catch {}
    setDismissed(true)
  }

  // Compose "next steps" — only show actions that map to unmet items.
  const nextSteps = []
  if (!facilityInfoDone) {
    nextSteps.push({
      label: 'Fill in your facility address',
      detail: 'Helps us locate the facility on maps + for shift posting.',
      action: () => onNavigate?.('profile'),
      cta: 'Edit profile',
    })
  }
  if (!sitesDone) {
    nextSteps.push({
      label: 'Add your sites (operating rooms / locations)',
      detail: 'You schedule providers into sites. Most ASCs have 1–6 sites.',
      action: () => onNavigate?.('coverage-templates'),
      cta: 'Configure sites',
    })
  }
  if (!rosterDone) {
    nextSteps.push({
      label: 'Upload your roster',
      detail: 'Drag in a CSV from your existing system, or add providers one-at-a-time.',
      action: () => onNavigate?.('roster'),
      cta: 'Open roster',
    })
  }
  if (sitesDone && rosterDone && !firstScheduleDone) {
    nextSteps.push({
      label: 'Build your first schedule',
      detail: 'SNAP can generate it for you based on your roster + coverage template.',
      action: () => onNavigate?.('schedule-builder'),
      cta: 'Build schedule',
    })
  }

  const greeting = greetingFor(facility?.name)

  return (
    <div style={styles.shell}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>{greeting}</h2>
          <p style={styles.subtitle}>Here’s what’s set up for {facility?.name || 'your facility'}, and what to do next.</p>
        </div>
        <button onClick={dismiss} title="Hide this for good" style={styles.dismiss}>I’m all set →</button>
      </div>

      <div style={styles.checklist}>
        <ChecklistRow done={facilityInfoDone}
          title="Facility info"
          detail={facilityInfoDone
            ? `${facility?.name}${facility?.state ? `, ${facility?.state}` : ''}${facility?.address ? ` · ${facility?.address}` : ''}`
            : 'Add an address to complete your facility profile.'}
        />
        <ChecklistRow done={sitesDone}
          title={`Sites (${locationsCount})`}
          detail={sitesDone
            ? namesPreview(locations)
            : 'Add the locations / operating rooms you schedule providers into.'}
          loading={loading && locations === null}
        />
        <ChecklistRow done={rosterDone}
          title={`Roster (${rosterCount})`}
          detail={rosterDone
            ? rosterPreview(roster)
            : 'Upload or add the providers who work at this facility.'}
          loading={loading && roster === null}
        />
        <ChecklistRow done={firstScheduleDone}
          title="First schedule"
          detail={firstScheduleDone ? 'Built.' : 'Build a schedule for your roster and let providers see their shifts.'}
        />
      </div>

      {nextSteps.length > 0 && (
        <div style={styles.nextSteps}>
          <div style={styles.nextStepsLabel}>Next steps</div>
          {nextSteps.map((s, i) => (
            <button key={i} onClick={s.action} style={styles.stepBtn}>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{s.detail}</div>
              </div>
              <div style={styles.stepCta}>{s.cta} →</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChecklistRow({ done, title, detail, loading }) {
  return (
    <div style={styles.row}>
      <div style={{ ...styles.bullet, background: done ? '#10B981' : 'transparent', borderColor: done ? '#10B981' : '#CBD5E1', color: done ? '#fff' : '#94A3B8' }}>
        {done ? '✓' : '○'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={styles.rowTitle}>{title}</div>
        <div style={styles.rowDetail}>{loading ? '…' : detail}</div>
      </div>
    </div>
  )
}

function greetingFor(facilityName) {
  const hour = new Date().getHours()
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${timeOfDay} — welcome to ${facilityName || 'SNAP Medical'} 👋`
}

function namesPreview(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return ''
  const names = arr.map((l) => l?.facilityName || l?.name).filter(Boolean)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
}

function rosterPreview(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return ''
  // Mix the first 1–2 names with a type summary so it reads at a glance.
  const sample = arr.slice(0, 2).map((r) => r.providerName).filter(Boolean).join(', ')
  const types = arr.reduce((acc, r) => {
    if (r.providerType) acc[r.providerType] = (acc[r.providerType] || 0) + 1
    return acc
  }, {})
  const typeSummary = Object.entries(types)
    .map(([t, n]) => `${n} ${t === 'CRNA' ? 'CRNA' : t === 'ANESTHESIOLOGIST' ? 'anesthesiologist' : t.toLowerCase()}${n > 1 && t !== 'CRNA' ? 's' : ''}`)
    .join(' · ')
  return [sample, typeSummary].filter(Boolean).join(' · ')
}

const styles = {
  shell: {
    background: '#fff',
    border: '1px solid #E2E8F0',
    borderRadius: 16,
    boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
    padding: '24px 28px',
    marginBottom: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: '#0F172A',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: '#64748B',
  },
  dismiss: {
    background: 'transparent',
    border: 'none',
    color: '#94A3B8',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
    padding: '4px 8px',
  },
  checklist: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingBottom: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  bullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    border: '2px solid #CBD5E1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    flexShrink: 0,
    marginTop: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0F172A',
  },
  rowDetail: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 1.4,
  },
  nextSteps: {
    marginTop: 20,
    paddingTop: 18,
    borderTop: '1px solid #F1F5F9',
  },
  nextStepsLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748B',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  stepBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 12,
    padding: '12px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    marginBottom: 8,
    transition: 'background 0.15s',
  },
  stepCta: {
    background: '#6366F1',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
}
