const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { calculateStaffIQScore, getScoreStatus } = require('../utils/staffiqScore');

const router = express.Router();

// ── GET / — latest StaffIQInput for this facility ─────────────────────────────

router.get('/', facilityAuth, async (req, res) => {
  try {
    const latest = await prisma.staffIQInput.findFirst({
      where: { facilityId: req.facility.id },
      orderBy: { calculatedAt: 'desc' },
    });
    res.json(latest || null);
  } catch (err) {
    console.error('GET /staffiq-inputs error:', err);
    res.status(500).json({ error: 'Failed to load StaffIQ inputs' });
  }
});

// ── POST / — save inputs, calculate score, save history ───────────────────────

router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      totalLocations,
      avgRoomsPerDay,
      ftAnesthesiologists,
      ftCrnas,
      pdAnesthesiologistsPerMonth,
      pdCrnasPerMonth,
      agencyAnesthesiologistsPerMonth,
      agencyCrnasPerMonth,
      agencyAnesthesiologistRate,
      agencyCrnaRate,
      agencyAaRate,
      avgAnesthesiologistRate,
      avgCrnaRate,
      avgShiftHours,
      operatingDaysPerYear,
      primaryTeamModel,
    } = req.body;

    if (totalLocations == null || totalLocations === '') {
      return res.status(400).json({ error: 'totalLocations is required' });
    }

    // Apply defaults for optional fields
    const resolvedRooms = avgRoomsPerDay != null && avgRoomsPerDay !== ''
      ? Number(avgRoomsPerDay)
      : Math.round(Number(totalLocations) * 0.75);
    const resolvedAnesRate = avgAnesthesiologistRate != null && avgAnesthesiologistRate !== ''
      ? Number(avgAnesthesiologistRate)
      : 390;
    const resolvedCrnaRate = avgCrnaRate != null && avgCrnaRate !== ''
      ? Number(avgCrnaRate)
      : 260;
    const resolvedTeamModel = primaryTeamModel || 'mixed';
    // Agency bill rates are optional — null means "not entered", and the savings
    // math falls back to network priors with an "estimated" label.
    const toRateOrNull = (v) => (v != null && v !== '' ? Number(v) : null);
    const resolvedAgencyAnesRate = toRateOrNull(agencyAnesthesiologistRate);
    const resolvedAgencyCrnaRate = toRateOrNull(agencyCrnaRate);
    const resolvedAgencyAaRate = toRateOrNull(agencyAaRate);
    const resolvedShiftHours = avgShiftHours != null && avgShiftHours !== '' ? Number(avgShiftHours) : 10;
    const resolvedOperatingDays = operatingDaysPerYear != null && operatingDaysPerYear !== '' ? Number(operatingDaysPerYear) : 250;

    const scoreResult = calculateStaffIQScore({
      totalLocations: Number(totalLocations),
      avgRoomsPerDay: resolvedRooms,
      avgAnesthesiologistRate: resolvedAnesRate,
      avgCrnaRate: resolvedCrnaRate,
      avgShiftHours: resolvedShiftHours,
      operatingDaysPerYear: resolvedOperatingDays,
      primaryTeamModel: resolvedTeamModel,
    });

    const { score, inefficiency1Pct, inefficiency2Pct, inefficiency1Cost, inefficiency2Cost, totalBudget } = scoreResult;

    const [inputRecord] = await Promise.all([
      prisma.staffIQInput.create({
        data: {
          facilityId: req.facility.id,
          totalLocations: Number(totalLocations),
          avgRoomsPerDay: resolvedRooms,
          ftAnesthesiologists: Number(ftAnesthesiologists ?? 0),
          ftCrnas: Number(ftCrnas ?? 0),
          pdAnesthesiologistsPerMonth: Number(pdAnesthesiologistsPerMonth ?? 0),
          pdCrnasPerMonth: Number(pdCrnasPerMonth ?? 0),
          agencyAnesthesiologistsPerMonth: Number(agencyAnesthesiologistsPerMonth ?? 0),
          agencyCrnasPerMonth: Number(agencyCrnasPerMonth ?? 0),
          agencyAnesthesiologistRate: resolvedAgencyAnesRate,
          agencyCrnaRate: resolvedAgencyCrnaRate,
          agencyAaRate: resolvedAgencyAaRate,
          avgAnesthesiologistRate: resolvedAnesRate,
          avgCrnaRate: resolvedCrnaRate,
          avgShiftHours: resolvedShiftHours,
          operatingDaysPerYear: resolvedOperatingDays,
          primaryTeamModel: resolvedTeamModel,
          staffiqScore: score,
          inefficiency1Pct,
          inefficiency2Pct,
          inefficiency1Cost,
          inefficiency2Cost,
          totalBudget,
        },
      }),
      prisma.staffIQScoreHistory.create({
        data: {
          facilityId: req.facility.id,
          score,
          calculationMethod: 'manual_inputs',
        },
      }),
    ]);

    const status = getScoreStatus(score);

    res.json({
      id: inputRecord.id,
      score,
      status,
      inefficiency1Pct,
      inefficiency2Pct,
      inefficiency1Cost,
      inefficiency2Cost,
      totalBudget,
      calculatedAt: inputRecord.calculatedAt,
    });
  } catch (err) {
    console.error('POST /staffiq-inputs error:', err);
    res.status(500).json({ error: 'Failed to save StaffIQ inputs' });
  }
});

// ── GET /score — current score for a period ───────────────────────────────────

router.get('/score', facilityAuth, async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const now = new Date();
    let since;
    if (period === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      // month
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const latest = await prisma.staffIQInput.findFirst({
      where: { facilityId: req.facility.id },
      orderBy: { calculatedAt: 'desc' },
    });

    if (!latest) {
      // No StaffIQ data yet for this facility — return a "no score" state, not a
      // fabricated default. The UI shows "—" + an upload prompt rather than a
      // fake 84 that a brand-new facility (e.g. a just-created agency) would see.
      return res.json({
        score: null,
        status: null,
        insufficientData: true,
        inefficiency1Pct: null,
        inefficiency2Pct: null,
        inefficiency1Cost: null,
        inefficiency2Cost: null,
        totalBudget: null,
        calculationMethod: 'insufficient_data',
        period,
      });
    }

    const status = getScoreStatus(latest.staffiqScore);

    res.json({
      score: latest.staffiqScore,
      status,
      inefficiency1Pct: latest.inefficiency1Pct,
      inefficiency2Pct: latest.inefficiency2Pct,
      inefficiency1Cost: latest.inefficiency1Cost,
      inefficiency2Cost: latest.inefficiency2Cost,
      totalBudget: latest.totalBudget,
      calculationMethod: 'manual_inputs',
      period,
    });
  } catch (err) {
    console.error('GET /staffiq-inputs/score error:', err);
    res.status(500).json({ error: 'Failed to load StaffIQ score' });
  }
});

// ── GET /history — all score history entries ──────────────────────────────────

router.get('/history', facilityAuth, async (req, res) => {
  try {
    const history = await prisma.staffIQScoreHistory.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { calculatedAt: 'asc' },
      select: {
        score: true,
        calculationMethod: true,
        calculatedAt: true,
      },
    });
    res.json(history);
  } catch (err) {
    console.error('GET /staffiq-inputs/history error:', err);
    res.status(500).json({ error: 'Failed to load StaffIQ score history' });
  }
});

module.exports = router;
