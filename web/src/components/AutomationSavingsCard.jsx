import { useEffect, useState } from 'react'

/**
 * Cost-savings widget — time-saved by SNAP automation, valued at $50/hour
 * (the rate is set server-side in services/automationEvents.js).
 *
 * Reusable across surfaces:
 *   - Credentialing facility portal dashboard  (fetcher = credentialAPI.getSavings)
 *   - SNAP Shifts / marketplace dashboard     (fetcher = facilityAPI.getSavings)
 *   - SNAP admin aggregate page               (fetcher = adminAPI.getAutomationSavingsAggregate)
 *
 * Props:
 *   fetcher  () => Promise<{thisWeek, thisMonth, total}> — required
 *   title    string                                       — header label
 *   subtitle string                                       — small explainer under header
 *   accent   hex color for the big number + border         — defaults to green
 */
export default function AutomationSavingsCard({
  fetcher,
  title = 'Time Saved by SNAP Automation',
  subtitle = 'Hours your team would have spent on manual work',
  accent = '#10B981',
}) {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('thisMonth')
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    fetcher()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => { if (alive) setError(e?.message || 'Unable to load savings') })
    return () => { alive = false }
  }, [fetcher])

  const current = data?.[period] || { dollarsSaved: 0, hoursSaved: 0, eventCount: 0 }

  const periodOptions = [
    { key: 'thisWeek', label: 'This Week' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'total', label: 'Total' },
  ]

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)',
        borderRadius: 16,
        border: `1px solid ${accent}40`,
        padding: '24px 28px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle glow accent in the background */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 160,
          height: 160,
          background: `radial-gradient(circle, ${accent}1C 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Header row: title + period toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 18,
          position: 'relative',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>💰</span>
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{subtitle}</div>
          ) : null}
        </div>

        <div
          style={{
            display: 'inline-flex',
            background: '#F1F5F9',
            borderRadius: 8,
            padding: 2,
            flexShrink: 0,
          }}
        >
          {periodOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: period === opt.key ? '#FFFFFF' : 'transparent',
                color: period === opt.key ? '#0F172A' : '#64748B',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: period === opt.key ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                transition: 'all 120ms ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div style={{ padding: '12px 0', color: '#94A3B8', fontSize: 13, position: 'relative' }}>
          Couldn't load savings data.
        </div>
      ) : data === null ? (
        <div style={{ padding: '12px 0', color: '#94A3B8', fontSize: 13, position: 'relative' }}>Loading…</div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div
            style={{
              fontSize: 52,
              fontWeight: 900,
              color: accent,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              marginBottom: 8,
            }}
          >
            ${current.dollarsSaved.toLocaleString()}
          </div>
          <div style={{ fontSize: 14, color: '#475569', fontWeight: 500 }}>
            {current.hoursSaved} hours of admin time saved
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
            from {current.eventCount} automated{' '}
            {current.eventCount === 1 ? 'action' : 'actions'}
          </div>
        </div>
      )}
    </div>
  )
}
