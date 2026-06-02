/**
 * Holidays — per-facility override layer on top of the US federal calendar.
 *
 * The federal list lives in code (utils/federalHolidays.js); the DB only
 * stores explicit practice additions (PRACTICE_ADDED) or opt-outs from
 * federal holidays (PRACTICE_EXCLUDED). The "effective" list returned by
 * GET is computed at read time: federal ∪ added \ excluded.
 *
 * Used by the schedule generator (POST /api/schedule/generate) to know
 * which dates to skip.
 */

const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { getFederalHolidaysForYear } = require('../utils/federalHolidays');

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Build the effective holiday list for a given facility + year.
 *
 * Output shape: an array of { date: 'YYYY-MM-DD', label, source }, sorted by date.
 *   source = 'FEDERAL'           — inherited from the federal list (no DB row)
 *   source = 'PRACTICE_ADDED'    — explicit DB row
 *   source = 'PRACTICE_EXCLUDED' — federal date the practice chose to exclude;
 *                                  included in the response so the UI can
 *                                  show "Federal: Columbus Day — excluded"
 */
async function buildEffectiveList(facilityId, year) {
  const federal = getFederalHolidaysForYear(year);
  const overrides = await prisma.facilityHoliday.findMany({
    where: {
      facilityId,
      date: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
  });

  const excludedISO = new Set(
    overrides.filter((o) => o.source === 'PRACTICE_EXCLUDED').map((o) => isoDate(o.date))
  );
  const addedByISO = Object.fromEntries(
    overrides.filter((o) => o.source === 'PRACTICE_ADDED').map((o) => [isoDate(o.date), o])
  );

  const merged = [];

  // 1. Federal holidays (mark excluded ones distinctly)
  for (const fed of federal) {
    const iso = isoDate(fed.date);
    if (excludedISO.has(iso)) {
      merged.push({ date: iso, label: fed.label, source: 'PRACTICE_EXCLUDED' });
    } else {
      merged.push({ date: iso, label: fed.label, source: 'FEDERAL' });
    }
  }

  // 2. Practice-added (don't double-count anything that happens to coincide
  //    with a federal date — that should just stay FEDERAL).
  const federalISO = new Set(federal.map((f) => isoDate(f.date)));
  for (const [iso, row] of Object.entries(addedByISO)) {
    if (federalISO.has(iso)) continue; // shouldn't happen, but be safe
    merged.push({ date: iso, label: row.label, source: 'PRACTICE_ADDED', id: row.id });
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/**
 * Holiday dates the schedule generator should SKIP for a given facility +
 * year-month. Excludes PRACTICE_EXCLUDED federal dates (since the practice
 * is saying "don't skip those for us"). Used by /api/schedule/generate.
 */
async function getActiveHolidayDates(facilityId, year) {
  const list = await buildEffectiveList(facilityId, year);
  return new Set(list.filter((h) => h.source !== 'PRACTICE_EXCLUDED').map((h) => h.date));
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/facilities/:id/holidays?year=YYYY
 * The effective list for a year. Defaults to current year if omitted.
 */
router.get('/:id/holidays', facilityAuth, async (req, res) => {
  try {
    if (req.params.id !== req.facility.id) {
      return res.status(403).json({ error: 'Facility mismatch.' });
    }
    const yearParam = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();
    if (!Number.isInteger(yearParam) || yearParam < 2000 || yearParam > 2200) {
      return res.status(400).json({ error: 'Invalid year.' });
    }
    const holidays = await buildEffectiveList(req.params.id, yearParam);
    res.json({ year: yearParam, holidays });
  } catch (err) {
    console.error('[holidays] list failed:', err);
    res.status(500).json({ error: 'Failed to load holidays.' });
  }
});

/**
 * POST /api/facilities/:id/holidays
 * Add a practice-defined holiday.
 * body: { date: 'YYYY-MM-DD', label }
 */
router.post('/:id/holidays', facilityAuth, async (req, res) => {
  try {
    if (req.params.id !== req.facility.id) {
      return res.status(403).json({ error: 'Facility mismatch.' });
    }
    const { date, label } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    const trimmedLabel = String(label || '').trim();
    if (!trimmedLabel) return res.status(400).json({ error: 'label is required.' });

    const dateObj = new Date(`${date}T00:00:00.000Z`);

    const created = await prisma.facilityHoliday.create({
      data: {
        facilityId: req.facility.id,
        date: dateObj,
        label: trimmedLabel,
        source: 'PRACTICE_ADDED',
      },
    });
    res.status(201).json({ holiday: created });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A holiday already exists on that date.' });
    }
    console.error('[holidays] create failed:', err);
    res.status(500).json({ error: 'Failed to add holiday.' });
  }
});

/**
 * POST /api/facilities/:id/holidays/exclude
 * Toggle off a federal holiday for this practice.
 * body: { date: 'YYYY-MM-DD' }
 * Used when the practice wants to be open on a normally-federal holiday.
 */
router.post('/:id/holidays/exclude', facilityAuth, async (req, res) => {
  try {
    if (req.params.id !== req.facility.id) {
      return res.status(403).json({ error: 'Facility mismatch.' });
    }
    const { date } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    const dateObj = new Date(`${date}T00:00:00.000Z`);
    // Use upsert in case the practice toggles excluded ↔ not-excluded on the
    // same federal date repeatedly.
    const row = await prisma.facilityHoliday.upsert({
      where: {
        facilityId_date: { facilityId: req.facility.id, date: dateObj },
      },
      create: {
        facilityId: req.facility.id,
        date: dateObj,
        label: 'Excluded federal holiday', // label is computed at read-time anyway
        source: 'PRACTICE_EXCLUDED',
      },
      update: {
        source: 'PRACTICE_EXCLUDED',
      },
    });
    res.json({ holiday: row });
  } catch (err) {
    console.error('[holidays] exclude failed:', err);
    res.status(500).json({ error: 'Failed to exclude holiday.' });
  }
});

/**
 * DELETE /api/facilities/:id/holidays/:date
 * Removes a practice-added or practice-excluded override for the given date.
 * If the date was an excluded federal holiday, removing this row makes it
 * federally-observed again. If it was a practice-added day, it disappears.
 *
 * date format: YYYY-MM-DD (path param)
 */
router.delete('/:id/holidays/:date', facilityAuth, async (req, res) => {
  try {
    if (req.params.id !== req.facility.id) {
      return res.status(403).json({ error: 'Facility mismatch.' });
    }
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    const dateObj = new Date(`${date}T00:00:00.000Z`);
    const existing = await prisma.facilityHoliday.findUnique({
      where: { facilityId_date: { facilityId: req.facility.id, date: dateObj } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'No override exists for that date.' });
    }
    await prisma.facilityHoliday.delete({
      where: { facilityId_date: { facilityId: req.facility.id, date: dateObj } },
    });
    res.status(204).end();
  } catch (err) {
    console.error('[holidays] delete failed:', err);
    res.status(500).json({ error: 'Failed to remove holiday override.' });
  }
});

module.exports = router;
// Expose the helper for the schedule generator to use.
module.exports.getActiveHolidayDates = getActiveHolidayDates;
