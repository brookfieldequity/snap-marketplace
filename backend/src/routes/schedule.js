const express = require('express');
const { Expo } = require('expo-server-sdk');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { sendSMS } = require('../services/notifications');

const router = express.Router();
const expo = new Expo();

// ── Constants ──────────────────────────────────────────────────────────────────

const HOURLY_RATE = {
  CRNA: 200,
  ANESTHESIOLOGIST: 300,
  ANESTHESIA_ASSISTANT: 175,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget Expo push to an array of tokens.
 */
async function sendPushNotifications(tokens, message) {
  const validTokens = tokens.filter((t) => t && Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return;

  const messages = validTokens.map((to) => ({ to, sound: 'default', body: message }));
  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    expo.sendPushNotificationsAsync(chunk).catch((err) => {
      console.error('Expo push error:', err);
    });
  }
}

/**
 * Return the inclusive start/end Date range for a given year + month (1-12).
 */
function monthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1); // exclusive upper bound
  return { start, end };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /month — all schedule days for the month with assignments and availability
router.get('/month', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }

    const { start, end } = monthRange(year, month);

    // Get linked provider IDs for this facility's roster
    const rosterEntries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, linkedProviderId: { not: null } },
      select: { id: true, linkedProviderId: true, providerName: true, providerType: true, employmentCategory: true },
    });
    const linkedProviderIds = rosterEntries.map((e) => e.linkedProviderId).filter(Boolean);
    const rosterByProviderId = Object.fromEntries(rosterEntries.map((e) => [e.linkedProviderId, e]));

    const [days, availabilities] = await Promise.all([
      prisma.scheduleDay.findMany({
        where: {
          facilityId: req.facility.id,
          date: { gte: start, lt: end },
        },
        include: {
          assignments: {
            include: {
              rosterEntry: {
                select: { providerName: true, providerType: true, employmentCategory: true },
              },
            },
          },
        },
        orderBy: { date: 'asc' },
      }),

      linkedProviderIds.length > 0
        ? prisma.providerAvailability.findMany({
            where: { date: { gte: start, lt: end }, available: true, providerId: { in: linkedProviderIds } },
            select: { providerId: true, date: true },
          })
        : Promise.resolve([]),
    ]);

    // Attach roster info to each availability row
    const availabilitiesWithRoster = availabilities.map((a) => ({
      ...a,
      rosterEntry: rosterByProviderId[a.providerId] || null,
    }));

    res.json({ days, availabilities: availabilitiesWithRoster });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /days — create or upsert a schedule day
router.post('/days', facilityAuth, async (req, res) => {
  try {
    const { date, location, roomsRequired } = req.body;

    const day = await prisma.scheduleDay.upsert({
      where: {
        facilityId_date_location: {
          facilityId: req.facility.id,
          date: new Date(date),
          location,
        },
      },
      update: {
        roomsRequired: roomsRequired !== undefined ? roomsRequired : undefined,
      },
      create: {
        facilityId: req.facility.id,
        date: new Date(date),
        location,
        roomsRequired: roomsRequired || 1,
      },
    });

    res.status(201).json(day);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /days/:id — delete a schedule day (assignments cascade via schema)
router.delete('/days/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.scheduleDay.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.scheduleDay.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /days/:dayId/assignments/:roomNumber — assign or unassign a provider to a room
router.put('/days/:dayId/assignments/:roomNumber', facilityAuth, async (req, res) => {
  try {
    const { rosterId } = req.body;
    const dayId = req.params.dayId;
    const roomNumber = parseInt(req.params.roomNumber, 10);

    const day = await prisma.scheduleDay.findUnique({ where: { id: dayId } });
    if (!day || day.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const assignment = await prisma.scheduleAssignment.upsert({
      where: {
        scheduleDayId_roomNumber: { scheduleDayId: dayId, roomNumber },
      },
      update: {
        rosterId: rosterId || null,
      },
      create: {
        scheduleDayId: dayId,
        roomNumber,
        facilityId: req.facility.id,
        rosterId: rosterId || null,
      },
    });

    res.json(assignment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /publish — publish all schedule days for a month and push assigned providers
router.post('/publish', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.body.year, 10);
    const month = parseInt(req.body.month, 10);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }

    const { start, end } = monthRange(year, month);

    const { count } = await prisma.scheduleDay.updateMany({
      where: {
        facilityId: req.facility.id,
        date: { gte: start, lt: end },
      },
      data: { publishedAt: new Date() },
    });

    res.json({ success: true, daysPublished: count });

    // Fire-and-forget push to all assigned providers
    (async () => {
      try {
        const days = await prisma.scheduleDay.findMany({
          where: {
            facilityId: req.facility.id,
            date: { gte: start, lt: end },
          },
          include: {
            assignments: {
              where: { rosterId: { not: null } },
              include: {
                rosterEntry: { select: { linkedProviderId: true, phoneNumber: true } },
              },
            },
          },
        });

        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        const msg = `Your schedule for ${monthLabel} has been posted by ${req.facility.name}. Tap here to view your shifts.`;

        // Collect unique assigned providers for push
        const providerIds = [
          ...new Set(
            days.flatMap((d) =>
              d.assignments.map((a) => a.rosterEntry?.linkedProviderId).filter(Boolean)
            )
          ),
        ];

        if (providerIds.length > 0) {
          const profiles = await prisma.providerProfile.findMany({
            where: { id: { in: providerIds }, expoPushToken: { not: null } },
            select: { expoPushToken: true },
          });
          await sendPushNotifications(profiles.map((p) => p.expoPushToken), msg);
        }

        // SMS to all assigned roster members with phone numbers (unique by phone)
        const phones = [
          ...new Set(
            days.flatMap((d) =>
              d.assignments.map((a) => a.rosterEntry?.phoneNumber).filter(Boolean)
            )
          ),
        ];
        await Promise.all(phones.map((phone) => sendSMS(phone, msg)));
      } catch (err) {
        console.error('Publish push/SMS error:', err);
      }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /export — return flat JSON array suitable for CSV download
router.get('/export', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }

    const { start, end } = monthRange(year, month);

    const days = await prisma.scheduleDay.findMany({
      where: {
        facilityId: req.facility.id,
        date: { gte: start, lt: end },
      },
      include: {
        assignments: {
          include: {
            rosterEntry: {
              select: { providerName: true, providerType: true, employmentCategory: true },
            },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const rows = [];
    for (const day of days) {
      for (const assignment of day.assignments) {
        rows.push({
          date: day.date.toISOString().split('T')[0],
          location: day.location,
          roomNumber: assignment.roomNumber,
          providerName: assignment.rosterEntry?.providerName || null,
          providerType: assignment.rosterEntry?.providerType || null,
          employmentCategory: assignment.rosterEntry?.employmentCategory || null,
        });
      }
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /summary — staffing + cost summary for a month
router.get('/summary', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }

    const { start, end } = monthRange(year, month);

    const days = await prisma.scheduleDay.findMany({
      where: {
        facilityId: req.facility.id,
        date: { gte: start, lt: end },
      },
      include: {
        assignments: {
          include: {
            rosterEntry: { select: { providerType: true } },
          },
        },
      },
    });

    let totalShifts = 0;
    let filled = 0;

    // Estimate 10-hour shifts per room per day as default duration
    const SHIFT_HOURS = 10;
    let estimatedCost = 0;

    for (const day of days) {
      totalShifts += day.roomsRequired;
      for (const assignment of day.assignments) {
        if (assignment.rosterId) {
          filled += 1;
          const providerType = assignment.rosterEntry?.providerType;
          const rate = HOURLY_RATE[providerType] || HOURLY_RATE.CRNA;
          estimatedCost += SHIFT_HOURS * rate;
        }
      }
    }

    const unfilled = totalShifts - filled;

    res.json({ totalShifts, filled, unfilled, estimatedCost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /feedback — record a provider selection (for Schedule Intelligence)
router.post('/feedback', facilityAuth, async (req, res) => {
  try {
    const { rosterId, shiftDate, facilityLocation, wasSuggested, suggestionRank, wasSelected } = req.body;
    if (!rosterId || !shiftDate || !facilityLocation) {
      return res.status(400).json({ error: 'rosterId, shiftDate, and facilityLocation are required' });
    }
    const feedback = await prisma.scheduleFeedback.create({
      data: {
        facilityId: req.facility.id,
        rosterId,
        shiftDate: new Date(shiftDate),
        facilityLocation,
        wasSuggested: !!wasSuggested,
        suggestionRank: suggestionRank != null ? parseInt(suggestionRank) : null,
        wasSelected: !!wasSelected,
      },
    });
    res.status(201).json(feedback);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /intelligence — Schedule Intelligence score
router.get('/intelligence', facilityAuth, async (req, res) => {
  try {
    const total = await prisma.scheduleFeedback.count({ where: { facilityId: req.facility.id } });
    const topRankSelected = await prisma.scheduleFeedback.count({
      where: { facilityId: req.facility.id, wasSuggested: true, wasSelected: true, suggestionRank: { lte: 3 } },
    });
    const suggested = await prisma.scheduleFeedback.count({
      where: { facilityId: req.facility.id, wasSuggested: true, wasSelected: true },
    });
    const totalSuggested = await prisma.scheduleFeedback.count({
      where: { facilityId: req.facility.id, wasSuggested: true },
    });

    const accuracy = totalSuggested > 0 ? Math.round((suggested / totalSuggested) * 100) : 0;
    const score = Math.min(100, Math.round((total / 50) * 100)); // hits 100% at 50 data points
    res.json({ dataPoints: total, accuracy, score });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
