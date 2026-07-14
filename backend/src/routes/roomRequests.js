// Customer-facing (facilityAuth) admin side of the Facility Room-Count Card.
// The customer stores 1-2 contacts per location, then one-click sends a
// tokenized monthly room-count link to each site. Mirrors the provider
// availability admin flow (schedule.js /availability-requests/*).
//
//   GET    /api/room-requests/locations         — sites + their stored contacts
//   GET    /api/room-requests/contacts          — all contacts for the facility
//   POST   /api/room-requests/contacts          — add a contact (max 2 / site)
//   DELETE /api/room-requests/contacts/:id       — remove a contact
//   POST   /api/room-requests/send              — one-click send for a month
//   GET    /api/room-requests?year=&month=      — status board for a month
//   POST   /api/room-requests/:id/remind        — resend one location's link
const express = require('express');
const crypto = require('crypto');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { sendEmail } = require('../services/notifications');

const router = express.Router();

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MAX_CONTACTS_PER_LOCATION = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function webBaseUrl() {
  // APP_URL points to the marketplace web app (where the tokenized site page
  // lives), not the API host. Same resolution the availability send flow uses.
  return (process.env.APP_URL || process.env.MARKETING_URL || 'https://www.snapmedical.app').replace(/\/$/, '');
}

// Distinct locations SNAP already knows for this facility, from the schedule
// builder's own coverage templates (union any location that already has a
// contact, so a manually-added site still shows up).
async function knownLocations(facilityId) {
  const [templateDays, contacts] = await Promise.all([
    prisma.coverageTemplateDay.findMany({
      where: { template: { facilityId } },
      select: { location: true },
      distinct: ['location'],
    }),
    prisma.facilityLocationContact.findMany({
      where: { facilityId },
      select: { location: true },
      distinct: ['location'],
    }),
  ]);
  const set = new Set();
  for (const d of templateDays) if (d.location) set.add(d.location);
  for (const c of contacts) if (c.location) set.add(c.location);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function roomRequestEmail({ facilityName, location, monthName, year, deadlineStr, link }) {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#0F172A">
  <div style="font-size:22px;font-weight:800;color:#2563EB">SNAP</div>
  <p style="font-size:15px;line-height:1.6;color:#334155">
    ${facilityName} is building the anesthesia schedule for <strong>${location}</strong> for
    <strong>${monthName} ${year}</strong>, and needs your room counts to staff it to exactly what's running.
  </p>
  <p style="font-size:15px;line-height:1.6;color:#334155">
    Please open the link below and enter how many rooms will be running each day. It takes a couple of minutes,
    no login required.
  </p>
  <div style="text-align:center;margin:22px 0">
    <a href="${link}" style="display:inline-block;background:#2563EB;color:#fff;font-size:15px;font-weight:700;padding:13px 30px;border-radius:8px;text-decoration:none">
      Enter ${location} room counts →
    </a>
  </div>
  <p style="font-size:13px;color:#64748B">Please submit by <strong>${deadlineStr}</strong>. Questions? Just reply to this email.</p>
</div>`;
}

// Upsert one request per (facility, location, month) and email its contacts.
// Idempotent: an existing request keeps its token (so a link already sent stays
// valid); we refresh the deadline + sentAt and re-send.
async function upsertAndSend({ facilityId, facilityName, location, year, month, deadline, contacts }) {
  let request = await prisma.roomCountRequest.findUnique({
    where: { facilityId_location_year_month: { facilityId, location, year, month } },
  });
  if (!request) {
    request = await prisma.roomCountRequest.create({
      data: {
        token: crypto.randomBytes(16).toString('hex'),
        facilityId, location, year, month, deadline,
        sentAt: new Date(), sentVia: 'EMAIL',
      },
    });
  } else {
    request = await prisma.roomCountRequest.update({
      where: { id: request.id },
      data: { deadline, sentAt: new Date(), sentVia: 'EMAIL' },
    });
  }

  const link = `${webBaseUrl()}/rooms/${request.token}`;
  const monthName = MONTH_NAMES[month] || String(month);
  const deadlineStr = new Date(deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const html = roomRequestEmail({ facilityName, location, monthName, year, deadlineStr, link });

  let emailed = 0;
  for (const c of contacts) {
    try {
      await sendEmail(c.email, `SNAP — ${location} room counts for ${monthName} ${year}`, html);
      emailed++;
    } catch (e) {
      console.error(`[roomRequests] email to ${c.email} failed:`, e.message);
    }
  }
  return { request, emailed, link };
}

// ── Locations + contacts ──────────────────────────────────────────────────────

router.get('/locations', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const [locations, contacts] = await Promise.all([
      knownLocations(facilityId),
      prisma.facilityLocationContact.findMany({ where: { facilityId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const byLoc = {};
    for (const c of contacts) (byLoc[c.location] = byLoc[c.location] || []).push({ id: c.id, name: c.name, email: c.email });
    res.json({ locations: locations.map((location) => ({ location, contacts: byLoc[location] || [] })) });
  } catch (err) {
    console.error('[roomRequests] GET /locations failed:', err);
    res.status(500).json({ error: 'Failed to load locations' });
  }
});

router.get('/contacts', facilityAuth, async (req, res) => {
  try {
    const contacts = await prisma.facilityLocationContact.findMany({
      where: { facilityId: req.facility.id },
      orderBy: [{ location: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ contacts });
  } catch (err) {
    console.error('[roomRequests] GET /contacts failed:', err);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

router.post('/contacts', facilityAuth, async (req, res) => {
  try {
    const { location, name, email } = req.body || {};
    const loc = typeof location === 'string' ? location.trim() : '';
    const em = typeof email === 'string' ? email.trim() : '';
    if (!loc) return res.status(400).json({ error: 'location is required' });
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: 'a valid email is required' });

    const existing = await prisma.facilityLocationContact.count({
      where: { facilityId: req.facility.id, location: loc },
    });
    if (existing >= MAX_CONTACTS_PER_LOCATION) {
      return res.status(400).json({ error: `A location can have at most ${MAX_CONTACTS_PER_LOCATION} contacts.` });
    }

    const contact = await prisma.facilityLocationContact.create({
      data: {
        facilityId: req.facility.id,
        location: loc,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null,
        email: em.slice(0, 200),
      },
    });
    res.json({ contact });
  } catch (err) {
    console.error('[roomRequests] POST /contacts failed:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.delete('/contacts/:id', facilityAuth, async (req, res) => {
  try {
    const contact = await prisma.facilityLocationContact.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    await prisma.facilityLocationContact.delete({ where: { id: contact.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[roomRequests] DELETE /contacts failed:', err);
    res.status(500).json({ error: 'Failed to remove contact' });
  }
});

// ── One-click send ────────────────────────────────────────────────────────────

router.post('/send', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const { month, year, deadline, locations } = req.body || {};
    const mo = Number(month);
    const yr = Number(year);
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) return res.status(400).json({ error: 'month must be 1-12' });
    if (!Number.isInteger(yr) || yr < 2000 || yr > 2200) return res.status(400).json({ error: 'year is required' });
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) return res.status(400).json({ error: 'deadline must be a valid date' });

    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } });
    const facilityName = facility?.name || 'Your anesthesia group';

    // Send to the requested locations, or every location that has a contact.
    const allContacts = await prisma.facilityLocationContact.findMany({ where: { facilityId } });
    const contactsByLoc = {};
    for (const c of allContacts) (contactsByLoc[c.location] = contactsByLoc[c.location] || []).push(c);

    let targets = Array.isArray(locations) && locations.length
      ? locations.filter((l) => typeof l === 'string')
      : Object.keys(contactsByLoc);

    const results = [];
    for (const location of targets) {
      const contacts = contactsByLoc[location] || [];
      if (!contacts.length) {
        results.push({ location, sent: false, reason: 'no contact on file' });
        continue;
      }
      const { request, emailed } = await upsertAndSend({
        facilityId, facilityName, location, year: yr, month: mo, deadline: deadlineDate, contacts,
      });
      results.push({ location, sent: emailed > 0, emailed, requestId: request.id });
    }
    res.json({ results });
  } catch (err) {
    console.error('[roomRequests] POST /send failed:', err);
    res.status(500).json({ error: 'Failed to send room-count requests' });
  }
});

// ── Status board ──────────────────────────────────────────────────────────────

router.get('/', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const mo = Number(req.query.month);
    const yr = Number(req.query.year);
    if (!Number.isInteger(mo) || !Number.isInteger(yr)) {
      return res.status(400).json({ error: 'month and year query params are required' });
    }

    const [locations, requests] = await Promise.all([
      knownLocations(facilityId),
      prisma.roomCountRequest.findMany({
        where: { facilityId, year: yr, month: mo },
        include: { _count: { select: { dayCounts: true } } },
      }),
    ]);
    const byLoc = new Map(requests.map((r) => [r.location, r]));
    const now = new Date();

    const rows = locations.map((location) => {
      const r = byLoc.get(location);
      if (!r) return { location, status: 'NOT_SENT', requestId: null };
      const locked = now > new Date(r.deadline);
      return {
        location,
        requestId: r.id,
        status: r.submittedAt ? 'RETURNED' : (locked ? 'LOCKED_NO_RESPONSE' : 'SENT'),
        sentAt: r.sentAt?.toISOString() || null,
        submittedAt: r.submittedAt?.toISOString() || null,   // the timestamp shown in the builder
        deadline: r.deadline.toISOString(),
        daysSubmitted: r._count.dayCounts,
      };
    });
    res.json({ month: mo, year: yr, monthName: MONTH_NAMES[mo] || '', locations: rows });
  } catch (err) {
    console.error('[roomRequests] GET / failed:', err);
    res.status(500).json({ error: 'Failed to load room-request status' });
  }
});

router.post('/:id/remind', facilityAuth, async (req, res) => {
  try {
    const request = await prisma.roomCountRequest.findFirst({
      where: { id: req.params.id, facilityId: req.facility.id },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const [facility, contacts] = await Promise.all([
      prisma.facility.findUnique({ where: { id: req.facility.id }, select: { name: true } }),
      prisma.facilityLocationContact.findMany({ where: { facilityId: req.facility.id, location: request.location } }),
    ]);
    if (!contacts.length) return res.status(400).json({ error: 'No contact on file for this location.' });

    const { emailed } = await upsertAndSend({
      facilityId: req.facility.id,
      facilityName: facility?.name || 'Your anesthesia group',
      location: request.location,
      year: request.year, month: request.month, deadline: request.deadline, contacts,
    });
    res.json({ ok: true, emailed });
  } catch (err) {
    console.error('[roomRequests] POST /:id/remind failed:', err);
    res.status(500).json({ error: 'Failed to resend' });
  }
});

module.exports = router;
