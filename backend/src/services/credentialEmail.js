const sgMail = require('@sendgrid/mail')

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

const FROM = process.env.SENDGRID_FROM || 'credentialing@snapmedical.com'
const APP_URL = process.env.APP_URL || 'https://snap-marketplace.up.railway.app'

function credTypeName(type) {
  const names = {
    STATE_LICENSE: 'State Medical License',
    DEA_CERTIFICATE: 'DEA Certificate',
    MA_CS_LICENSE: 'MA Controlled Substance License',
    BOARD_CERTIFICATION: 'Board Certification',
    MALPRACTICE_INSURANCE: 'Malpractice Insurance',
    ACLS_CERTIFICATION: 'ACLS Certification',
    BLS_CERTIFICATION: 'BLS Certification',
    CV: 'Curriculum Vitae',
    NPDB_AUTHORIZATION: 'NPDB Authorization',
    MALPRACTICE_HISTORY: 'Malpractice History',
    EDUCATION_HISTORY: 'Education History',
    HOSPITAL_PRIVILEGES: 'Hospital Privilege History',
    WORK_HISTORY: 'Work History',
  }
  return names[type] || type
}

async function send(msg) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[credentialEmail] SENDGRID_API_KEY not set — skipping:', msg.subject)
    return
  }
  try {
    await sgMail.send(msg)
  } catch (err) {
    console.error('[credentialEmail] SendGrid error:', err.response?.body || err.message)
  }
}

// Expiration alert to facility coordinator
async function sendExpirationAlertToFacility(toEmail, facilityName, items) {
  const rows = items.map(i =>
    `<tr><td>${i.providerName}</td><td>${credTypeName(i.credentialType)}</td><td>${i.expirationDate}</td><td style="color:${i.daysLeft < 0 ? '#DC2626' : i.daysLeft <= 30 ? '#EF4444' : '#D97706'}">${i.daysLeft < 0 ? 'EXPIRED' : `${i.daysLeft} days`}</td></tr>`
  ).join('')

  await send({
    to: toEmail,
    from: FROM,
    subject: `[SNAP Credentialing] Expiring Credentials — ${facilityName}`,
    html: `
      <h2>Credential Expiration Alert — ${facilityName}</h2>
      <p>The following provider credentials require attention:</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
        <thead><tr><th>Provider</th><th>Credential</th><th>Expiration Date</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="${APP_URL}/credentialing" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px">Open Credentialing Dashboard</a></p>
    `,
  })
}

// Expiration reminder to provider
async function sendExpirationReminderToProvider(toEmail, providerName, credentialType, expirationDate, daysLeft) {
  const urgency = daysLeft <= 0 ? 'has EXPIRED' : `expires in ${daysLeft} days`
  await send({
    to: toEmail,
    from: FROM,
    subject: `[SNAP Credentialing] Action Required — ${credTypeName(credentialType)}`,
    html: `
      <h2>Credential Update Required</h2>
      <p>Hi ${providerName},</p>
      <p>Your <strong>${credTypeName(credentialType)}</strong> ${urgency} (${expirationDate}).</p>
      <p>Please log in to your SNAP provider account and upload your updated credential document.</p>
      <p><a href="${APP_URL}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px">Update My Credentials</a></p>
    `,
  })
}

// Invitation to provider to create SNAP account
async function sendProviderInvitation(toEmail, providerName, facilityName, inviteLink) {
  await send({
    to: toEmail,
    from: FROM,
    subject: `${facilityName} has invited you to join SNAP Credentialing`,
    html: `
      <h2>You've been invited to SNAP Credentialing</h2>
      <p>Hi ${providerName},</p>
      <p><strong>${facilityName}</strong> has added you to their credentialing dashboard and is requesting that you complete your SNAP Credentialing Passport.</p>
      <p>Your digital credential passport allows your facility to verify and track your credentials automatically — no more paper forms.</p>
      <p><a href="${inviteLink}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px">Create My SNAP Account</a></p>
      <p style="color:#94A3B8;font-size:12px">If you already have a SNAP account, log in and your credentials will be linked automatically.</p>
    `,
  })
}

// Document request to provider
async function sendDocumentRequest(toEmail, providerName, credentialType, facilityName, message) {
  await send({
    to: toEmail,
    from: FROM,
    subject: `[SNAP Credentialing] Document Requested — ${credTypeName(credentialType)}`,
    html: `
      <h2>Document Request from ${facilityName}</h2>
      <p>Hi ${providerName},</p>
      <p><strong>${facilityName}</strong> is requesting your <strong>${credTypeName(credentialType)}</strong> document.</p>
      ${message ? `<blockquote style="border-left:3px solid #6366F1;padding-left:12px;color:#374151">${message}</blockquote>` : ''}
      <p>Please log in to your SNAP account and upload the document.</p>
      <p><a href="${APP_URL}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px">Upload Document</a></p>
    `,
  })
}

// Manual credential reminder
async function sendCredentialReminder(toEmail, providerName, credentialType, message) {
  await send({
    to: toEmail,
    from: FROM,
    subject: `[SNAP Credentialing] Reminder — ${credTypeName(credentialType)}`,
    html: `
      <h2>Credential Reminder</h2>
      <p>Hi ${providerName},</p>
      <p>You have a reminder regarding your <strong>${credTypeName(credentialType)}</strong>.</p>
      ${message ? `<p>${message}</p>` : ''}
      <p><a href="${APP_URL}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px">Open SNAP</a></p>
    `,
  })
}

// Welcome email for new facility users (temp password)
async function sendWelcomeEmail(toEmail, name, facilityName, tempPassword) {
  const loginUrl = `${APP_URL}`
  await send({
    to: toEmail,
    from: FROM,
    subject: `Welcome to SNAP Credentialing — ${facilityName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#0F172A">Welcome to SNAP Credentialing</h2>
        <p>Hi ${name},</p>
        <p>Your facility credentialing account has been created for <strong>${facilityName}</strong>.</p>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin:24px 0">
          <p style="margin:0 0 8px"><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
          <p style="margin:0 0 8px"><strong>Email:</strong> ${toEmail}</p>
          <p style="margin:0"><strong>Temporary Password:</strong> <code style="background:#E2E8F0;padding:2px 8px;border-radius:4px;font-size:15px">${tempPassword}</code></p>
        </div>
        <p style="color:#DC2626;font-weight:600">You will be required to set a new password on your first login.</p>
        <a href="${loginUrl}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:8px;font-weight:600">Sign In to SNAP Credentialing →</a>
        <p style="color:#94A3B8;font-size:12px;margin-top:24px">If you did not expect this email, please contact admin@snapmedical.com.</p>
      </div>
    `,
  })
}

// Password reset email
async function sendPasswordResetEmail(toEmail, name, resetLink) {
  await send({
    to: toEmail,
    from: FROM,
    subject: '[SNAP Credentialing] Password Reset Request',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#0F172A">Reset Your Password</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your SNAP Credentialing password. Click the button below to set a new password.</p>
        <a href="${resetLink}" style="background:#6366F1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0;font-weight:600">Reset My Password →</a>
        <p style="color:#64748B;font-size:13px">This link expires in 1 hour. If you did not request a password reset, you can ignore this email.</p>
      </div>
    `,
  })
}

// Facility-coordinator invite email — the warm peer-to-peer onboarding
// flow that replaces the broken /auth/facility/register self-serve form.
// Inviter is named explicitly ("Matt Haverkamp at SNAP Medical invited you")
// because every customer comes through a real conversation, not a cold signup.
// Reply-To is matt@snapmedical.app so replies land directly with him.
// Sends the facility-coordinator invite email. Naming convention chosen
// 2026-06-09 after dry-run feedback: no per-admin name in the body (no
// "Matt at SNAP Medical invited you…" hand-waving). Just "SNAP Medical
// invited you…". The recipient name greets them by first name, sourced
// from what the admin typed in the modal or derived from the email.
async function sendFacilityInvite(toEmail, recipientFirstName, facilityName, roleLabel, claimLink, expiryDate) {
  const greeting = recipientFirstName && recipientFirstName !== 'there'
    ? `Hi ${recipientFirstName},`
    : 'Hi there,'
  const subject = `You've been invited to manage ${facilityName} on SNAP Medical`

  await send({
    to: toEmail,
    from: FROM,
    replyTo: 'matt@snapmedical.app',
    subject,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:14px;border:1px solid #E2E8F0;overflow:hidden">
        <div style="background:#6366F1;padding:24px 32px">
          <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.02em">SNAP Medical</span>
        </div>
        <div style="padding:32px">
          <h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0F172A">${greeting}</h2>
          <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
            SNAP Medical invited you to manage <strong>${facilityName}</strong> as ${roleLabel}.
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 24px">
            SNAP Medical is the staffing + credentialing platform built for anesthesia providers and the surgical centers they work in. When you sign in, your dashboard will walk you through adding your sites and roster — most coordinators are up and running in under 15 minutes.
          </p>
          <p style="text-align:center;margin:32px 0">
            <a href="${claimLink}" style="background:#6366F1;color:#fff;padding:14px 32px;text-decoration:none;border-radius:10px;display:inline-block;font-weight:700;font-size:15px">Set up your account →</a>
          </p>
          <p style="font-size:13px;color:#64748B;line-height:1.6;margin:24px 0 8px">
            This invite expires on <strong>${expiryDate}</strong>. If you have any questions, just reply to this email — it goes directly to Matt.
          </p>
          <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #F1F5F9;font-size:11px;color:#94A3B8">
            — The SNAP Medical team
          </p>
        </div>
      </div>
    `,
  })
}

module.exports = {
  sendExpirationAlertToFacility,
  sendExpirationReminderToProvider,
  sendProviderInvitation,
  sendFacilityInvite,
  sendDocumentRequest,
  sendCredentialReminder,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  credTypeName,
}
