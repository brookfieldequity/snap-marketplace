import React from 'react'

// Phase 3 (one source of truth): the portal no longer keeps its own roster.
// It reads the marketplace's ONE roster (Internal Roster — the same list the
// Schedule Builder and payroll use), so providers are added/edited exactly
// once. This page is a signpost; the old CSV-import roster manager is frozen.

export default function CredentialRosterSettings() {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: '0 0 4px' }}>Roster</h1>
      <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 24px' }}>One roster across all of SNAP.</p>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: '24px 28px' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>
          🧭 This portal now reads your practice's main roster
        </div>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: '0 0 14px' }}>
          Providers shown on the <strong>Providers</strong> page come live from your practice's
          <strong> Internal Roster</strong> — the same list your schedule builder and payroll use.
          Add, edit, or remove providers there (facility portal → Internal Roster) and they appear
          here automatically. No separate credentialing roster to maintain, no CSV re-imports.
        </p>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: '0 0 14px' }}>
          Credential data itself lives on each provider's <strong>SNAP credentialing passport</strong> —
          invite providers from the Providers page and their passport links here once they accept.
        </p>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#64748B' }}>
          Tip: a provider needs an <strong>NPI on their roster card</strong> to be invited — rows without
          one show "No NPI on file" on the Providers page.
        </div>
      </div>
    </div>
  )
}
