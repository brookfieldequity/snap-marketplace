const express = require('express');
const crypto = require('crypto');
const { Expo } = require('expo-server-sdk');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const auth = require('../middleware/auth');
const { sendSMS } = require('../services/notifications');
const { logAutomationEvent } = require('../services/automationEvents');

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

// GET /exists — has this facility ever built a schedule? Powers the dashboard
// setup checklist. True if any ScheduleDay grid was generated OR any build run
// exists — across all months (a schedule built for a future month still
// counts), so we don't false-negative when the current month is empty.
router.get('/exists', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const [scheduleDays, buildRuns] = await Promise.all([
      prisma.scheduleDay.count({ where: { facilityId } }),
      prisma.scheduleBuildRun.count({ where: { facilityId } }),
    ]);
    res.json({ exists: scheduleDays > 0 || buildRuns > 0, scheduleDays, buildRuns });
  } catch (err) {
    console.error('[schedule/exists] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
            // Both available AND unavailable rows — the editor grays out
            // explicitly-unavailable providers (available: false), and the
            // "Available" tag uses available: true.
            where: { date: { gte: start, lt: end }, providerId: { in: linkedProviderIds } },
            select: { providerId: true, date: true, available: true, note: true },
          })
        : Promise.resolve([]),
    ]);

    // Attach the roster entry id (what the editor keys on) + the available flag.
    const availabilitiesWithRoster = availabilities.map((a) => {
      const entry = rosterByProviderId[a.providerId] || null;
      return {
        providerId: a.providerId,
        date: a.date,
        available: a.available,
        note: a.note || null, // Task #20 — surfaced in the day editor
        rosterId: entry?.id || null,
        rosterEntry: entry,
      };
    });

    // Time off / PTO overlapping the month — the editor grays out anyone off.
    const timeOff = await prisma.rosterTimeOff.findMany({
      where: { facilityId: req.facility.id, startDate: { lt: end }, endDate: { gte: start } },
      select: { id: true, rosterEntryId: true, startDate: true, endDate: true, reason: true },
    });

    res.json({ days, availabilities: availabilitiesWithRoster, timeOff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /days — create or upsert a schedule day
router.post('/days', facilityAuth, async (req, res) => {
  try {
    const { date, location, roomsRequired } = req.body;

    if (!date || !location?.trim()) {
      return res.status(400).json({ error: 'date and location are required' });
    }

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

// DELETE /month — clear a whole month's schedule (days + their assignments).
// Lets a coordinator start a month over before generating from a different
// Coverage Template. Assignments are deleted first (the FK is restrict, not
// cascade), then the days, in one transaction.
router.delete('/month', facilityAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }
    const { start, end } = monthRange(year, month);

    const days = await prisma.scheduleDay.findMany({
      where: { facilityId: req.facility.id, date: { gte: start, lt: end } },
      select: { id: true },
    });
    const dayIds = days.map((d) => d.id);
    if (dayIds.length === 0) {
      return res.json({ daysDeleted: 0, assignmentsDeleted: 0 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const assignments = await tx.scheduleAssignment.deleteMany({
        where: { scheduleDayId: { in: dayIds } },
      });
      const deletedDays = await tx.scheduleDay.deleteMany({ where: { id: { in: dayIds } } });
      return { assignmentsDeleted: assignments.count, daysDeleted: deletedDays.count };
    });

    res.json(result);
  } catch (err) {
    console.error('[schedule] clear month failed:', err);
    res.status(500).json({ error: 'Failed to clear month.' });
  }
});

// PUT /days/:dayId/assignments/:roomNumber — assign or unassign a provider to a room
router.put('/days/:dayId/assignments/:roomNumber', facilityAuth, async (req, res) => {
  try {
    const { rosterId, role } = req.body;
    const dayId = req.params.dayId;
    const roomNumber = parseInt(req.params.roomNumber, 10);

    if (!Number.isFinite(roomNumber)) {
      return res.status(400).json({ error: 'roomNumber must be a valid integer' });
    }

    const VALID_ROLES = ['CRNA_ROOM', 'SOLO_MD_ROOM', 'SUPERVISING_MD'];
    if (role !== undefined && role !== null && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const day = await prisma.scheduleDay.findUnique({ where: { id: dayId } });
    if (!day || day.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Only touch `role` when the caller sends it (manual room edits omit it, so
    // an existing room keeps its CRNA/Solo-MD tag; supervisor slots send
    // role='SUPERVISING_MD').
    const update = { rosterId: rosterId || null };
    if (role !== undefined) update.role = role || null;

    const assignment = await prisma.scheduleAssignment.upsert({
      where: {
        scheduleDayId_roomNumber: { scheduleDayId: dayId, roomNumber },
      },
      update,
      create: {
        scheduleDayId: dayId,
        roomNumber,
        facilityId: req.facility.id,
        rosterId: rosterId || null,
        role: role || null,
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

    const ROLE_LABEL = {
      CRNA_ROOM: 'CRNA room',
      SOLO_MD_ROOM: 'Solo MD room',
      SUPERVISING_MD: 'Supervising MD',
    };
    const rows = [];
    for (const day of days) {
      for (const assignment of day.assignments) {
        const isSupervisor = assignment.role === 'SUPERVISING_MD';
        rows.push({
          date: day.date.toISOString().split('T')[0],
          location: day.location,
          // Supervising MDs are stored at roomNumber >= 900 — label them
          // rather than printing a meaningless room number in the export.
          room: isSupervisor ? 'Supervising' : assignment.roomNumber,
          role: assignment.role ? ROLE_LABEL[assignment.role] || assignment.role : '',
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

    const [days, facility, siteRates] = await Promise.all([
      prisma.scheduleDay.findMany({
        where: {
          facilityId: req.facility.id,
          date: { gte: start, lt: end },
        },
        include: {
          assignments: {
            include: {
              rosterEntry: { select: { providerType: true, employmentCategory: true, annualRate: true, hourlyRate: true } },
            },
          },
        },
      }),
      prisma.facility.findUnique({
        where: { id: req.facility.id },
        select: { industryRoomRatePerDay: true },
      }),
      prisma.facilitySiteRate.findMany({
        where: { facilityId: req.facility.id },
        select: { siteName: true, ratePerDay: true },
      }),
    ]);

    const defaultRate = facility?.industryRoomRatePerDay || 0;
    const rateBySite = new Map(siteRates.map((r) => [r.siteName, r.ratePerDay]));

    let totalShifts = 0;
    let filled = 0;
    // Industry-baseline cost summed per-site so multi-ASC customers (CAPA)
    // see an accurate "your manual process" number when different sites are
    // priced differently. Falls back to Facility.industryRoomRatePerDay for
    // any site without an override.
    let baselineCost = 0;
    // Per-site rollup of room-days, for the cost-panel breakdown row.
    const siteRollup = new Map(); // siteName → { roomDays, baselineCost, rateUsed, hasOverride }

    let estimatedCost = 0;
    // Unique providers in this month's filled assignments who have no
    // explicit rate on the roster row. The Schedule Builder substitutes a
    // specialty/employment default for them, so the SNAP labor cost is an
    // estimate until rates are entered. Surface the count so the cost panel
    // can flag the savings number as approximate.
    const defaultRateProviderIds = new Set();

    for (const day of days) {
      totalShifts += day.roomsRequired;
      const siteName = day.location;
      const hasOverride = rateBySite.has(siteName);
      const siteRate = hasOverride ? rateBySite.get(siteName) : defaultRate;
      baselineCost += siteRate * day.roomsRequired;
      const r = siteRollup.get(siteName) || { roomDays: 0, baselineCost: 0, rateUsed: siteRate, hasOverride };
      r.roomDays += day.roomsRequired;
      r.baselineCost += siteRate * day.roomsRequired;
      siteRollup.set(siteName, r);

      for (const assignment of day.assignments) {
        if (assignment.rosterId) {
          filled += 1;
          // Same real-rate math as the schedule builder so the page shows ONE
          // consistent SNAP cost: each provider's actual rate x shift hours.
          if (assignment.rosterEntry) {
            estimatedCost += scheduleBuilder.SHIFT_HOURS_PER_DAY * scheduleBuilder.effectiveHourlyRate(assignment.rosterEntry);
            const re = assignment.rosterEntry;
            const hasRate = (re.hourlyRate && re.hourlyRate > 0) || (re.annualRate && re.annualRate > 0);
            if (!hasRate) defaultRateProviderIds.add(assignment.rosterId);
          }
        }
      }
    }

    const unfilled = totalShifts - filled;

    res.json({
      totalShifts,
      filled,
      unfilled,
      estimatedCost,
      baselineCost,
      defaultRateProviders: defaultRateProviderIds.size,
      siteBreakdown: [...siteRollup.entries()].map(([siteName, v]) => ({ siteName, ...v })),
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /generate — materialize a month's ScheduleDay rows from a Coverage
// Template, skipping the practice's effective holidays. See
// docs/coverage-templates-design.md.
//
// body: { year, month (1-12), templateId }
//
// Idempotent: re-running on the same (facility, year, month, template)
// upserts roomsRequired (bumps counts), NEVER deletes rows from prior runs.
// This is the conservative choice — coordinator's manual edits and prior
// generations are preserved.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate', facilityAuth, async (req, res) => {
  try {
    const { year, month, templateId } = req.body || {};
    const yr = Number(year);
    const mo = Number(month);
    if (!Number.isInteger(yr) || yr < 2000 || yr > 2200) {
      return res.status(400).json({ error: 'year is required and must be valid.' });
    }
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) {
      return res.status(400).json({ error: 'month is required and must be 1-12.' });
    }
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required.' });
    }

    // Load template scoped to caller's facility.
    const template = await prisma.coverageTemplate.findUnique({
      where: { id: templateId },
      include: { days: true },
    });
    if (!template || template.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    // Compute the active holiday set (federal merged with overrides) for
    // BOTH the year and the year-of-the-last-day-of-month (handles edge
    // case where month boundary touches Jan 1 — unlikely but cheap).
    const { getActiveHolidayDates } = require('./holidays');
    const holidaySet = await getActiveHolidayDates(req.facility.id, yr);

    // Index template days by dayOfWeek for O(1) lookup per date.
    const daysByDow = {};
    for (const d of template.days) {
      if (!daysByDow[d.dayOfWeek]) daysByDow[d.dayOfWeek] = [];
      daysByDow[d.dayOfWeek].push(d);
    }

    // Iterate every date in the requested month.
    const daysInMonth = new Date(yr, mo, 0).getDate(); // day 0 of next month = last day
    let rowsCreated = 0;
    let rowsUpdated = 0;
    let holidaysSkipped = 0;
    const locationsSeen = new Set();

    // Pre-load existing ScheduleDay rows for the month so we can report
    // created vs updated counts accurately (ScheduleDay has no createdAt/
    // updatedAt — we can't distinguish from the upsert response alone).
    const monthStart = new Date(Date.UTC(yr, mo - 1, 1));
    const monthEnd = new Date(Date.UTC(yr, mo, 1));
    const existingRows = await prisma.scheduleDay.findMany({
      where: {
        facilityId: req.facility.id,
        date: { gte: monthStart, lt: monthEnd },
      },
      select: { date: true, location: true },
    });
    const existingSet = new Set(
      existingRows.map((r) => `${r.date.toISOString().slice(0, 10)}::${r.location}`)
    );

    // Run all upserts in a transaction so partial generation doesn't leave
    // the schedule in a weird half-state.
    await prisma.$transaction(async (tx) => {
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(Date.UTC(yr, mo - 1, day));
        const iso = date.toISOString().slice(0, 10);

        if (holidaySet.has(iso)) {
          holidaysSkipped += 1;
          continue;
        }

        const dow = date.getUTCDay();
        const entries = daysByDow[dow] || [];
        for (const entry of entries) {
          if (entry.roomsRequired <= 0) continue; // template explicitly says "no rooms"
          locationsSeen.add(entry.location);
          const key = `${iso}::${entry.location}`;
          const wasExisting = existingSet.has(key);
          // Upsert ScheduleDay on the existing (facilityId, date, location)
          // unique constraint. Assignments live on a separate table and
          // reference ScheduleDay.id, which is preserved by upsert — they
          // are never affected by re-generation.
          await tx.scheduleDay.upsert({
            where: {
              facilityId_date_location: {
                facilityId: req.facility.id,
                date,
                location: entry.location,
              },
            },
            create: {
              facilityId: req.facility.id,
              date,
              location: entry.location,
              roomsRequired: entry.roomsRequired,
              supervisionRatio: entry.supervisionRatio ?? null,
            },
            update: {
              roomsRequired: entry.roomsRequired,
              supervisionRatio: entry.supervisionRatio ?? null,
            },
          });
          wasExisting ? rowsUpdated++ : rowsCreated++;
        }
      }
    }, { maxWait: 15000, timeout: 60000 });

    // Time-savings tracking — only count when the generation actually
    // created rows. Fire-and-forget.
    if (rowsCreated > 0) {
      logAutomationEvent({
        facilityId: req.facility.id,
        type: 'COVERAGE_TEMPLATE_GENERATE',
        metadata: {
          rowsCreated,
          rowsUpdated,
          holidaysSkipped,
          templateId: template.id,
        },
      });
    }

    res.json({
      summary: {
        rowsCreated,
        rowsUpdated,
        holidaysSkipped,
        locations: Array.from(locationsSeen).sort(),
      },
      template: { id: template.id, name: template.name },
    });
  } catch (err) {
    console.error('[schedule] generate failed:', err);
    res.status(500).json({ error: 'Failed to generate schedule.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule Builder v2 — POST /api/schedule/build, GET /:batchId, etc.
// See services/scheduleBuilder.js + docs/schedule-builder-v2-design.md
// ─────────────────────────────────────────────────────────────────────────────

const scheduleBuilder = require('../services/scheduleBuilder');

/**
 * POST /build
 * Triggers one or more build runs for a (year, month). Returns batchId
 * immediately; runs each mode synchronously (algorithm is fast — <1s per
 * mode for typical months). Future: queue + long-poll if algorithm gets
 * heavier.
 *
 * body: { year, month, modes: ['COST_EFFICIENT', 'HIGHEST_QUALITY', 'HYBRID', 'STAFFIQ'] }
 */
router.post('/build', facilityAuth, async (req, res) => {
  try {
    const { year, month, modes } = req.body || {};
    const yr = Number(year);
    const mo = Number(month);
    if (!Number.isInteger(yr) || yr < 2000 || yr > 2200) {
      return res.status(400).json({ error: 'year is required and must be valid.' });
    }
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) {
      return res.status(400).json({ error: 'month is required and must be 1-12.' });
    }
    const requestedModes = Array.isArray(modes) && modes.length > 0
      ? modes
      : scheduleBuilder.MODES; // default: run all four
    const invalid = requestedModes.filter((m) => !scheduleBuilder.MODES.includes(m));
    if (invalid.length) {
      return res.status(400).json({ error: `Unknown modes: ${invalid.join(', ')}` });
    }

    // Load inputs: ScheduleDay rows for the month + roster + StaffIQ weights
    const monthStart = new Date(Date.UTC(yr, mo - 1, 1));
    const monthEnd = new Date(Date.UTC(yr, mo, 1));
    const scheduleDays = await prisma.scheduleDay.findMany({
      where: { facilityId: req.facility.id, date: { gte: monthStart, lt: monthEnd } },
    });
    if (scheduleDays.length === 0) {
      return res.status(400).json({
        error: 'No schedule days exist for that month yet. Generate from a Coverage Template first.',
      });
    }
    const roster = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
    });
    if (roster.length === 0) {
      return res.status(400).json({
        error: 'Roster is empty. Add providers to your Internal Roster before building.',
      });
    }
    const staffiqWeights = await scheduleBuilder.resolveStaffIQWeights(req.facility.id);

    // Unavailability: PTO/time-off (keyed on rosterEntryId) + any explicit
    // "unavailable" availability rows (keyed on providerId). Build a Set of
    // `${rosterId}::${YYYY-MM-DD}` keys the builder HARD-excludes — a built
    // schedule must never place someone who's off.
    const linkedProviderIds = roster.map((r) => r.linkedProviderId).filter(Boolean);
    const providerIdToRosterId = Object.fromEntries(
      roster.filter((r) => r.linkedProviderId).map((r) => [r.linkedProviderId, r.id])
    );
    const [timeOff, unavailRows] = await Promise.all([
      prisma.rosterTimeOff.findMany({
        where: {
          facilityId: req.facility.id,
          startDate: { lt: monthEnd },
          endDate: { gte: monthStart },
        },
        select: { rosterEntryId: true, startDate: true, endDate: true },
      }),
      linkedProviderIds.length > 0
        ? prisma.providerAvailability.findMany({
            where: { available: false, date: { gte: monthStart, lt: monthEnd }, providerId: { in: linkedProviderIds } },
            select: { providerId: true, date: true },
          })
        : Promise.resolve([]),
    ]);
    const unavailableKeys = new Set();
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (const t of timeOff) {
      let d = new Date(Math.max(new Date(t.startDate).getTime(), monthStart.getTime()));
      const last = Math.min(new Date(t.endDate).getTime(), monthEnd.getTime() - DAY_MS);
      while (d.getTime() <= last) {
        unavailableKeys.add(`${t.rosterEntryId}::${d.toISOString().slice(0, 10)}`);
        d = new Date(d.getTime() + DAY_MS);
      }
    }
    for (const a of unavailRows) {
      const rid = providerIdToRosterId[a.providerId];
      if (rid) unavailableKeys.add(`${rid}::${new Date(a.date).toISOString().slice(0, 10)}`);
    }

    // Task #21: accepted "request to work" preferences for the build month.
    // Map of `${rosterId}::${YYYY-MM-DD}` → requested siteName (null = any).
    // The builder biases these providers into the schedule on those dates.
    const workRequests = await prisma.scheduleRequest.findMany({
      where: {
        facilityId: req.facility.id,
        type: 'WORK',
        status: 'ACCEPTED',
        date: { gte: monthStart, lt: monthEnd },
      },
      select: { rosterEntryId: true, date: true, siteName: true },
    });
    const workRequestKeys = new Map();
    for (const w of workRequests) {
      workRequestKeys.set(
        `${w.rosterEntryId}::${new Date(w.date).toISOString().slice(0, 10)}`,
        w.siteName || null
      );
    }

    // Shared input snapshot — lets us reproduce and explain each run later.
    const inputSnapshot = {
      generatedAt: new Date().toISOString(),
      scheduleDayCount: scheduleDays.length,
      rosterCount: roster.length,
      staffiqWeights,
      // Persist enough roster data to reconstruct: id, name, type, employment,
      // rates, reliability. Not the entire object (keeps the JSON tractable).
      rosterSnapshot: roster.map((r) => ({
        id: r.id,
        name: r.providerName,
        type: r.providerType,
        employment: r.employmentCategory,
        hourlyRate: r.hourlyRate,
        annualRate: r.annualRate,
        reliabilityScore: r.reliabilityScore,
      })),
    };

    const buildBatchId = crypto.randomUUID();
    const userId = req.user.userId || req.user.id;

    // Run each requested mode and persist a ScheduleBuildRun row per mode.
    // For v1 we run synchronously (algorithm is fast). Wrapping in
    // Promise.all so they don't block each other on DB writes.
    const runs = await Promise.all(
      requestedModes.map(async (mode) => {
        const startedAt = new Date();
        try {
          const { assignments, insights, warnings, score, staffiqRecommendations } =
            await scheduleBuilder.runMode({
              mode,
              scheduleDays,
              roster,
              staffiqWeights,
              unavailableKeys,
              workRequestKeys,
            });
          return prisma.scheduleBuildRun.create({
            data: {
              facilityId: req.facility.id,
              year: yr,
              month: mo,
              buildBatchId,
              mode,
              status: 'COMPLETE',
              inputSnapshot,
              assignments,
              staffiqScore: score,
              insights,
              warnings,
              staffiqRecommendations,
              startedAt,
              completedAt: new Date(),
              triggeredByUserId: userId,
            },
          });
        } catch (err) {
          console.error(`[schedule:build] ${mode} failed:`, err);
          return prisma.scheduleBuildRun.create({
            data: {
              facilityId: req.facility.id,
              year: yr,
              month: mo,
              buildBatchId,
              mode,
              status: 'FAILED',
              inputSnapshot,
              assignments: [],
              warnings: [err.message || 'Unknown error'],
              startedAt,
              completedAt: new Date(),
              triggeredByUserId: userId,
            },
          });
        }
      })
    );

    // Time-savings tracking — one AutomationEvent per BATCH (not per
    // mode). 4-mode batches don't replace 4 manual scheduling sessions;
    // they replace ONE. Conservative counting keeps the dollars-saved
    // number honest for pitch-deck use.
    const successfulRuns = runs.filter((r) => r.status !== 'FAILED');
    if (successfulRuns.length > 0) {
      logAutomationEvent({
        facilityId: req.facility.id,
        type: 'SCHEDULE_BUILD_RUN',
        metadata: {
          buildBatchId,
          modesAttempted: runs.length,
          modesSucceeded: successfulRuns.length,
          succeededModes: successfulRuns.map((r) => r.mode),
        },
      });
    }

    res.status(201).json({
      buildBatchId,
      runs: runs.map(serializeRun),
    });
  } catch (err) {
    console.error('[schedule:build] failed:', err);
    res.status(500).json({ error: 'Failed to build schedule.' });
  }
});

/**
 * GET /build/:batchId
 * Returns all runs in a batch (1-4 entries per batchId). Used by the
 * compare-all UI.
 */
router.get('/build/:batchId', facilityAuth, async (req, res) => {
  try {
    const runs = await prisma.scheduleBuildRun.findMany({
      where: { buildBatchId: req.params.batchId, facilityId: req.facility.id },
      orderBy: { mode: 'asc' },
    });
    if (runs.length === 0) return res.status(404).json({ error: 'Batch not found.' });
    res.json({ runs: runs.map(serializeRun) });
  } catch (err) {
    console.error('[schedule:build] get batch failed:', err);
    res.status(500).json({ error: 'Failed to load build batch.' });
  }
});

/**
 * POST /build/:runId/select
 * Coordinator picks a run as the active schedule. Materializes the run's
 * assignments JSON into real ScheduleAssignment rows (upserting on the
 * existing @@unique([scheduleDayId, roomNumber])), and marks the other
 * runs in the same batch as SUPERSEDED so the UI can hide them.
 */
router.post('/build/:runId/select', facilityAuth, async (req, res) => {
  try {
    const run = await prisma.scheduleBuildRun.findUnique({
      where: { id: req.params.runId },
    });
    if (!run || run.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Build run not found.' });
    }
    if (run.status !== 'COMPLETE') {
      return res.status(409).json({ error: `Run is ${run.status.toLowerCase()}.` });
    }

    const assignments = Array.isArray(run.assignments) ? run.assignments : [];

    // Distinct schedule days this run touches. We clear + recreate their
    // assignments rather than upserting one room at a time — a full month
    // across multiple locations can be hundreds of rooms, and serial
    // upserts inside an interactive transaction blow Prisma's 5s timeout
    // ("Transaction not found"). deleteMany + createMany is 2 queries
    // regardless of room count.
    const dayIds = [...new Set(assignments.map((a) => a.scheduleDayId))];

    await prisma.$transaction(
      async (tx) => {
        // Replace assignments for the affected days with this run's picks.
        if (dayIds.length > 0) {
          await tx.scheduleAssignment.deleteMany({
            where: { scheduleDayId: { in: dayIds } },
          });
        }
        if (assignments.length > 0) {
          await tx.scheduleAssignment.createMany({
            data: assignments.map((a) => ({
              scheduleDayId: a.scheduleDayId,
              roomNumber: a.roomNumber,
              rosterId: a.rosterId,
              facilityId: req.facility.id,
              role: a.role ?? null,
            })),
            skipDuplicates: true,
          });
        }
        // Mark this run as selected, others in batch as superseded.
        await tx.scheduleBuildRun.update({
          where: { id: req.params.runId },
          data: { selectedAt: new Date() },
        });
        await tx.scheduleBuildRun.updateMany({
          where: {
            buildBatchId: run.buildBatchId,
            facilityId: req.facility.id,
            NOT: { id: req.params.runId },
            status: 'COMPLETE',
          },
          data: { status: 'SUPERSEDED' },
        });
      },
      // Safety margin over the 5s default in case createMany is large or
      // Neon latency spikes.
      { timeout: 30000, maxWait: 10000 }
    );

    res.json({
      assignmentsApplied: assignments.length,
      message: `Schedule activated using "${run.mode}" build (StaffIQ score ${run.staffiqScore}).`,
    });
  } catch (err) {
    console.error('[schedule:build] select failed:', err);
    res.status(500).json({ error: 'Failed to select build run.' });
  }
});

/**
 * POST /build/:runId/rescore
 * Recompute the StaffIQ score for the selected run based on the schedule's
 * CURRENT assignments (which may have been edited by the coordinator after
 * selection). Persists the updated score and returns the delta.
 */
router.post('/build/:runId/rescore', facilityAuth, async (req, res) => {
  try {
    const run = await prisma.scheduleBuildRun.findUnique({
      where: { id: req.params.runId },
    });
    if (!run || run.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Build run not found.' });
    }

    // Pull the CURRENT state of the month's assignments (post-edits).
    const monthStart = new Date(Date.UTC(run.year, run.month - 1, 1));
    const monthEnd = new Date(Date.UTC(run.year, run.month, 1));
    const days = await prisma.scheduleDay.findMany({
      where: { facilityId: req.facility.id, date: { gte: monthStart, lt: monthEnd } },
      include: { assignments: true },
    });
    const roster = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
    });

    const currentAssignments = days.flatMap((d) =>
      d.assignments
        .filter((a) => a.rosterId)
        .map((a) => ({ scheduleDayId: d.id, roomNumber: a.roomNumber, rosterId: a.rosterId }))
    );
    const insights = scheduleBuilder.computeInsights({
      mode: run.mode,
      assignments: currentAssignments,
      roster,
    });
    const newScore = scheduleBuilder.computeStaffIQScore({
      mode: run.mode,
      assignments: currentAssignments,
      roster,
      warnings: [],
      scheduleDays: days,
    });
    const delta = newScore - (run.staffiqScore || 0);

    // Cost delta — what most coordinators actually care about. The run's
    // stored insights hold the cost as of the last build/score; compare to
    // the freshly-computed cost after the coordinator's edits.
    const previousCost =
      run.insights && typeof run.insights === 'object' ? run.insights.totalCost ?? null : null;
    const newCost = insights.totalCost ?? null;
    const costDelta =
      previousCost != null && newCost != null ? newCost - previousCost : null;

    // Recompute the CRNA-gap recommendations from the edited schedule so the
    // StaffIQ savings reflect the coordinator's current room assignments.
    const crnaGaps = scheduleBuilder.deriveCrnaGaps(days);
    const staffiqRecommendations = scheduleBuilder.computeCrnaGapRecommendations(crnaGaps, roster);

    await prisma.scheduleBuildRun.update({
      where: { id: req.params.runId },
      data: { staffiqScore: newScore, insights, staffiqRecommendations },
    });

    res.json({
      score: newScore,
      previousScore: run.staffiqScore,
      delta,
      previousCost,
      newCost,
      costDelta,
      insights,
      staffiqRecommendations,
    });
  } catch (err) {
    console.error('[schedule:build] rescore failed:', err);
    res.status(500).json({ error: 'Failed to rescore.' });
  }
});

/**
 * Trim a build run for transport — strip the giant inputSnapshot from
 * responses unless the client explicitly asks for it (future query param).
 */
function serializeRun(run) {
  return {
    id: run.id,
    facilityId: run.facilityId,
    year: run.year,
    month: run.month,
    buildBatchId: run.buildBatchId,
    mode: run.mode,
    status: run.status,
    staffiqScore: run.staffiqScore,
    insights: run.insights,
    warnings: run.warnings,
    staffiqRecommendations: run.staffiqRecommendations,
    assignmentCount: Array.isArray(run.assignments) ? run.assignments.length : 0,
    selectedAt: run.selectedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

// ─── Provider-facing schedule reads ────────────────────────────────────────
//
// Marketplace mobile (provider JWT) consumes these for:
//   - "My Schedule" — the provider's own monthly shifts across all rosters
//     they're on (a locum could be on two facilities).
//   - "Today" — the full daily schedule at a facility they're credentialed at
//     (read-only window into the coordinator's schedule).
//   - iCal subscription — an Apple/Google Calendar feed that auto-syncs.
//
// Cross-facility model: a marketplace ProviderProfile can be linked from
// multiple InternalRosterEntry rows (one per facility). All endpoints below
// pull the union, scoped to the calling provider.

async function rosterEntriesForProvider(userId) {
  const provider = await prisma.providerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!provider) return [];
  return prisma.internalRosterEntry.findMany({
    where: { linkedProviderId: provider.id },
    select: { id: true, facilityId: true, providerName: true, facility: { select: { id: true, name: true } } },
  });
}

// GET /my-month?year=&month= — provider's own assignments for the month.
router.get('/my-month', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }
    const memberships = await rosterEntriesForProvider(req.user.userId);
    if (memberships.length === 0) return res.json({ assignments: [], memberships: [] });
    const rosterIds = memberships.map((m) => m.id);
    const { start, end } = monthRange(year, month);

    const assignments = await prisma.scheduleAssignment.findMany({
      where: {
        rosterId: { in: rosterIds },
        scheduleDay: { date: { gte: start, lt: end } },
      },
      include: {
        scheduleDay: { select: { id: true, date: true, location: true, supervisionRatio: true } },
      },
      orderBy: [{ scheduleDay: { date: 'asc' } }, { roomNumber: 'asc' }],
    });

    // ScheduleAssignment carries facilityId only; resolve to {id,name} via
    // the membership map (which we already have in memory).
    const facilityById = new Map(memberships.map((m) => [m.facilityId, m.facility]));

    res.json({
      memberships,
      assignments: assignments.map((a) => ({
        date: a.scheduleDay.date,
        location: a.scheduleDay.location,
        roomNumber: a.roomNumber,
        role: a.role,
        facility: facilityById.get(a.facilityId) || { id: a.facilityId, name: null },
        supervisionRatio: a.scheduleDay.supervisionRatio,
      })),
    });
  } catch (err) {
    console.error('[schedule] my-month failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /today-at/:facilityId?date=YYYY-MM-DD — full daily schedule for a facility
// the provider is credentialed at. Provider sees colleagues' assignments
// (rooms + roles) but NOT pay rates / contact info. Date defaults to today.
router.get('/today-at/:facilityId', auth, async (req, res) => {
  try {
    const facilityId = req.params.facilityId;
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    // Authorize: provider must be on this facility's roster (covers CAPA
    // pilot's internal-staff model). Cross-facility marketplace providers
    // who aren't on the roster can't see this — fine for v1.
    const memberships = await rosterEntriesForProvider(req.user.userId);
    if (!memberships.some((m) => m.facilityId === facilityId)) {
      return res.status(403).json({ error: 'Not on this facility roster' });
    }

    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const days = await prisma.scheduleDay.findMany({
      where: {
        facilityId,
        date: { gte: dayStart, lt: dayEnd },
      },
      include: {
        assignments: {
          include: {
            rosterEntry: { select: { id: true, providerName: true, providerType: true } },
          },
          orderBy: { roomNumber: 'asc' },
        },
      },
      orderBy: { location: 'asc' },
    });

    res.json({
      date: dateStr,
      sites: days.map((d) => ({
        location: d.location,
        roomsRequired: d.roomsRequired,
        supervisionRatio: d.supervisionRatio,
        assignments: d.assignments.map((a) => ({
          roomNumber: a.roomNumber,
          role: a.role,
          provider: a.rosterEntry
            ? { id: a.rosterEntry.id, name: a.rosterEntry.providerName, type: a.rosterEntry.providerType }
            : null,
        })),
      })),
    });
  } catch (err) {
    console.error('[schedule] today-at failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /ical-subscribe — return the provider's personal iCal URL(s),
// minting an icalToken on the roster entries that don't have one yet.
// Body: { rotate?: true } regenerates the token (invalidates old URLs).
// One URL per facility membership — Apple Calendar can subscribe to all.
router.post('/ical-subscribe', auth, async (req, res) => {
  try {
    const rotate = req.body?.rotate === true;
    const memberships = await rosterEntriesForProvider(req.user.userId);
    if (memberships.length === 0) return res.json({ subscriptions: [] });

    const updated = [];
    for (const m of memberships) {
      const full = await prisma.internalRosterEntry.findUnique({
        where: { id: m.id },
        select: { id: true, icalToken: true },
      });
      let token = full?.icalToken;
      if (!token || rotate) {
        token = crypto.randomBytes(24).toString('hex');
        await prisma.internalRosterEntry.update({
          where: { id: m.id },
          data: { icalToken: token },
        });
      }
      updated.push({
        rosterEntryId: m.id,
        facility: m.facility,
        url: `${publicBaseUrl(req)}/api/schedule/ical/${m.id}/${token}.ics`,
      });
    }
    res.json({ subscriptions: updated, rotated: rotate });
  } catch (err) {
    console.error('[schedule] ical-subscribe failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function publicBaseUrl(req) {
  // Prefer an explicit PUBLIC_BASE_URL env var (e.g. https://api.snapmedical.app)
  // so reverse-proxy headers can't be spoofed into our URLs. Falls back to the
  // request's host header for local dev.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function icsEscape(s) {
  // RFC 5545 §3.3.11 — escape commas, semicolons, backslashes, and newlines.
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsUtc(d) {
  // 2026-06-09T16:30:00 → 20260609T163000Z (RFC 5545 §3.3.5).
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) +
    'T' +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) +
    'Z'
  );
}

// GET /ical/:rosterEntryId/:icalToken.ics — UNAUTHENTICATED iCalendar feed.
// Apple Calendar / Google Calendar / Outlook subscribe by URL and poll
// periodically; the URL token is the only credential. Rotating it (via
// /ical-subscribe?rotate=true) invalidates the old URL.
router.get('/ical/:rosterEntryId/:rest', async (req, res) => {
  try {
    // Strip the optional ".ics" suffix from the last path segment.
    const tokenWithExt = String(req.params.rest || '');
    const icalToken = tokenWithExt.endsWith('.ics') ? tokenWithExt.slice(0, -4) : tokenWithExt;
    const rosterEntryId = req.params.rosterEntryId;
    if (!icalToken || icalToken.length < 16) {
      return res.status(400).send('Invalid subscription URL');
    }
    const rosterEntry = await prisma.internalRosterEntry.findUnique({
      where: { id: rosterEntryId },
      select: { id: true, providerName: true, icalToken: true, facility: { select: { name: true } } },
    });
    if (!rosterEntry || !rosterEntry.icalToken || rosterEntry.icalToken !== icalToken) {
      return res.status(404).send('Subscription not found');
    }

    // Pull a ±60-day window of assignments — enough for Apple Calendar to
    // show the past month and the next two without an unbounded query.
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const assignments = await prisma.scheduleAssignment.findMany({
      where: {
        rosterId: rosterEntryId,
        scheduleDay: { date: { gte: windowStart, lt: windowEnd } },
      },
      include: {
        scheduleDay: { select: { date: true, location: true } },
      },
      orderBy: { scheduleDay: { date: 'asc' } },
    });

    // Build the .ics body. Shift hours default to a single 8-hour block
    // 07:00–15:00 local — v1 doesn't store per-room times; future work.
    const facilityName = rosterEntry.facility?.name || 'SNAP Shifts';
    const calName = `${facilityName} — ${rosterEntry.providerName}`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SNAP Medical//SNAP Shifts iCal v1//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(calName)}`,
      'X-WR-TIMEZONE:UTC',
    ];
    for (const a of assignments) {
      // Anchor shift to 07:00–15:00 ET (≈11:00–19:00 UTC); the calendar
      // surfaces this as an 8-hour block on the right day regardless of
      // the client's timezone.
      const date = new Date(a.scheduleDay.date);
      const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 11, 0, 0));
      const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
      const room = a.roomNumber >= 900 ? `Supervisor` : `Room ${a.roomNumber}`;
      const summary = `${a.scheduleDay.location} · ${room}`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:snap-shift-${a.id}@snapmedical.app`);
      lines.push(`DTSTAMP:${icsUtc(now)}`);
      lines.push(`DTSTART:${icsUtc(start)}`);
      lines.push(`DTEND:${icsUtc(end)}`);
      lines.push(`SUMMARY:${icsEscape(summary)}`);
      lines.push(`LOCATION:${icsEscape(a.scheduleDay.location)}`);
      lines.push(`DESCRIPTION:${icsEscape(`Role: ${a.role || 'unspecified'}\nFacility: ${facilityName}`)}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="snap-shifts-${rosterEntry.id}.ics"`,
      // Apple Calendar typically polls every 5–60 min; let it cache 5 min.
      'Cache-Control': 'private, max-age=300',
    });
    res.send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    console.error('[schedule] ical feed failed:', err);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;
