const express = require('express');
const { Expo } = require('expo-server-sdk');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
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
    });

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
const crypto = require('crypto');

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
          const { assignments, insights, warnings, score } = await scheduleBuilder.runMode({
            mode,
            scheduleDays,
            roster,
            staffiqWeights,
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

    await prisma.scheduleBuildRun.update({
      where: { id: req.params.runId },
      data: { staffiqScore: newScore, insights },
    });

    res.json({
      score: newScore,
      previousScore: run.staffiqScore,
      delta,
      previousCost,
      newCost,
      costDelta,
      insights,
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
    assignmentCount: Array.isArray(run.assignments) ? run.assignments.length : 0,
    selectedAt: run.selectedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

module.exports = router;
