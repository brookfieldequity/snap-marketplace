// Provider-facing schedule access (v1). A SNAP provider can view the daily board
// of any facility they're rostered + linked to, unless the facility revoked it.
// Leave REASONS are masked here (FMLA/Vac → "Off") — the facility's own view keeps
// the detail. See eor-model-spec.md / provider↔facility schedule access. The
// consumer is the provider mobile app; this is the API it calls.

const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth'); // generic provider JWT → req.user

const router = express.Router();
router.use(auth);

async function providerProfileId(req) {
  const p = await prisma.providerProfile.findUnique({
    where: { userId: req.user.userId },
    select: { id: true },
  });
  return p ? p.id : null;
}

// GET /facilities — facilities this provider can view a schedule for (linked +
// not revoked). The provider's affiliation list.
router.get('/facilities', async (req, res) => {
  try {
    const pid = await providerProfileId(req);
    if (!pid) return res.json({ facilities: [] });
    const rows = await prisma.internalRosterEntry.findMany({
      where: { linkedProviderId: pid, scheduleAccessRevoked: false },
      select: { facility: { select: { id: true, name: true } } },
    });
    const seen = new Set();
    const facilities = [];
    for (const r of rows) {
      if (r.facility && !seen.has(r.facility.id)) { seen.add(r.facility.id); facilities.push(r.facility); }
    }
    res.json({ facilities });
  } catch (err) {
    console.error('[provider-schedule/facilities]', err.message);
    res.status(500).json({ error: 'Failed to load facilities' });
  }
});

// GET /facility/:facilityId?date=YYYY-MM-DD — the published daily board, access-
// checked, with leave reasons masked.
router.get('/facility/:facilityId', async (req, res) => {
  try {
    const pid = await providerProfileId(req);
    if (!pid) return res.status(403).json({ error: 'No provider profile' });
    const { facilityId } = req.params;
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    // Access check: a non-revoked linked roster row at this facility.
    const access = await prisma.internalRosterEntry.findFirst({
      where: { facilityId, linkedProviderId: pid, scheduleAccessRevoked: false },
      select: { id: true },
    });
    if (!access) return res.status(403).json({ error: 'No schedule access for this facility' });

    const d = new Date(date);
    const days = await prisma.scheduleDay.findMany({
      where: { facilityId, date: d, publishedAt: { not: null } },
      include: { assignments: { include: { rosterEntry: { select: { providerName: true, providerType: true } } } } },
    });
    const board = [];
    for (const day of days) {
      for (const a of day.assignments) {
        board.push({
          location: day.location,
          room: a.roomNumber,
          role: a.role || null,
          provider: a.rosterEntry ? a.rosterEntry.providerName : null,
          providerType: a.rosterEntry ? a.rosterEntry.providerType : null,
        });
      }
    }

    // Out-list with masked reason — show that someone is out, never WHY.
    let out = [];
    try {
      const off = await prisma.rosterTimeOff.findMany({
        where: { rosterEntry: { facilityId }, startDate: { lte: d }, endDate: { gte: d } },
        include: { rosterEntry: { select: { providerName: true } } },
      });
      out = off.map((o) => ({ provider: o.rosterEntry ? o.rosterEntry.providerName : null, status: 'Off' }));
    } catch { /* time-off optional; board is the primary payload */ }

    res.json({ facilityId, date, board, out });
  } catch (err) {
    console.error('[provider-schedule/facility]', err.message);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

module.exports = router;
