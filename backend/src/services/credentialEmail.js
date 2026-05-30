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
  const urgency = daysLeft <= 0 ? 'has EXPIRED' : daysLeft <= 30 ? 'expires in ${daysLeft} days' : `expires in ${daysLeft} days`
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

module.exports = {
  sendExpirationAlertToFacility,
  sendExpirationReminderToProvider,
  sendProviderInvitation,
  sendDocumentRequest,
  sendCredentialReminder,
  credTypeName,
}
