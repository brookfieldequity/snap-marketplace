import React from 'react'

// Public, no-login messaging-policy page served at /sms-terms. This is the URL
// supplied to carriers (Twilio toll-free / A2P verification) as the program's
// opt-in + terms disclosure. Keep the facts here in sync with how the product
// actually collects numbers and sends messages.

export default function SmsTermsPage() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <span style={styles.brand}>SNAP</span>
          <span style={styles.brandSub}>Medical</span>
        </div>
        <h1 style={styles.h1}>SMS Messaging Terms &amp; Consent</h1>
        <p style={styles.meta}>Last updated June 2026</p>

        <p style={styles.p}>
          SNAP Medical operates a staffing and scheduling platform for anesthesia
          providers (CRNAs, anesthesiologists, and anesthesia assistants) and the
          surgical facilities they work with. This page describes our text-message
          (SMS) program and how consent is collected.
        </p>

        <h2 style={styles.h2}>What messages we send</h2>
        <p style={styles.p}>
          Providers receive operational text notifications related to their work,
          such as: a published or updated work schedule, an offered open or
          incentive shift, a response to a schedule request, and occasional
          account or onboarding notices. These are transactional notifications —
          we do not send marketing or promotional texts.
        </p>

        <h2 style={styles.h2}>How numbers are collected &amp; consent</h2>
        <p style={styles.p}>
          SNAP is the sender of every message in this program, and SNAP only
          sends texts to phone numbers whose owners have opted in directly with
          SNAP. Consent is collected in two ways: (1) through our opt-in form at{' '}
          <a style={styles.a} href="/sms-optin">ai.snapmedical.app/sms-optin</a>,
          where a person enters their own mobile number, reviews the consent
          disclosures, and submits; or (2) by checking the SMS consent box shown
          when submitting availability through a SNAP scheduling page. A facility
          may keep a provider&rsquo;s number in its SNAP roster for scheduling
          records, but SNAP does not send SMS to that number unless the provider
          has opted in themselves. Providers may opt out of texts at any time
          (see below) without affecting their work relationship.
        </p>

        <h2 style={styles.h2}>Message frequency</h2>
        <p style={styles.p}>
          Message frequency varies based on a provider&rsquo;s schedule and shift
          activity (recurring).
        </p>

        <h2 style={styles.h2}>Cost</h2>
        <p style={styles.p}>Message and data rates may apply, per your mobile carrier plan.</p>

        <h2 style={styles.h2}>Opt out &amp; help</h2>
        <p style={styles.p}>
          Reply <strong>STOP</strong> to any message to unsubscribe from texts at
          any time. Reply <strong>HELP</strong> for help. You can also contact us
          at <a style={styles.a} href="mailto:matt@snapmedical.app">matt@snapmedical.app</a>.
        </p>

        <h2 style={styles.h2}>Privacy</h2>
        <p style={styles.p}>
          We do not sell or share mobile numbers or text-message consent with third
          parties for their marketing. Numbers are used only to deliver the
          notifications described above. Questions:{' '}
          <a style={styles.a} href="mailto:matt@snapmedical.app">matt@snapmedical.app</a>.
        </p>

        <p style={styles.legal}>
          SNAP is operated by Essential Anesthesia Partners LLC (d/b/a SNAP Medical
          Technologies), Massachusetts.
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#F8FAFC', display: 'flex', justifyContent: 'center', padding: '40px 16px', boxSizing: 'border-box' },
  card: { maxWidth: 720, width: '100%', background: '#fff', border: '1px solid #DCE8F7', borderRadius: 16, padding: '36px 40px', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' },
  brandRow: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 24 },
  brand: { fontFamily: "'Nunito', 'Inter', sans-serif", fontSize: 24, fontWeight: 800, color: '#2563EB', letterSpacing: '-0.02em' },
  brandSub: { fontSize: 14, fontWeight: 600, color: '#64748B' },
  h1: { fontSize: 26, fontWeight: 800, color: '#10233F', margin: '0 0 4px', letterSpacing: '-0.01em' },
  meta: { fontSize: 13, color: '#94A3B8', margin: '0 0 24px' },
  h2: { fontSize: 16, fontWeight: 800, color: '#10233F', margin: '24px 0 6px' },
  p: { fontSize: 15, lineHeight: 1.6, color: '#334155', margin: '0 0 8px' },
  a: { color: '#2563EB', textDecoration: 'none', fontWeight: 600 },
  legal: { fontSize: 12.5, lineHeight: 1.5, color: '#94A3B8', margin: '28px 0 0', borderTop: '1px solid #DCE8F7', paddingTop: 16 },
}
