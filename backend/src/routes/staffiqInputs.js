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
      avgAnesthesiologistRate,
      avgCrnaRate,
      avgShiftHours,
      operatingDaysPerYear,
      primaryTeamModel,
    } = req.body;

    if (
      totalLocations == null ||
      avgRoomsPerDay == null ||
      avgAnesthesiologistRate == null ||
      avgCrnaRate == null ||
      primaryTeamModel == null
    ) {
      return res.status(400).json({
        error: 'totalLocations, avgRoomsPerDay, avgAnesthesiologistRate, avgCrnaRate, and primaryTeamModel are required',
      });
    }

    const scoreResult = calculateStaffIQScore({
      totalLocations,
      avgRoomsPerDay,
      avgAnesthesiologistRate,
      avgCrnaRate,
      avgShiftHours: avgShiftHours ?? 10,
      operatingDaysPerYear: operatingDaysPerYear ?? 250,
      primaryTeamModel,
    });

    const { score, inefficiency1Pct, inefficiency2Pct, inefficiency1Cost, inefficiency2Cost, totalBudget } = scoreResult;

    const [inputRecord] = await Promise.all([
      prisma.staffIQInput.create({
        data: {
          facilityId: req.facility.id,
          totalLocations: Number(totalLocations),
          avgRoomsPerDay: Number(avgRoomsPerDay),
          ftAnesthesiologists: Number(ftAnesthesiologists ?? 0),
          ftCrnas: Number(ftCrnas ?? 0),
          pdAnesthesiologistsPerMonth: Number(pdAnesthesiologistsPerMonth ?? 0),
          pdCrnasPerMonth: Number(pdCrnasPerMonth ?? 0),
          agencyAnesthesiologistsPerMonth: Number(agencyAnesthesiologistsPerMonth ?? 0),
          agencyCrnasPerMonth: Number(agencyCrnasPerMonth ?? 0),
          avgAnesthesiologistRate: Number(avgAnesthesiologistRate),
          avgCrnaRate: Number(avgCrnaRate),
          avgShiftHours: Number(avgShiftHours ?? 10),
          operatingDaysPerYear: Number(operatingDaysPerYear ?? 250),
          primaryTeamModel,
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
      const defaultScore = 84;
      const status = getScoreStatus(defaultScore);
      return res.json({
        score: defaultScore,
        status,
        inefficiency1Pct: null,
        inefficiency2Pct: null,
        inefficiency1Cost: null,
        inefficiency2Cost: null,
        totalBudget: null,
        calculationMethod: 'default',
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
