import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

const ALL_STATUSES = ['DEPOSIT_PENDING', 'LIVE', 'FILLED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED']

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })
}

const MOCK_SHIFTS = [
  { id: 's1',  facilityName: 'Boston Surgery Center',     specialty: 'CRNA',              date: '2026-05-20', duration: 8,  payRate: 275, status: 'COMPLETED',       providerName: 'Dr. Lisa Park'   },
  { id: 's2',  facilityName: 'Metro Anesthesia Partners', specialty: 'Anesthesiologist',  date: '2026-05-21', duration: 10, payRate: 310, status: 'COMPLETED',       providerName: 'Dr. Priya Nair'  },
  { id: 's3',  facilityName: 'North Shore Surgical',      specialty: 'CRNA',              date: '2026-05-24', duration: 6,  payRate: 265, status: 'FILLED',          providerName: 'Dr. Sarah Kim'   },
  { id: 's4',  facilityName: 'Boston Surgery Center',     specialty: 'Anesthesiologist',  date: '2026-05-26', duration: 8,  payRate: 295, status: 'LIVE',            providerName: null              },
  { id: 's5',  facilityName: 'Brigham Specialty Center',  specialty: 'CRNA',              date: '2026-05-28', duration: 10, payRate: 285, status: 'LIVE',            providerName: null              },
  { id: 's6',  facilityName: 'South Shore Ambulatory',    specialty: 'Anesthesiologist',  date: '2026-06-02', duration: 8,  payRate: 295, status: 'DEPOSIT_PENDING', providerName: null              },
  { id: 's7',  facilityName: 'Boston Surgery Center',     specialty: 'CRNA',              date: '2026-04-15', duration: 8,  payRate: 260, status: 'DISPUTED',        providerName: 'Dr. Tom Walsh'   },
  { id: 's8',  facilityName: 'Cape Cod Surgical',         specialty: 'Anesthesia Assistant', date: '2026-04-10', duration: 6, payRate: 220, status: 'CANCELLED',   providerName: null              },
]

export default function AdminShiftsPage() {
  const [shifts, setShifts]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [overriding, setOverriding] = useState({})

  useEffect(() => {
    const params = filter !== 'all' ? { status: filter } : {}
    adminAPI.getShifts(params)
      .then(setShifts)
      .catch(() => setShifts(MOCK_SHIFTS))
      .finally(() => setLoading(false))
  }, [filter])

  async function handleOverride(shiftId, newStatus) {
    setOverriding((prev) => ({ ...prev, [shiftId]: true }))
    try {
      await adminAPI.overrideShift(shiftId, newStatus)
      setShifts((prev) => prev.map((s) => s.id === shiftId ? { ...s, status: newStatus } : s))
    } catch {
      alert('Override failed.')
    } finally {
      setOverriding((prev) => ({ ...prev, [shiftId]: false }))
    }
  }

  const displayed = filter === 'all' ? shifts : shifts.filter((s) => s.status === filter)

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>All Shifts</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{shifts.length} total shifts</p>
        </div>
      </div>

      {/* Status filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '7px 16px',
            background: filter === 'all' ? '#0F172A' : '#fff',
            color: filter === 'all' ? '#fff' : '#64748B',
            border: '1.5px solid',
            borderColor: filter === 'all' ? '#0F172A' : '#E2E8F0',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '7px 16px',
              background: filter === s ? '#0F172A' : '#fff',
              color: filter === s ? '#fff' : '#64748B',
              border: '1.5px solid',
              borderColor: filter === s ? '#0F172A' : '#E2E8F0',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 100px 70px 70px 70px 130px 180px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          {['Facility', 'Specialty', 'Date', 'Hrs', 'Rate', 'Total', 'Status', 'Override Status'].map((h) => (
            <div key={h} style={{ padding: '12px 14px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </div>
          ))}
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading shifts...</div>}

        {!loading && displayed.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            No shifts match the selected filter.
          </div>
        )}

        {displayed.map((shift, i) => (
          <div
            key={shift.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.5fr 100px 70px 70px 70px 130px 180px',
              borderBottom: i < displayed.length - 1 ? '1px solid #F1F5F9' : 'none',
              background: shift.status === 'DISPUTED' ? '#FFF5F5' : (i % 2 === 0 ? '#fff' : '#FAFAFA'),
              alignItems: 'center',
            }}
          >
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{shift.facilityName}</div>
              {shift.providerName && <div style={{ fontSize: 11, color: '#64748B' }}>{shift.providerName}</div>}
            </div>
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#374151' }}>{shift.specialty}</div>
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#374151' }}>{shift.date}</div>
            <div style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{shift.duration}h</div>
            <div style={{ padding: '12px 14px', fontSize: 13, color: '#374151' }}>{fmt(shift.payRate)}</div>
            <div style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{fmt(shift.payRate * shift.duration)}</div>
            <div style={{ padding: '12px 14px' }}>
              <StatusBadge status={shift.status} />
            </div>
            <div style={{ padding: '12px 14px' }}>
              <select
                value={shift.status}
                onChange={(e) => handleOverride(shift.id, e.target.value)}
                disabled={overriding[shift.id]}
                style={{
                  padding: '6px 10px',
                  background: overriding[shift.id] ? '#F8FAFC' : '#fff',
                  border: '1.5px solid #E2E8F0',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#374151',
                  cursor: overriding[shift.id] ? 'not-allowed' : 'pointer',
                  outline: 'none',
                  width: '100%',
                }}
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
