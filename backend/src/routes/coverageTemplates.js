/**
 * Coverage Templates — per-practice staffing patterns.
 *
 * See docs/coverage-templates-design.md for the full design. v1 only stores
 * (location, dayOfWeek, roomsRequired) triples; v1.1 will add role-mix rules
 * that feed StaffIQ.
 *
 * All endpoints scoped via facilityAuth — coordinators only see/edit their
 * own practice's templates.
 */

const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate the shape of `days[]` from a request body. Returns a normalized
 * array suitable for direct insert, or throws an Error with a 400-friendly
 * message.
 */
function normalizeDays(days) {
  if (!Array.isArray(days)) {
    throw new Error('days must be an array.');
  }
  const seen = new Set();
  const result = [];
  for (const d of days) {
    const location = String(d?.location || '').trim();
    const dayOfWeek = Number(d?.dayOfWeek);
    const roomsRequired = Number(d?.roomsRequired);

    if (!location) throw new Error('Each day entry requires a non-empty location.');
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new Error('dayOfWeek must be an integer 0-6 (0=Sun, 6=Sat).');
    }
    if (!Number.isInteger(roomsRequired) || roomsRequired < 0) {
      throw new Error('roomsRequired must be a non-negative integer.');
    }
    // Coverage model via supervisionRatio:
    //   null = unset → legacy role-agnostic (any provider any room)
    //   0    = MD-only (every room a solo anesthesiologist)
    //   3/4  = team 1:3 / 1:4 (CRNA rooms supervised by MDs at the ratio)
    // Only truly-absent values map to null; an explicit 0 means MD-only.
    let supervisionRatio = d?.supervisionRatio;
    if (supervisionRatio === undefined || supervisionRatio === null || supervisionRatio === '') {
      supervisionRatio = null;
    } else {
      supervisionRatio = Number(supervisionRatio);
      if (![0, 3, 4].includes(supervisionRatio)) {
        throw new Error('supervisionRatio must be null (unset), 0 (MD-only), 3, or 4.');
      }
    }
    const key = `${location}::${dayOfWeek}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate entry for ${location} on day ${dayOfWeek}.`);
    }
    seen.add(key);
    result.push({ location, dayOfWeek, roomsRequired, supervisionRatio });
  }
  return result;
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/coverage-templates
 * List all templates for the caller's facility, with day count and total
 * rooms-per-week for at-a-glance display in the list UI.
 */
router.get('/', facilityAuth, async (req, res) => {
  try {
    const templates = await prisma.coverageTemplate.findMany({
      where: { facilityId: req.facility.id },
      include: { days: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    res.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        isDefault: t.isDefault,
        locationCount: new Set(t.days.map((d) => d.location)).size,
        totalRoomsPerWeek: t.days.reduce((s, d) => s + d.roomsRequired, 0),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    console.error('[coverage-templates] list failed:', err);
    res.status(500).json({ error: 'Failed to load coverage templates.' });
  }
});

/**
 * GET /api/coverage-templates/:id
 * Full template with all days.
 */
router.get('/:id', facilityAuth, async (req, res) => {
  try {
    const template = await prisma.coverageTemplate.findUnique({
      where: { id: req.params.id },
      include: { days: { orderBy: [{ location: 'asc' }, { dayOfWeek: 'asc' }] } },
    });
    if (!template || template.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    res.json({ template });
  } catch (err) {
    console.error('[coverage-templates] get failed:', err);
    res.status(500).json({ error: 'Failed to load template.' });
  }
});

/**
 * POST /api/coverage-templates
 * Create a new template with its days.
 *
 * body: { name, isDefault?, days: [{location, dayOfWeek, roomsRequired}, ...] }
 */
router.post('/', facilityAuth, async (req, res) => {
  try {
    const { name, isDefault, days = [] } = req.body || {};
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return res.status(400).json({ error: 'Template name is required.' });

    let normalizedDays;
    try {
      normalizedDays = normalizeDays(days);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // If marking as default, clear the default flag on other templates first
    // (only one default per facility). Done in a transaction.
    const result = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.coverageTemplate.updateMany({
          where: { facilityId: req.facility.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.coverageTemplate.create({
        data: {
          facilityId: req.facility.id,
          name: trimmedName,
          isDefault: Boolean(isDefault),
          days: { create: normalizedDays },
        },
        include: { days: true },
      });
    });

    res.status(201).json({ template: result });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A template with that name already exists.' });
    }
    console.error('[coverage-templates] create failed:', err);
    res.status(500).json({ error: 'Failed to create template.' });
  }
});

/**
 * PATCH /api/coverage-templates/:id
 * Update name, isDefault, and/or fully replace days[]. Partial replacement
 * of individual day entries isn't supported — pass the full days array.
 */
router.patch('/:id', facilityAuth, async (req, res) => {
  try {
    const template = await prisma.coverageTemplate.findUnique({
      where: { id: req.params.id },
    });
    if (!template || template.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const { name, isDefault, days } = req.body || {};
    const data = {};
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Template name cannot be empty.' });
      data.name = trimmed;
    }
    if (typeof isDefault === 'boolean') {
      data.isDefault = isDefault;
    }

    let normalizedDays = null;
    if (days !== undefined) {
      try {
        normalizedDays = normalizeDays(days);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        // Clear default flag from siblings first
        await tx.coverageTemplate.updateMany({
          where: { facilityId: req.facility.id, isDefault: true, NOT: { id: req.params.id } },
          data: { isDefault: false },
        });
      }
      if (normalizedDays !== null) {
        // Wipe + recreate the days list (simplest semantics for a full replace).
        await tx.coverageTemplateDay.deleteMany({ where: { templateId: req.params.id } });
        await tx.coverageTemplateDay.createMany({
          data: normalizedDays.map((d) => ({ ...d, templateId: req.params.id })),
        });
      }
      return tx.coverageTemplate.update({
        where: { id: req.params.id },
        data,
        include: { days: { orderBy: [{ location: 'asc' }, { dayOfWeek: 'asc' }] } },
      });
    });

    res.json({ template: result });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A template with that name already exists.' });
    }
    console.error('[coverage-templates] patch failed:', err);
    res.status(500).json({ error: 'Failed to update template.' });
  }
});

/**
 * DELETE /api/coverage-templates/:id
 * Hard-delete. Templates aren't load-bearing — deleting one doesn't affect
 * already-generated ScheduleDay rows (those are independent). Cascade
 * deletes the template's days.
 */
router.delete('/:id', facilityAuth, async (req, res) => {
  try {
    const template = await prisma.coverageTemplate.findUnique({
      where: { id: req.params.id },
    });
    if (!template || template.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    await prisma.coverageTemplate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error('[coverage-templates] delete failed:', err);
    res.status(500).json({ error: 'Failed to delete template.' });
  }
});

/**
 * POST /api/coverage-templates/:id/duplicate
 * Convenience endpoint: copy a template + its days under a new name (defaults
 * to "<original> (copy)"). Saves a coordinator from re-entering for variants
 * like "Summer Schedule" from "Standard Week".
 */
router.post('/:id/duplicate', facilityAuth, async (req, res) => {
  try {
    const original = await prisma.coverageTemplate.findUnique({
      where: { id: req.params.id },
      include: { days: true },
    });
    if (!original || original.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const requestedName = String(req.body?.name || '').trim();
    let name = requestedName || `${original.name} (copy)`;

    // Avoid uniqueness collision by appending (copy 2), (copy 3) … if needed.
    if (!requestedName) {
      let attempt = 1;
      const existingNames = new Set(
        (
          await prisma.coverageTemplate.findMany({
            where: { facilityId: req.facility.id },
            select: { name: true },
          })
        ).map((t) => t.name)
      );
      while (existingNames.has(name)) {
        attempt += 1;
        name = `${original.name} (copy ${attempt})`;
      }
    }

    const created = await prisma.coverageTemplate.create({
      data: {
        facilityId: req.facility.id,
        name,
        isDefault: false, // duplicates are never the default
        days: {
          create: original.days.map((d) => ({
            location: d.location,
            dayOfWeek: d.dayOfWeek,
            roomsRequired: d.roomsRequired,
            supervisionRatio: d.supervisionRatio,
          })),
        },
      },
      include: { days: true },
    });

    res.status(201).json({ template: created });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A template with that name already exists.' });
    }
    console.error('[coverage-templates] duplicate failed:', err);
    res.status(500).json({ error: 'Failed to duplicate template.' });
  }
});

module.exports = router;
