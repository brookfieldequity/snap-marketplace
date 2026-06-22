import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })
}

// Map the real /admin/disputes row (a ShiftCompletion with nested booking/
// shift/facility) into the flat fields these cards render. The row id is the
// ShiftCompletion id — that's what the resolve endpoint keys on.
function normalizeDispute(c) {
  const p = c.booking?.provider
  return {
    id: c.id,
    facilityName: c.shift?.facility?.name || '—',
    providerName: p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : 'Provider',
    specialty: c.shift?.specialty,
    date: c.shift?.date ? String(c.shift.date).slice(0, 10) : '',
    payRate: c.shift?.currentRate || 0,
    providerHours: c.providerHours ?? 0,
    facilityHours: c.facilityHours ?? 0,
    openedAt: c.createdAt ? String(c.createdAt).slice(0, 10) : '',
    notes: c.disputeNotes || '',
  }
}

function ResolveModal({ dispute, onClose, onResolved }) {
  const [finalHours, setFinalHours] = useState('')
  const [notes, setNotes]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  async function handleResolve() {
    if (!finalHours) { setError('Enter final hours.'); return }
    setLoading(true)
    setError('')
    try {
      await adminAPI.resolveDispute(dispute.id, { finalHours: Number(finalHours), notes })
      onResolved(dispute.id)
    } catch (err) {
      setError(err.message || 'Failed to resolve dispute.')
    } finally {
      setLoading(false)
    }
  }

  const finalPay = Number(finalHours || 0) * dispute.payRate

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(4px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, padding: '36px', width: '100%', maxWidth: 520, boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              ⚖️ Resolve Dispute
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{dispute.providerName}</h2>
            <p style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{dispute.facilityName} · {dispute.date}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94A3B8' }}>×</button>
        </div>

        {/* Hours comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          <div style={{ background: '#F3E8FF', border: '1px solid #DDD6FE', borderRadius: 12, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1E3A8A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Provider Claims</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#1E3A8A' }}>{dispute.providerHours}h</div>
            <div style={{ fontSize: 12, color: '#1E3A8A', opacity: 0.8 }}>{fmt(dispute.providerHours * dispute.payRate)}</div>
          </div>
          <div style={{ background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 12, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Facility Claims</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#1D4ED8' }}>{dispute.facilityHours}h</div>
            <div style={{ fontSize: 12, color: '#1D4ED8', opacity: 0.8 }}>{fmt(dispute.facilityHours * dispute.payRate)}</div>
          </div>
        </div>

        {dispute.notes && (
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
            <strong>Context:</strong> {dispute.notes}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Final Hours (Admin Decision)
          </label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={finalHours}
            onChange={(e) => setFinalHours(e.target.value)}
            placeholder={`Between ${dispute.facilityHours} and ${dispute.providerHours}`}
            style={{
              width: '100%', padding: '12px 14px', background: '#F8FAFC',
              border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 15, color: '#0F172A', outline: 'none',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
            onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
          />
          {finalHours && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#059669', fontWeight: 600 }}>
              Final payout: {fmt(finalPay)} ({finalHours}h × {fmt(dispute.payRate)}/hr)
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Resolution Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Explain your decision for the record..."
            rows={3}
            style={{
              width: '100%', padding: '12px 14px', background: '#F8FAFC',
              border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, color: '#0F172A',
              outline: 'none', resize: 'vertical', lineHeight: 1.6,
            }}
            onFocus={(e) => (e.target.style.borderColor = '#2563EB')}
            onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
          />
        </div>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626', marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '12px', background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={loading || !finalHours}
            style={{
              flex: 2, padding: '12px',
              background: loading ? '#A5B4FC' : '#2563EB',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700,
              cursor: (loading || !finalHours) ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Resolving...' : '⚖️ Resolve Dispute'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [activeDispute, setActive]    = useState(null)
  const [resolved, setResolved]       = useState(new Set())

  useEffect(() => {
    adminAPI.getDisputes()
      .then((rows) => setDisputes((rows || []).map(normalizeDispute)))
      .catch(() => setDisputes([])) // empty state, never fake disputes
      .finally(() => setLoading(false))
  }, [])

  function handleResolved(disputeId) {
    setResolved((prev) => new Set([...prev, disputeId]))
    setActive(null)
  }

  const pending = disputes.filter((d) => !resolved.has(d.id))

  return (
    <div style={{ padding: '32px 40px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          Disputes
          {pending.length > 0 && (
            <span style={{ marginLeft: 12, background: '#FEF2F2', color: '#DC2626', fontSize: 14, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid #FCA5A5' }}>
              {pending.length} open
            </span>
          )}
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Review and resolve shift disputes</p>
      </div>

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>Loading disputes...</div>}

      {!loading && pending.length === 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚖️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#15803D', marginBottom: 4 }}>No open disputes</div>
          <div style={{ fontSize: 14, color: '#16A34A' }}>All disputes have been resolved.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pending.map((dispute) => (
          <div
            key={dispute.id}
            style={{
              background: '#fff',
              border: '1px solid #FCA5A5',
              borderLeft: '4px solid #EF4444',
              borderRadius: 16,
              padding: '24px 28px',
              boxShadow: '0 2px 8px rgba(239,68,68,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ⚖️ Disputed
                  </span>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>Opened {dispute.openedAt}</span>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                  {dispute.providerName} — {dispute.facilityName}
                </h3>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
                  {dispute.specialty} · {dispute.date} · {fmt(dispute.payRate)}/hr
                </p>

                {/* Hours comparison */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ background: '#F3E8FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '10px 16px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1E3A8A', textTransform: 'uppercase', marginBottom: 2 }}>Provider says</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1E3A8A' }}>{dispute.providerHours}h</div>
                    <div style={{ fontSize: 11, color: '#1E3A8A', opacity: 0.8 }}>{fmt(dispute.providerHours * dispute.payRate)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#94A3B8', fontSize: 20 }}>vs</div>
                  <div style={{ background: '#EFF6FF', border: '1px solid #A5B4FC', borderRadius: 10, padding: '10px 16px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', marginBottom: 2 }}>Facility says</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1D4ED8' }}>{dispute.facilityHours}h</div>
                    <div style={{ fontSize: 11, color: '#1D4ED8', opacity: 0.8 }}>{fmt(dispute.facilityHours * dispute.payRate)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 16px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', marginBottom: 2 }}>Difference</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#EF4444' }}>
                        {Math.abs(dispute.providerHours - dispute.facilityHours)}h
                      </div>
                      <div style={{ fontSize: 11, color: '#EF4444', opacity: 0.8 }}>
                        {fmt(Math.abs(dispute.providerHours - dispute.facilityHours) * dispute.payRate)}
                      </div>
                    </div>
                  </div>
                </div>

                {dispute.notes && (
                  <div style={{ marginTop: 14, fontSize: 13, color: '#475569', fontStyle: 'italic', lineHeight: 1.6, maxWidth: 600 }}>
                    "{dispute.notes}"
                  </div>
                )}
              </div>

              <button
                onClick={() => setActive(dispute)}
                style={{
                  padding: '12px 24px',
                  background: '#EF4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
                }}
              >
                ⚖️ Resolve
              </button>
            </div>
          </div>
        ))}
      </div>

      {activeDispute && (
        <ResolveModal
          dispute={activeDispute}
          onClose={() => setActive(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  )
}
