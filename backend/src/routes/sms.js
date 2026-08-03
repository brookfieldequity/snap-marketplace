// Public SMS opt-in / opt-out routes — no auth. This backs the customer-facing
// opt-in web form at /sms-optin (the URL supplied to Twilio for toll-free
// verification): a person enters THEIR OWN number, reads the CTIA disclosures,
// and submits. sendSMS() in services/notifications.js refuses any number that
// hasn't opted in here (or via the availability-page consent checkbox), so
// this ledger is the real gate, not just paperwork.
//
// POST /api/sms/opt-in   { phoneNumber, firstName?, lastName?, consent: true }
// POST /api/sms/opt-out  { phoneNumber }
const express = require('express');
const prisma = require('../config/db');
const { normalizePhone } = require('../services/notifications');

const router = express.Router();

// The exact disclosure text the form shows next to the checkbox. Snapshotted
// onto each opt-in row so consent evidence survives later copy edits. Keep in
// sync with web/src/pages/public/SmsOptInPage.jsx.
const CONSENT_TEXT_V1 =
  'I agree to receive scheduling and account text messages from SNAP (Essential ' +
  'Anesthesia Partners LLC, d/b/a SNAP Medical Technologies) at the number ' +
  'provided. Message frequency varies; message & data rates may apply. Reply ' +
  'STOP to opt out, HELP for help. Consent is not a condition of employment or ' +
  'service. See SMS Terms and Privacy Policy.';

function clientIp(req) {
  // trust proxy is set in index.js, so req.ip is the real client behind Railway.
  return (req.ip || '').slice(0, 100) || null;
}

function cleanName(v) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null;
}

router.post('/opt-in', async (req, res) => {
  try {
    const { phoneNumber, firstName, lastName, consent } = req.body || {};
    if (consent !== true) {
      return res.status(400).json({ error: 'Consent checkbox is required.' });
    }
    const e164 = normalizePhone(phoneNumber);
    if (!e164) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number.' });
    }

    await prisma.smsOptIn.upsert({
      where: { phoneNumber: e164 },
      create: {
        phoneNumber: e164,
        source: 'WEB_FORM',
        firstName: cleanName(firstName),
        lastName: cleanName(lastName),
        ipAddress: clientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 300) || null,
        consentText: CONSENT_TEXT_V1,
      },
      // Re-submitting refreshes consent and clears any prior revocation
      // (someone who replied STOP can opt back in via the form).
      update: {
        consentedAt: new Date(),
        source: 'WEB_FORM',
        firstName: cleanName(firstName),
        lastName: cleanName(lastName),
        ipAddress: clientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 300) || null,
        consentText: CONSENT_TEXT_V1,
        revokedAt: null,
        revokedVia: null,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[sms] opt-in failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/opt-out', async (req, res) => {
  try {
    const e164 = normalizePhone(req.body?.phoneNumber);
    if (!e164) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number.' });
    }
    // updateMany so an unknown number is a silent no-op — the response never
    // reveals whether a number exists in the ledger (this route is public).
    await prisma.smsOptIn.updateMany({
      where: { phoneNumber: e164, revokedAt: null },
      data: { revokedAt: new Date(), revokedVia: 'FORM' },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sms] opt-out failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, CONSENT_TEXT_V1 };
