import React, { useState } from 'react'
import { facilityAPI } from '../../api.js'

/**
 * StaffIQ CRNA-gap recommendations (Task #26).
 *
 * Given a run's staffiqRecommendations ({ gaps, totalProjectedSavings }),
 * renders the dollar opportunity and lets the coordinator fire an incentive
 * shift per gap — tuning the rate / start time / duration before sending.
 * The incentive shift notifies the roster and can be escalated to the public
 * marketplace from the Gaps page if no internal CRNA takes it.
 *
 * Used in two places: the build compare cards (compact) and the post-select
 * ScheduleBuilderPage (full).
 */

const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`

function GapRow({ gap, compact }) {
  // Default offered rate: a premium between the standard CRNA rate and the
  // break-even ceiling — gives the facility part of the savings, the CRNA a
  // real incentive.
  const defaultRate = Math.max(
    gap.recommendedCrnaRate,
    Math.round((gap.recommendedCrnaRate + gap.maxCrnaRate) / 2)
  )
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState(defaultRate)
  const [startTime, setStartTime] = useState('07:00')
  const [duration, setDuration] = useState(8)
  const [status, setStatus] = useState(null) // null | 'creating' | 'created' | 'error'

  async function confirm() {
    setStatus('creating')
    try {
      const shiftDate = new Date(gap.date)
      const twoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      await facilityAPI.createIncentiveShift({
        shiftDate: gap.date,
        startTime,
        durationHours: Number(duration),
        facilityLocation: gap.location,
        incentiveRate: Number(rate),
        providerTypeRequired: 'CRNA',
        responseDeadline: (twoDays < shiftDate ? twoDays : shiftDate).toISOString(),
      })
      setStatus('created')
      setOpen(false)
    } catch {
      setStatus('error')
    }
  }

  const aboveCeiling = Number(rate) > gap.maxCrnaRate

  return (
    <div style={S.gapRow}>
      <div style={S.gapText}>
        <strong>{gap.location}</strong> · {gap.date} — short {gap.crnaShortfall} CRNA
        {gap.crnaShortfall === 1 ? '' : 's'} (save {fmtMoney(gap.projectedSavingsPerDay)}/day, pay up to ${gap.maxCrnaRate}/hr)
      </div>

      {status === 'created' ? (
        <span style={S.sentTag}>✓ Incentive shift sent to roster</span>
      ) : !open ? (
        <button style={S.btn} onClick={() => setOpen(true)}>Create incentive shift</button>
      ) : (
        <div style={S.tuneBox}>
          <div style={S.tuneRow}>
            <label style={S.tuneLabel}>Rate $/hr
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} style={S.tuneInput} />
            </label>
            <label style={S.tuneLabel}>Start
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={S.tuneInput} />
            </label>
            <label style={S.tuneLabel}>Hours
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ ...S.tuneInput, width: 56 }} />
            </label>
          </div>
          {aboveCeiling && (
            <div style={S.warn}>Above the ${gap.maxCrnaRate}/hr break-even — you'd lose money vs the MD backfill.</div>
          )}
          <div style={S.tuneActions}>
            <button style={S.btnGhost} onClick={() => setOpen(false)} disabled={status === 'creating'}>Cancel</button>
            <button style={S.btn} onClick={confirm} disabled={status === 'creating'}>
              {status === 'creating' ? 'Sending…' : 'Send to roster'}
            </button>
          </div>
        </div>
      )}
      {status === 'error' && <div style={S.warn}>Couldn't create the shift. Try again.</div>}
    </div>
  )
}

export default function StaffIQRecommendations({ recommendations, compact = false }) {
  const rec = recommendations
  if (!rec || !rec.gaps || rec.gaps.length === 0 || !(rec.totalProjectedSavings > 0)) return null

  const gaps = compact ? rec.gaps.slice(0, 4) : rec.gaps

  return (
    <div style={{ ...S.block, ...(compact ? {} : S.blockFull) }}>
      <div style={S.header}>🧠 StaffIQ: save {fmtMoney(rec.totalProjectedSavings)}/day</div>
      <div style={S.sub}>
        Rooms are covered by MDs where CRNAs ran short. Incentivize CRNAs to swap in — cheaper than an MD in the room.
      </div>
      {gaps.map((g) => (
        <GapRow key={g.scheduleDayId} gap={g} compact={compact} />
      ))}
      {compact && rec.gaps.length > 4 && (
        <div style={S.more}>+ {rec.gaps.length - 4} more on the schedule page</div>
      )}
    </div>
  )
}

const S = {
  block: { marginTop: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: 10 },
  blockFull: { padding: 16, marginTop: 0 },
  header: { fontSize: 14, fontWeight: 800, color: '#065F46' },
  sub: { fontSize: 11, color: '#047857', lineHeight: 1.4, marginTop: 2, marginBottom: 6 },
  gapRow: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid #A7F3D0', marginTop: 8 },
  gapText: { fontSize: 12, color: '#065F46', lineHeight: 1.4 },
  btn: { alignSelf: 'flex-start', padding: '7px 13px', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  btnGhost: { padding: '7px 13px', background: '#fff', color: '#059669', border: '1px solid #059669', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  sentTag: { alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, color: '#059669' },
  tuneBox: { background: '#fff', border: '1px solid #A7F3D0', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
  tuneRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  tuneLabel: { fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', flexDirection: 'column', gap: 3 },
  tuneInput: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#0F172A', width: 80 },
  tuneActions: { display: 'flex', gap: 8 },
  warn: { fontSize: 11, color: '#B45309', fontWeight: 600 },
  more: { fontSize: 11, color: '#047857', marginTop: 8, fontStyle: 'italic' },
}
