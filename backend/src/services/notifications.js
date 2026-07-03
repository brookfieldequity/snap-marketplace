const { Expo } = require('expo-server-sdk');
const sgMail = require('@sendgrid/mail');
const prisma = require('../config/db');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const expo = new Expo();

// ── Twilio SMS ────────────────────────────────────────────────────────────────

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch { /* twilio not installed or misconfigured — skip */ }
}

// Returns { sent: boolean, reason?: string }. Never throws — fire-and-forget
// callers stay safe, and callers that care (the availability-request send
// endpoint) get an honest status instead of a silent no-op reported as success.
async function sendSMS(to, body) {
  if (!twilioClient) return { sent: false, reason: 'SMS is not configured' };
  if (!process.env.TWILIO_PHONE_NUMBER) return { sent: false, reason: 'No sender number configured' };
  if (!to) return { sent: false, reason: 'No phone number on file' };
  const cleaned = to.replace(/\D/g, '');
  if (cleaned.length < 10) return { sent: false, reason: 'Invalid phone number' };
  const e164 = cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: e164 });
    return { sent: true };
  } catch (err) {
    console.error('Twilio SMS error:', err.message);
    return { sent: false, reason: err.message };
  }
}

const FROM_EMAIL = process.env.SENDGRID_FROM || 'noreply@snapmedical.app';

// ── Primitives ────────────────────────────────────────────────────────────────

async function sendPush(tokens, title, body, data = {}) {
  if (!tokens?.length) return;
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (!valid.length) return;
  const chunks = expo.chunkPushNotifications(
    valid.map((to) => ({ to, sound: 'default', title, body, data }))
  );
  for (const chunk of chunks) {
    try { await expo.sendPushNotificationsAsync(chunk); }
    catch (err) { console.error('Push send error:', err.message); }
  }
}

async function sendEmail(to, subject, html) {
  if (!process.env.SENDGRID_API_KEY || !to) return;
  // Disable SendGrid click tracking: it rewrites links through a branded tracking
  // subdomain (url####.snapmedical.app) whose SSL isn't provisioned, so recipients
  // hit "connection is not private". These are transactional emails (invites,
  // notifications) — links must go straight to the real, valid-cert URL.
  try { await sgMail.send({ to, from: FROM_EMAIL, subject, html, trackingSettings: { clickTracking: { enable: false, enableText: false } } }); }
  catch (err) { console.error('SendGrid error:', err.message); }
}

async function getFacilityEmail(facilityId) {
  const fu = await prisma.facilityUser.findFirst({
    where: { facilityId, facilityRole: 'ADMIN' },
    include: { user: { select: { email: true } } },
  });
  return fu?.user?.email || null;
}

function emailTemplate(heading, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #E2E8F0">
<tr><td style="background:#6366F1;padding:24px 32px;border-radius:16px 16px 0 0">
  <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.02em">SNAP Medical</span>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0F172A">${heading}</h2>
  <div style="font-size:14px;color:#374151;line-height:1.6">${bodyHtml}</div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #F1F5F9;font-size:11px;color:#94A3B8">
    SNAP Medical Marketplace · Massachusetts
  </div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── 1. New shift posted → notify providers with matching specialty ─────────────

async function notifyShiftPosted(shift) {
  try {
    const [facility, providers] = await Promise.all([
      prisma.facility.findUnique({ where: { id: shift.facilityId }, select: { name: true } }),
      prisma.providerProfile.findMany({
        where: { specialty: shift.specialty, notifPreference: { not: 'NONE' } },
        include: { user: { select: { email: true } } },
      }),
    ]);
    if (!providers.length) return;

    const facilityName = facility?.name || 'a facility';
    const dateStr = fmtDate(shift.date);
    const rate = shift.currentRate?.toFixed(0);

    const tokens = providers.filter((p) => p.expoPushToken).map((p) => p.expoPushToken);
    await sendPush(tokens, `New ${shift.specialty} Shift — $${rate}/hr`, `${facilityName} · ${dateStr} · ${shift.durationHours}h`, { shiftId: shift.id, type: 'NEW_SHIFT' });

    for (const p of providers) {
      if (!p.user?.email) continue;
      await sendEmail(
        p.user.email,
        `New ${shift.specialty} shift at ${facilityName} — $${rate}/hr`,
        emailTemplate('New Shift Available', `
          <p>Hi ${p.firstName || 'there'},</p>
          <p>A new <strong>${shift.specialty}</strong> shift has been posted:</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:120px">Facility</td><td style="padding:6px 0;font-weight:600">${facilityName}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Date</td><td style="padding:6px 0;font-weight:600">${dateStr}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Duration</td><td style="padding:6px 0;font-weight:600">${shift.durationHours} hours</td></tr>
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Rate</td><td style="padding:6px 0;font-weight:600;color:#6366F1">$${rate}/hr</td></tr>
          </table>
          <p>Open the SNAP app to view and book this shift before it fills.</p>
        `)
      );
    }
  } catch (err) {
    console.error('notifyShiftPosted error:', err.message);
  }
}

// ── 2. Provider booked → notify facility ──────────────────────────────────────

async function notifyBooking(shiftId, providerId) {
  try {
    const [shift, provider] = await Promise.all([
      prisma.shift.findUnique({ where: { id: shiftId }, include: { facility: { select: { id: true, name: true } } } }),
      prisma.providerProfile.findUnique({ where: { id: providerId } }),
    ]);
    if (!shift || !provider) return;

    const facilityEmail = await getFacilityEmail(shift.facility.id);
    const providerName = `${provider.firstName || ''} ${provider.lastName || ''}`.trim();
    const dateStr = fmtDate(shift.date);

    await sendEmail(
      facilityEmail,
      `Shift Booked — ${providerName} booked your ${shift.specialty} shift`,
      emailTemplate('Shift Booked', `
        <p>Your <strong>${shift.specialty}</strong> shift on <strong>${dateStr}</strong> has been booked.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:120px">Provider</td><td style="padding:6px 0;font-weight:600">${providerName}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Specialty</td><td style="padding:6px 0;font-weight:600">${provider.specialty}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Date</td><td style="padding:6px 0;font-weight:600">${dateStr}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Duration</td><td style="padding:6px 0;font-weight:600">${shift.durationHours} hours</td></tr>
        </table>
        <p>Log in to your facility portal to view full booking details.</p>
      `)
    );
  } catch (err) {
    console.error('notifyBooking error:', err.message);
  }
}

// ── 3. Provider applied → notify facility ─────────────────────────────────────

async function notifyApplication(shiftId, providerId) {
  try {
    const [shift, provider] = await Promise.all([
      prisma.shift.findUnique({ where: { id: shiftId }, include: { facility: { select: { id: true, name: true } } } }),
      prisma.providerProfile.findUnique({ where: { id: providerId } }),
    ]);
    if (!shift || !provider) return;

    const facilityEmail = await getFacilityEmail(shift.facility.id);
    const providerName = `${provider.firstName || ''} ${provider.lastName || ''}`.trim();
    const dateStr = fmtDate(shift.date);

    await sendEmail(
      facilityEmail,
      `New Application — ${providerName} applied to your ${shift.specialty} shift`,
      emailTemplate('New Application Received', `
        <p><strong>${providerName}</strong> has applied to your <strong>${shift.specialty}</strong> shift on <strong>${dateStr}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:120px">Provider</td><td style="padding:6px 0;font-weight:600">${providerName}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Specialty</td><td style="padding:6px 0;font-weight:600">${provider.specialty}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Experience</td><td style="padding:6px 0;font-weight:600">${provider.yearsExperience || '—'} yrs</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Credentialed</td><td style="padding:6px 0;font-weight:600">${provider.credentialed ? 'Yes' : 'No'}</td></tr>
        </table>
        <p>Log in to your facility portal to review and approve or reject this application.</p>
      `)
    );
  } catch (err) {
    console.error('notifyApplication error:', err.message);
  }
}

// ── 4. Application reviewed → notify provider ─────────────────────────────────

async function notifyApplicationReview(appId, status) {
  try {
    const app = await prisma.shiftApplication.findUnique({
      where: { id: appId },
      include: {
        provider: { include: { user: { select: { email: true } } } },
        shift: { include: { facility: { select: { name: true } } } },
      },
    });
    if (!app) return;

    const approved = status === 'APPROVED';
    const facilityName = app.shift.facility?.name || 'the facility';
    const dateStr = fmtDate(app.shift.date);

    if (app.provider.expoPushToken && Expo.isExpoPushToken(app.provider.expoPushToken)) {
      await sendPush(
        [app.provider.expoPushToken],
        approved ? 'Application Approved!' : 'Application Update',
        approved
          ? `${facilityName} approved your application for ${dateStr}`
          : `Your application for ${dateStr} was not approved`,
        { type: 'APPLICATION_REVIEW', shiftId: app.shiftId }
      );
    }

    await sendEmail(
      app.provider.user?.email,
      approved ? `Application Approved — ${facilityName}` : `Application Update — ${facilityName}`,
      emailTemplate(
        approved ? 'Application Approved' : 'Application Not Approved',
        approved
          ? `<p>Hi ${app.provider.firstName || 'there'},</p>
             <p>Great news! <strong>${facilityName}</strong> approved your application for the <strong>${app.shift.specialty}</strong> shift on <strong>${dateStr}</strong>.</p>
             <p>A SNAP coordinator will follow up with next steps for credentialing.</p>`
          : `<p>Hi ${app.provider.firstName || 'there'},</p>
             <p>Your application for the <strong>${app.shift.specialty}</strong> shift at <strong>${facilityName}</strong> on <strong>${dateStr}</strong> was not approved at this time.</p>
             <p>Keep browsing the SNAP app — new shifts are posted daily.</p>`
      )
    );
  } catch (err) {
    console.error('notifyApplicationReview error:', err.message);
  }
}

// ── 5. Completion confirmed → notify both parties ─────────────────────────────

async function notifyCompletionConfirmed(completionId) {
  try {
    const completion = await prisma.shiftCompletion.findUnique({
      where: { id: completionId },
      include: {
        provider: { include: { user: { select: { email: true } } } },
        booking: { include: { shift: { include: { facility: { select: { id: true, name: true } } } } } },
      },
    });
    if (!completion) return;

    const shift = completion.booking.shift;
    const facilityName = shift.facility?.name || 'the facility';
    const dateStr = fmtDate(shift.date);
    const providerName = `${completion.provider.firstName || ''} ${completion.provider.lastName || ''}`.trim();
    const finalHours = completion.facilityHours || completion.providerHours || 0;
    const total = (shift.currentRate * finalHours).toFixed(2);

    if (completion.provider.expoPushToken) {
      await sendPush(
        [completion.provider.expoPushToken],
        'Shift Complete — Payment Processing',
        `${facilityName} · ${dateStr} · $${total}`,
        { type: 'COMPLETION_CONFIRMED', shiftId: shift.id }
      );
    }

    await sendEmail(
      completion.provider.user?.email,
      `Shift Complete — ${facilityName} (${dateStr})`,
      emailTemplate('Shift Completed', `
        <p>Hi ${completion.provider.firstName || 'there'},</p>
        <p>Your shift at <strong>${facilityName}</strong> on <strong>${dateStr}</strong> has been confirmed complete by both parties.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:120px">Hours</td><td style="padding:6px 0;font-weight:600">${finalHours}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Rate</td><td style="padding:6px 0;font-weight:600">$${shift.currentRate}/hr</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Total</td><td style="padding:6px 0;font-weight:600;color:#10B981">$${total}</td></tr>
        </table>
        <p>Payment is now processing. Track your earnings in the SNAP app.</p>
      `)
    );

    const facilityEmail = await getFacilityEmail(shift.facility.id);
    await sendEmail(
      facilityEmail,
      `Shift Confirmed Complete — ${providerName} (${dateStr})`,
      emailTemplate('Shift Confirmed Complete', `
        <p>The <strong>${shift.specialty}</strong> shift on <strong>${dateStr}</strong> has been confirmed complete by both parties.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:120px">Provider</td><td style="padding:6px 0;font-weight:600">${providerName}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Hours</td><td style="padding:6px 0;font-weight:600">${finalHours}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Total</td><td style="padding:6px 0;font-weight:600">$${total}</td></tr>
        </table>
      `)
    );
  } catch (err) {
    console.error('notifyCompletionConfirmed error:', err.message);
  }
}

// ── 6. Dispute opened → notify both parties ───────────────────────────────────

async function notifyDispute(completionId) {
  try {
    const completion = await prisma.shiftCompletion.findUnique({
      where: { id: completionId },
      include: {
        provider: { include: { user: { select: { email: true } } } },
        booking: { include: { shift: { include: { facility: { select: { id: true, name: true } } } } } },
      },
    });
    if (!completion) return;

    const shift = completion.booking.shift;
    const facilityName = shift.facility?.name || 'the facility';
    const dateStr = fmtDate(shift.date);
    const providerName = `${completion.provider.firstName || ''} ${completion.provider.lastName || ''}`.trim();

    if (completion.provider.expoPushToken) {
      await sendPush(
        [completion.provider.expoPushToken],
        'Hours Under Review',
        `Hours for your ${dateStr} shift at ${facilityName} are being reviewed`,
        { type: 'DISPUTE', shiftId: shift.id }
      );
    }

    await sendEmail(
      completion.provider.user?.email,
      `Hours Dispute — ${facilityName} (${dateStr})`,
      emailTemplate('Hours Dispute Opened', `
        <p>Hi ${completion.provider.firstName || 'there'},</p>
        <p>There is a discrepancy in reported hours for your shift at <strong>${facilityName}</strong> on <strong>${dateStr}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:140px">You reported</td><td style="padding:6px 0;font-weight:600">${completion.providerHours} hours</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">Facility reported</td><td style="padding:6px 0;font-weight:600">${completion.facilityHours} hours</td></tr>
        </table>
        <p>A SNAP administrator will review and resolve this within 2 business days.</p>
      `)
    );

    const facilityEmail = await getFacilityEmail(shift.facility.id);
    await sendEmail(
      facilityEmail,
      `Hours Dispute — ${providerName} (${dateStr})`,
      emailTemplate('Hours Dispute Opened', `
        <p>There is a discrepancy in hours for the <strong>${shift.specialty}</strong> shift on <strong>${dateStr}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:140px">Provider reported</td><td style="padding:6px 0;font-weight:600">${completion.providerHours} hours</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;font-size:13px">You reported</td><td style="padding:6px 0;font-weight:600">${completion.facilityHours} hours</td></tr>
        </table>
        <p>A SNAP administrator will review and resolve this within 2 business days.</p>
      `)
    );
  } catch (err) {
    console.error('notifyDispute error:', err.message);
  }
}

// ── 7. Surge shift expiring ~12 hours → push opted-in providers ───────────────

async function notifySurgeExpiring() {
  try {
    const now = new Date();
    const in11h30 = new Date(now.getTime() + 11.5 * 3600000);
    const in12h30 = new Date(now.getTime() + 12.5 * 3600000);

    const shifts = await prisma.shift.findMany({
      where: { status: 'LIVE', surgeEnabled: true, expiresAt: { gte: in11h30, lte: in12h30 } },
      include: { facility: { select: { name: true } } },
    });

    for (const shift of shifts) {
      const providers = await prisma.providerProfile.findMany({
        where: { specialty: shift.specialty, notifSurge: true, expoPushToken: { not: null } },
      });
      if (!providers.length) continue;

      await sendPush(
        providers.map((p) => p.expoPushToken),
        `Surge Shift Expiring — $${shift.currentRate?.toFixed(0)}/hr`,
        `${shift.facility?.name || 'A facility'} · ${shift.specialty} · Expires in ~12 hours`,
        { shiftId: shift.id, type: 'SURGE_EXPIRING' }
      );
    }
  } catch (err) {
    console.error('notifySurgeExpiring error:', err.message);
  }
}

// ── SNAP Shifts: Availability window opened → push + SMS to roster ────────────

async function notifyWindowOpened(windowId) {
  try {
    const window = await prisma.availabilityWindow.findUnique({
      where: { id: windowId },
      include: { facility: { select: { name: true } } },
    });
    if (!window) return;

    const closeStr = new Date(window.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const msgBody = `${window.facility.name} is now collecting availability for "${window.windowName}". Please submit your availability by ${closeStr}. Open the SNAP app to respond.`;

    const rosterEntries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: window.facility.id, ...(window.notifyAll ? {} : {}) },
    });

    const linkedIds = rosterEntries.filter((r) => r.linkedProviderId).map((r) => r.linkedProviderId);
    if (linkedIds.length) {
      const profiles = await prisma.providerProfile.findMany({
        where: { id: { in: linkedIds } },
        select: { expoPushToken: true },
      });
      const tokens = profiles.filter((p) => p.expoPushToken).map((p) => p.expoPushToken);
      await sendPush(tokens, `${window.facility.name} — Availability Request`, msgBody, { type: 'WINDOW_OPENED', windowId });
    }

    for (const entry of rosterEntries) {
      if (entry.phoneNumber) await sendSMS(entry.phoneNumber, msgBody);
    }
  } catch (err) {
    console.error('notifyWindowOpened error:', err.message);
  }
}

// ── SNAP Shifts: Internal incentive shift posted → push + SMS to roster ───────

async function notifyIncentiveShiftPosted(incentiveShiftId) {
  try {
    const shift = await prisma.internalIncentiveShift.findUnique({
      where: { id: incentiveShiftId },
      include: { facility: { select: { name: true } } },
    });
    if (!shift) return;

    const dateStr = new Date(shift.shiftDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const msgBody = `${shift.facility.name} has a shift available on ${dateStr} at ${shift.facilityLocation} for ${shift.durationHours} hours. Incentive rate: $${shift.incentiveRate}/hour. Open the SNAP app to accept or decline.`;

    const rosterEntries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: shift.facilityId, providerType: shift.providerTypeRequired },
    });

    const linkedIds = rosterEntries.filter((r) => r.linkedProviderId).map((r) => r.linkedProviderId);
    if (linkedIds.length) {
      const profiles = await prisma.providerProfile.findMany({
        where: { id: { in: linkedIds } },
        select: { expoPushToken: true },
      });
      const tokens = profiles.filter((p) => p.expoPushToken).map((p) => p.expoPushToken);
      await sendPush(tokens, `Shift Available — $${shift.incentiveRate}/hr`, msgBody, { type: 'INCENTIVE_SHIFT', shiftId: incentiveShiftId });
    }

    for (const entry of rosterEntries) {
      if (entry.phoneNumber) await sendSMS(entry.phoneNumber, msgBody);
    }
  } catch (err) {
    console.error('notifyIncentiveShiftPosted error:', err.message);
  }
}

// ── SNAP Shifts: Schedule published → push + SMS all assigned providers ───────

async function notifySchedulePublished(facilityId, year, month) {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } });
    const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const msgBody = `Your schedule for ${monthName} has been posted by ${facility?.name}. Open the SNAP app to view your shifts.`;

    const assignments = await prisma.scheduleAssignment.findMany({
      where: {
        facilityId,
        scheduleDay: { date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } },
        rosterId: { not: null },
      },
      include: { rosterEntry: { select: { linkedProviderId: true, phoneNumber: true } } },
    });

    const seen = new Set();
    const linkedIds = [];
    for (const a of assignments) {
      if (a.rosterEntry?.linkedProviderId && !seen.has(a.rosterEntry.linkedProviderId)) {
        seen.add(a.rosterEntry.linkedProviderId);
        linkedIds.push(a.rosterEntry.linkedProviderId);
      }
    }

    if (linkedIds.length) {
      const profiles = await prisma.providerProfile.findMany({
        where: { id: { in: linkedIds } },
        select: { expoPushToken: true },
      });
      const tokens = profiles.filter((p) => p.expoPushToken).map((p) => p.expoPushToken);
      // Title leads with facility name so a multi-facility provider can
      // tell at a glance from the iOS lock screen which facility just
      // published. Body still carries the month + facility for full context.
      const pushTitle = `Schedule Posted — ${facility?.name || 'your facility'}`;
      await sendPush(tokens, pushTitle, msgBody, { type: 'SCHEDULE_PUBLISHED', facilityId, monthName });
      // Durable inbox row (Task #16) for every assigned provider.
      await recordNotifications(linkedIds, {
        type: 'SCHEDULE_PUBLISHED',
        title: pushTitle,
        body: msgBody,
        data: { facilityId, monthName },
      });
    }

    const seenPhone = new Set();
    for (const a of assignments) {
      const phone = a.rosterEntry?.phoneNumber;
      if (phone && !seenPhone.has(phone)) {
        seenPhone.add(phone);
        await sendSMS(phone, msgBody);
      }
    }
  } catch (err) {
    console.error('notifySchedulePublished error:', err.message);
  }
}

// ── SNAP Shifts: Incentive shift expiring unfilled → alert facility ───────────

async function checkExpiredIncentiveShifts() {
  try {
    const now = new Date();
    const expiring = await prisma.internalIncentiveShift.findMany({
      where: { status: 'OPEN', responseDeadline: { lte: now } },
      include: { facility: { select: { id: true, name: true } } },
    });
    for (const shift of expiring) {
      await prisma.internalIncentiveShift.update({ where: { id: shift.id }, data: { status: 'EXPIRED' } });
      const dateStr = new Date(shift.shiftDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const facilityEmail = await getFacilityEmail(shift.facility.id);
      await sendEmail(
        facilityEmail,
        `Unfilled Internal Shift — ${dateStr} at ${shift.facilityLocation}`,
        emailTemplate('Shift Not Yet Filled', `
          <p>Your internal incentive shift at <strong>${shift.facilityLocation}</strong> on <strong>${dateStr}</strong> has passed its response deadline and remains unfilled.</p>
          <p>Log in to your SNAP Shifts portal to post this shift to the external SNAP Marketplace to reach qualified providers.</p>
          <p style="margin-top:16px;font-size:13px;color:#64748B">Incentive Rate: $${shift.incentiveRate}/hr · Duration: ${shift.durationHours}h · Provider Type: ${shift.providerTypeRequired}</p>
        `)
      );
    }
  } catch (err) {
    console.error('checkExpiredIncentiveShifts error:', err.message);
  }
}

// ── Notification inbox (Task #16) ──────────────────────────────────────────────
// Persist a durable inbox row for one or more providers. Push is the wake-up
// channel; this is what the provider opens to see what happened. Fire-and-forget
// safe — never throws, so callers can `await` it without try/catch.
//
//   recordNotification(providerId, { type, title, body, data })
//   recordNotifications([id1, id2], { type, title, body, data })
async function recordNotification(providerId, { type, title, body, data = null }) {
  if (!providerId) return;
  try {
    await prisma.notification.create({
      data: { providerId, type, title, body, data: data || undefined },
    });
  } catch (err) {
    console.error('recordNotification error:', err.message);
  }
}

async function recordNotifications(providerIds, payload) {
  const ids = [...new Set((providerIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((providerId) => ({
        providerId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data || undefined,
      })),
    });
  } catch (err) {
    console.error('recordNotifications error:', err.message);
  }
}

// ── Recurring/bulk series posted → ONE batched alert (not N) ──────────────────
// A series can be dozens of shifts; sending a per-shift push/email would spam
// every matching provider. Send a single summary instead.
async function notifySeriesPosted({ facilityId, specialty, count, firstDate, lastDate, rate }) {
  try {
    const [facility, providers] = await Promise.all([
      prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
      prisma.providerProfile.findMany({
        where: { specialty, notifPreference: { not: 'NONE' } },
        include: { user: { select: { email: true } } },
      }),
    ]);
    if (!providers.length) return;

    const facilityName = facility?.name || 'a facility';
    const range = firstDate
      ? `${fmtDate(firstDate)}${lastDate && lastDate !== firstDate ? `–${fmtDate(lastDate)}` : ''}`
      : '';
    const title = `${count} new ${specialty} shifts — $${Number(rate).toFixed(0)}/hr`;
    const body = `${facilityName} · ${range}`;

    const tokens = providers.filter((p) => p.expoPushToken).map((p) => p.expoPushToken);
    await sendPush(tokens, title, body, { type: 'NEW_SHIFT_SERIES' });

    for (const p of providers) {
      if (!p.user?.email) continue;
      await sendEmail(
        p.user.email,
        `${count} new ${specialty} shifts at ${facilityName} — $${Number(rate).toFixed(0)}/hr`,
        emailTemplate('New Shifts Available', `
          <p>Hi ${p.firstName || 'there'},</p>
          <p><strong>${facilityName}</strong> just posted <strong>${count}</strong> new
             <strong>${specialty}</strong> shifts (${range}) at <strong>$${Number(rate).toFixed(0)}/hr</strong>.</p>
          <p>Open the SNAP app to view the dates that work for you and book before they fill.</p>
        `)
      );
    }
  } catch (err) {
    console.error('notifySeriesPosted error:', err.message);
  }
}

module.exports = {
  notifyShiftPosted,
  notifySeriesPosted,
  notifyBooking,
  notifyApplication,
  notifyApplicationReview,
  notifyCompletionConfirmed,
  notifyDispute,
  notifySurgeExpiring,
  // SNAP Shifts
  notifyWindowOpened,
  notifyIncentiveShiftPosted,
  notifySchedulePublished,
  checkExpiredIncentiveShifts,
  // Inbox (Task #16)
  recordNotification,
  recordNotifications,
  // Primitives exposed for use in route files
  sendSMS,
  sendPush,
  sendEmail,
};
