import React, { useState, useEffect, useRef } from 'react'
import { facilityAPI } from '../../api.js'

export const CONSENT_VERSION = 'v1.0-2026-07-12'

const CONSENT_TEXT = `SNAP MEDICAL TECHNOLOGIES — STAFFIQ BENCHMARK COHORT PARTICIPATION & PUBLICATION CONSENT

Effective upon acceptance. Version ${CONSENT_VERSION}.

This consent is entered into between SNAP Medical Technologies, LLC ("SNAP Medical", "we", "us") and the participating facility ("Facility", "you") upon electronic acceptance. It governs the Facility's participation in the StaffIQ Benchmark Cohort. It is separate from, and does not modify, any Subscription Agreement or Business Associate Agreement between the parties.

1. WHAT THE BENCHMARK IS. SNAP Medical maintains a cross-facility benchmark of anesthesia staffing economics. Every participating facility is measured from its own uploaded schedule data under one frozen, documented methodology, so results are directly comparable across the cohort. Aggregated findings from the cohort may be published as industry research.

2. DATA COVERED. Participation covers staffing schedule data uploaded by the Facility: dates, sites/locations, provider types and counts, shift hours, and (where provided) provider rates. Schedule data does NOT include patient information, and the Facility agrees not to include patient identifiers or Protected Health Information in benchmark uploads.

3. HOW YOUR DATA IS USED. Your schedule data is used to (a) compute your facility's own StaffIQ metrics and reports, (b) contribute to anonymized, aggregated cross-facility benchmark statistics, and (c) support published industry findings derived from the cohort.

4. ANONYMITY. The Facility will never be named or identifiably described in any published material without separate written permission. In publications, cohort members appear only in anonymized form (e.g., "a multi-site anesthesia practice") or within aggregate statistics. Facility-level results are shared outside SNAP Medical only with the Facility itself.

5. FOUNDING COHORT COMMITMENTS. As a benchmark participant, the Facility agrees to (a) provide schedule data uploads on an approximately monthly basis while participating, and (b) consider in good faith a reasonable reference conversation or anonymized case study once its results mature. These commitments are conditions of founding-cohort pricing where such pricing has been offered in writing.

6. METHODOLOGY TRANSPARENCY. The measurement methodology is documented and frozen for the cohort window. The Facility may request the methodology document at any time. Any methodology change during the cohort window requires re-computation of all prior cohort results so comparisons remain valid.

7. REVOCATION. The Facility may withdraw this consent at any time in the portal. Withdrawal is prospective: the Facility's data will be excluded from benchmark statistics and publications prepared after withdrawal. Aggregated findings already published before withdrawal are unaffected. Withdrawal does not affect the Facility's own use of StaffIQ or its subscription.

8. OWNERSHIP. The Facility retains ownership of its uploaded data. Benchmark statistics, methodology, and published findings are the property of SNAP Medical.

9. TERM. This consent remains in effect while the Facility participates in the benchmark, until withdrawn under Section 7.

By clicking "I Consent to Benchmark Participation", you (a) represent that you have authority to bind the Facility to this consent, (b) acknowledge that you have read and understood these terms, and (c) agree that your electronic acceptance constitutes a legally binding signature.`

function ConsentModal({ readOnly, consent, onConfirm, onRevoke, onCancel, loading }) {
  const [agreed, setAgreed] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const scrollRef = useRef(null)

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setScrolled(true)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 640,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Benchmark Cohort Consent
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F172A' }}>
            StaffIQ Benchmark Participation & Publication Consent
          </div>
          {readOnly && consent && (
            <div style={{ fontSize: 13, color: '#15803D', marginTop: 6 }}>
              ✓ Accepted {new Date(consent.acceptedAt).toLocaleDateString()} ({consent.consentVersion})
            </div>
          )}
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
        >
          {CONSENT_TEXT}
        </div>

        <div style={{ padding: '16px 28px 22px', borderTop: '1px solid #E2E8F0' }}>
          {!readOnly && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: scrolled ? '#0F172A' : '#94A3B8', cursor: scrolled ? 'pointer' : 'not-allowed', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={agreed}
                disabled={!scrolled}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I have read and agree to the Benchmark Participation & Publication Consent on behalf of this facility.
                {!scrolled && ' (Scroll to the end of the terms to enable.)'}
              </span>
            </label>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {readOnly && (
              <button
                onClick={onRevoke}
                disabled={loading}
                style={{ padding: '10px 18px', background: 'transparent', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginRight: 'auto' }}
              >
                Withdraw Consent
              </button>
            )}
            <button
              onClick={onCancel}
              style={{ padding: '10px 18px', background: '#F1F5F9', color: '#334155', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Close
            </button>
            {!readOnly && (
              <button
                onClick={onConfirm}
                disabled={!agreed || loading}
                style={{ padding: '10px 22px', background: agreed ? '#2563EB' : '#CBD5E1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: agreed ? 'pointer' : 'not-allowed' }}
              >
                {loading ? 'Recording…' : 'I Consent to Benchmark Participation'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * In-portal benchmark consent capture (deliberately not an emailed e-signature
 * flow). Shows an invitation banner until the facility consents, then a compact
 * confirmation strip with access to the terms and prospective withdrawal.
 */
export default function BenchmarkConsentCard() {
  const [state, setState] = useState(null) // { consented, consent } | null while loading/unavailable
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    facilityAPI.getBenchmarkConsent()
      .then(setState)
      .catch(() => setState(null))
  }, [])

  async function handleAccept() {
    setSaving(true)
    try {
      const res = await facilityAPI.acceptBenchmarkConsent(CONSENT_VERSION)
      setState(res)
      setModalOpen(false)
    } catch (e) {
      alert('Could not record consent: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke() {
    if (!window.confirm('Withdraw benchmark participation consent? Your data will be excluded from future benchmark statistics and publications. This does not affect your subscription.')) return
    setSaving(true)
    try {
      const res = await facilityAPI.revokeBenchmarkConsent()
      setState(res)
      setModalOpen(false)
    } catch (e) {
      alert('Could not withdraw consent: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null

  return (
    <>
      {state.consented ? (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 13, color: '#166534', flex: 1 }}>
            <strong>Benchmark cohort member</strong> — consent recorded{' '}
            {state.consent?.acceptedAt ? new Date(state.consent.acceptedAt).toLocaleDateString() : ''}
            {state.consent?.user?.name ? ` by ${state.consent.user.name}` : ''}.
          </span>
          <button
            onClick={() => setModalOpen(true)}
            style={{ padding: '6px 12px', background: 'transparent', color: '#166534', border: '1px solid #86EFAC', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            View Terms
          </button>
        </div>
      ) : (
        <div style={{ background: 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)', border: '1px solid #93C5FD', borderRadius: 16, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 32 }}>🔬</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Join the StaffIQ benchmark cohort
            </div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Your staffing data contributes to the industry's first comparable benchmark of anesthesia
              staffing economics — anonymized, aggregated, and measured under one frozen methodology.
              Participation is a condition of founding-cohort pricing.
            </div>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            style={{ padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.35)' }}
          >
            Review & Consent
          </button>
        </div>
      )}

      {modalOpen && (
        <ConsentModal
          readOnly={state.consented}
          consent={state.consent}
          onConfirm={handleAccept}
          onRevoke={handleRevoke}
          onCancel={() => setModalOpen(false)}
          loading={saving}
        />
      )}
    </>
  )
}
