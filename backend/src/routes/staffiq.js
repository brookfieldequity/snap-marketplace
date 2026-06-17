const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const {
  analyzeFacilitySchedule,
  calculateScoreFromAnalysis,
  getScoreStatus,
} = require('../utils/staffiqScore');
const learning = require('../services/staffiqLearning');

const router = express.Router();

// ── Agency default rates for savings calculations ─────────────────────────────

const AGENCY_RATES = {
  ANESTHESIOLOGIST: 425,
  CRNA: 300,
  ANESTHESIA_ASSISTANT: 250,
};

// ── SNAP solution copy per insight type ───────────────────────────────────────

const snapSolutions = {
  TEAM_MODEL: {
    message: 'Use SNAP Shifts to post internal incentive shifts when your CRNA coverage falls below the optimal ratio. Offer a premium rate to incentivize CRNAs to fill gaps before they become costly.',
    buttonLabel: 'Create Incentive Shift',
    buttonAction: 'create-incentive',
  },
  FRIDAY_SHORTAGE: {
    message: 'Use SNAP Shifts to automatically notify your CRNA pool every Thursday with a Friday incentive offer. If internal CRNAs do not fill the slot, SNAP Marketplace connects you to the broader Massachusetts CRNA network.',
    buttonLabel: 'Set Up Friday Alerts',
    buttonAction: 'friday-alerts',
  },
  UTILIZATION: {
    message: 'StaffIQ identifies low-utilization periods where per-diem coverage through SNAP can reduce fixed staffing costs.',
    buttonLabel: 'Explore Per-Diem Options',
    buttonAction: 'post-shift',
  },
  // Legacy types — pass through without snap solution enrichment
  LATE_SCHEDULING: null,
  PROVIDER_MIX: null,
  DEMAND_FORECAST: null,
};

// ── Save insight to DB ────────────────────────────────────────────────────────

async function saveInsight(facilityId, insightType, insightData, dollarImpact, dataPoints) {
  return prisma.staffIQInsight.create({
    data: {
      facilityId,
      insightType,
      insightData,
      dollarImpactEstimate: dollarImpact || null,
      dataPointsAnalyzed: dataPoints || null,
    },
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET / — latest insight of each type + metadata, enriched with snapSolution
router.get('/', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;

    const insightTypes = ['LATE_SCHEDULING', 'PROVIDER_MIX', 'DEMAND_FORECAST', 'UTILIZATION'];

    const latestInsights = await Promise.all(
      insightTypes.map((type) =>
        prisma.staffIQInsight.findFirst({
          where: { facilityId, insightType: type },
          orderBy: { generatedAt: 'desc' },
        })
      )
    );

    const [totalRecords, dateRange] = await Promise.all([
      prisma.schedulingRecord.count({ where: { facilityId } }),
      prisma.schedulingRecord.aggregate({
        where: { facilityId },
        _min: { shiftDate: true },
        _max: { shiftDate: true },
      }),
    ]);

    // Enrich insights with snapSolution and logical type label
    const enriched = latestInsights.filter(Boolean).map((insight) => {
      const data = insight.insightData || {};
      // Determine logical type for UI display
      let logicalType = insight.insightType;
      if (insight.insightType === 'PROVIDER_MIX' && data._logicalType === 'TEAM_MODEL') {
        logicalType = 'TEAM_MODEL';
      } else if (insight.insightType === 'LATE_SCHEDULING' && data._logicalType === 'FRIDAY_SHORTAGE') {
        logicalType = 'FRIDAY_SHORTAGE';
      }
      const snap = snapSolutions[logicalType] || null;
      return { ...insight, logicalType, snapSolution: snap };
    });

    res.json({
      insights: enriched,
      metadata: {
        totalRecords,
        dateRange: {
          start: dateRange._min.shiftDate,
          end: dateRange._max.shiftDate,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load StaffIQ insights' });
  }
});

// POST /analyze — run supervision-model-based analysis from uploaded schedule data
router.post('/analyze', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;

    // Load all scheduling records for this facility
    const allRecords = await prisma.schedulingRecord.findMany({
      where: { facilityId },
      orderBy: { shiftDate: 'asc' },
      select: {
        shiftDate: true,
        providerType: true,
        facilityLocation: true,
        durationHours: true,
        dayOfWeek: true,
        rate: true,
        caseType: true,
      },
    });

    if (allRecords.length === 0) {
      return res.status(400).json({
        error: 'No scheduling records found. Please upload schedule data before running analysis.',
      });
    }

    // Group records by location + date → count ANES and CRNA per day
    // facilityLocation holds the facility/location name from Schedule4 matrix uploads
    const byLocationDate = {};
    for (const rec of allRecords) {
      if (!rec.shiftDate) continue;
      const location = rec.facilityLocation || 'Main';
      const dateStr = new Date(rec.shiftDate).toISOString().split('T')[0];
      const key = `${location}|${dateStr}`;
      if (!byLocationDate[key]) {
        byLocationDate[key] = {
          location,
          date: dateStr,
          anesCount: 0,
          crnaCount: 0,
          // Carry the file-stated weekday so the analyzer doesn't re-guess it.
          dayOfWeek: Number.isInteger(rec.dayOfWeek) ? rec.dayOfWeek : null,
        };
      }
      const pt = (rec.providerType || '').toUpperCase();
      if (pt === 'ANESTHESIOLOGIST' || pt === 'ANES') byLocationDate[key].anesCount++;
      else if (pt === 'CRNA') byLocationDate[key].crnaCount++;
    }

    // Group day-records by location
    const byLocation = {};
    for (const dayRec of Object.values(byLocationDate)) {
      if (!byLocation[dayRec.location]) byLocation[dayRec.location] = [];
      // Determine if weekend
      const d = new Date(dayRec.date + 'T12:00:00');
      const dow = d.getDay();
      byLocation[dayRec.location].push({
        ...dayRec,
        isWeekend: dow === 0 || dow === 6,
      });
    }

    // Analyze each facility location
    const facilityResults = Object.entries(byLocation).map(([locationName, dayRecords]) =>
      analyzeFacilitySchedule(dayRecords, locationName)
    );

    // Calculate overall score
    const scoreResult = calculateScoreFromAnalysis(facilityResults);
    const status = getScoreStatus(scoreResult.score);

    // Build insights array
    const insights = [];

    // TEAM_MODEL insights (one per inefficient facility) — stored as PROVIDER_MIX
    for (const fac of facilityResults) {
      if (fac.inefficientDays > 0) {
        const insightData = {
          _logicalType: 'TEAM_MODEL',
          facilityName: fac.facilityName,
          inefficientDays: fac.inefficientDays,
          totalDays: fac.totalDays,
          inefficiencyPct: fac.inefficiencyPct,
          annualWaste: fac.annualWaste,
          avgRooms: fac.avgRooms,
          clinicalOverrideDays: fac.clinicalOverrideDays,
        };
        const saved = await saveInsight(
          facilityId,
          'PROVIDER_MIX',
          insightData,
          fac.annualWaste,
          fac.totalDays
        );
        insights.push({ ...saved, logicalType: 'TEAM_MODEL', snapSolution: snapSolutions.TEAM_MODEL });
      }
    }

    // FRIDAY_SHORTAGE insights — stored as LATE_SCHEDULING
    for (const fac of facilityResults) {
      if (fac.hasFridayShortage) {
        const insightData = {
          _logicalType: 'FRIDAY_SHORTAGE',
          facilityName: fac.facilityName,
          avgWeekdayRatio: fac.avgWeekdayRatio,
          avgFridayRatio: fac.avgFridayRatio,
          fridayRatioDrop: fac.fridayRatioDrop,
          fridayAnnualPremium: fac.fridayAnnualPremium,
          // Volume + confidence context behind the corrected, cost-based detection.
          avgFridayRooms: fac.avgFridayRooms,
          avgWeekdayRooms: fac.avgWeekdayRooms,
          avgWeekdayWastePerRoom: fac.avgWeekdayWastePerRoom,
          avgFridayWastePerRoom: fac.avgFridayWastePerRoom,
          excessWastePerRoom: fac.excessWastePerRoom,
          fridaySampleSize: fac.fridaySampleSize,
          fridayConfidence: fac.fridayConfidence,
        };
        const saved = await saveInsight(
          facilityId,
          'LATE_SCHEDULING',
          insightData,
          fac.fridayAnnualPremium,
          fac.fridayRatios.length
        );
        insights.push({ ...saved, logicalType: 'FRIDAY_SHORTAGE', snapSolution: snapSolutions.FRIDAY_SHORTAGE });
      }
    }

    // UTILIZATION insight (overall)
    const totalAnnualWaste = facilityResults.reduce((s, f) => s + f.annualWaste, 0);
    const utilizationData = {
      _logicalType: 'UTILIZATION',
      facilityBreakdown: facilityResults.map(f => ({
        facilityName: f.facilityName,
        avgRooms: f.avgRooms,
        totalDays: f.totalDays,
        inefficiencyPct: f.inefficiencyPct,
        annualWaste: f.annualWaste,
      })),
      totalAnnualWaste,
      score: scoreResult.score,
      deduction1: scoreResult.deduction1,
      deduction2: scoreResult.deduction2,
      deduction3: scoreResult.deduction3,
    };
    const savedUtilization = await saveInsight(
      facilityId,
      'UTILIZATION',
      utilizationData,
      totalAnnualWaste,
      allRecords.length
    );
    insights.push({ ...savedUtilization, logicalType: 'UTILIZATION', snapSolution: snapSolutions.UTILIZATION });

    // Save StaffIQ score history
    await prisma.staffIQScoreHistory.create({
      data: {
        facilityId,
        score: scoreResult.score,
        calculationMethod: 'data_upload',
      },
    });

    // ── Learning layer: fold this run into the facility's baseline, refresh the
    // network benchmark, and grade this facility against it. All best-effort —
    // failures here must never break the analysis the user just ran.
    const dates = allRecords.map(r => r.shiftDate).filter(Boolean).map(d => new Date(d).getTime());
    const dataSpanDays = dates.length
      ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000)
      : null;

    await learning.updateFacilityProfile(facilityId, facilityResults, scoreResult.score, dataSpanDays);
    await learning.updateNetworkBenchmark();

    const [benchmark, profile] = await Promise.all([
      learning.getNetworkBenchmark(),
      learning.getFacilityProfile(facilityId),
    ]);
    const facilityMetrics = learning.summarizeResults(facilityResults);
    const networkGrade = facilityMetrics ? learning.gradeAgainstNetwork(facilityMetrics, benchmark) : null;

    const hasRates = allRecords.some(r => r.rate != null);
    const hasCaseTypes = allRecords.some(r => r.caseType != null);
    const dataReadiness = learning.assessDataReadiness({
      totalRecords: allRecords.length,
      dataSpanDays,
      uploadsAnalyzed: profile?.uploadsAnalyzed || 1,
      observationCount: profile?.observationCount || 0,
      hasRates,
      hasCaseTypes,
    });

    res.json({
      score: scoreResult.score,
      status,
      insights,
      facilityBreakdown: facilityResults,
      totalAnnualWaste,
      recordsAnalyzed: allRecords.length,
      // Learning-layer context for the portal.
      learning: {
        networkGrade,
        benchmark,
        dataReadiness,
        baselineConfidence: dataReadiness.confidence,
        observationCount: profile?.observationCount || 0,
        uploadsAnalyzed: profile?.uploadsAnalyzed || 1,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to run StaffIQ analysis' });
  }
});

// GET /dashboard — summary dashboard with savings, fill status, utilization metrics
router.get('/dashboard', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const now = new Date();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const in14Days = new Date(now.getTime() + 14 * 86400000);

    // ── Agency replacement savings ─────────────────────────────────────────────

    const bookingsMonth = await prisma.shiftBooking.findMany({
      where: {
        shift: { facilityId },
        confirmedAt: { gte: monthStart },
        completedAt: { not: null },
      },
      include: { shift: { select: { specialty: true, durationHours: true, currentRate: true } } },
    });

    const bookingsYtd = await prisma.shiftBooking.findMany({
      where: {
        shift: { facilityId },
        confirmedAt: { gte: yearStart },
        completedAt: { not: null },
      },
      include: { shift: { select: { specialty: true, durationHours: true, currentRate: true } } },
    });

    function calcAgencySavings(bookings) {
      return bookings.reduce((sum, b) => {
        const agencyRate = AGENCY_RATES[b.shift.specialty] || 300;
        const providerRate = b.providerHourlyRate || b.shift.currentRate || 0;
        const hours = b.shiftDurationHours || b.shift.durationHours || 0;
        return sum + Math.max(0, (agencyRate - providerRate) * hours);
      }, 0);
    }

    const agencyMonth = calcAgencySavings(bookingsMonth);
    const agencyYtd = calcAgencySavings(bookingsYtd);

    // ── Internal efficiency savings (12% of late-fill cost via internal roster) ─

    const recordsMonth = await prisma.schedulingRecord.findMany({
      where: { facilityId, shiftDate: { gte: monthStart } },
    });
    const recordsYtd = await prisma.schedulingRecord.findMany({
      where: { facilityId, shiftDate: { gte: yearStart } },
    });

    function calcInternalSavings(recs) {
      const totalValue = recs.reduce((sum, r) => sum + (r.rate || 0) * (r.durationHours || 0), 0);
      return totalValue * 0.12;
    }

    const internalMonth = calcInternalSavings(recordsMonth);
    const internalYtd = calcInternalSavings(recordsYtd);

    // ── Upcoming shifts (next 14 days from ScheduleDay) ───────────────────────

    const upcomingScheduleDays = await prisma.scheduleDay.findMany({
      where: { facilityId, date: { gte: now, lte: in14Days } },
      include: {
        assignments: {
          include: {
            rosterEntry: { select: { providerName: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const upcomingShifts = upcomingScheduleDays.map((day) => ({
      date: day.date,
      location: day.location,
      roomsRequired: day.roomsRequired,
      assignments: day.assignments.length,
      fillStatus:
        day.assignments.length >= day.roomsRequired ? 'FILLED' :
        day.assignments.length > 0 ? 'PARTIAL' : 'UNFILLED',
    }));

    // ── Predicted gaps (unfilled days in next 14 days) ────────────────────────

    const predictedGaps = upcomingShifts.filter(
      (s) => s.fillStatus === 'UNFILLED' || s.fillStatus === 'PARTIAL'
    );

    // ── Utilization rate (from latest UTILIZATION insight) ────────────────────

    const latestUtilization = await prisma.staffIQInsight.findFirst({
      where: { facilityId, insightType: 'UTILIZATION' },
      orderBy: { generatedAt: 'desc' },
    });

    let utilizationRate = null;
    let facilityBreakdown = [];
    let fridayShortage = [];
    let totalAnnualWaste = 0;

    if (latestUtilization?.insightData) {
      const data = latestUtilization.insightData;
      // New format from supervision model analysis
      if (data.facilityBreakdown) {
        facilityBreakdown = data.facilityBreakdown;
        totalAnnualWaste = data.totalAnnualWaste || 0;
        // Compute avg utilization rate as inverse of inefficiency
        const avgIneff = facilityBreakdown.reduce((s, f) => s + (f.inefficiencyPct || 0), 0) / Math.max(facilityBreakdown.length, 1);
        utilizationRate = Math.round((100 - avgIneff) * 10) / 10;
      }
      // Legacy format
      else if (data.providers?.length) {
        const pcts = data.providers.map((p) => p.utilizationPct);
        utilizationRate = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10;
      }
    }

    // ── Friday shortage facilities (from latest LATE_SCHEDULING insights) ─────

    const fridayInsights = await prisma.staffIQInsight.findMany({
      where: { facilityId, insightType: 'LATE_SCHEDULING' },
      orderBy: { generatedAt: 'desc' },
      take: 10,
    });

    for (const ins of fridayInsights) {
      const data = ins.insightData || {};
      if (data._logicalType === 'FRIDAY_SHORTAGE') {
        fridayShortage.push({
          facilityName: data.facilityName,
          avgWeekdayRatio: data.avgWeekdayRatio,
          avgFridayRatio: data.avgFridayRatio,
          fridayRatioDrop: data.fridayRatioDrop,
          fridayAnnualPremium: data.fridayAnnualPremium,
        });
      }
    }

    // ── Avg fill lead time (days between createdAt and shiftDate) ────────────

    const allSchedulingRecords = await prisma.schedulingRecord.findMany({
      where: { facilityId },
      select: { shiftDate: true, createdAt: true },
    });

    const leadTimes = allSchedulingRecords
      .filter((r) => r.shiftDate && r.createdAt)
      .map((r) => (new Date(r.shiftDate) - new Date(r.createdAt)) / 86400000);

    const avgFillLeadTime = leadTimes.length
      ? Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10
      : null;

    // ── Incentive shifts this month / escalations ─────────────────────────────

    const [incentiveShiftsThisMonth, escalationsThisMonth] = await Promise.all([
      prisma.internalIncentiveShift.count({
        where: { facilityId, createdAt: { gte: monthStart } },
      }),
      prisma.internalIncentiveShift.count({
        where: { facilityId, status: 'ESCALATED', escalationApprovedAt: { gte: monthStart } },
      }),
    ]);

    res.json({
      savings: {
        internal: {
          month: Math.round(internalMonth),
          ytd: Math.round(internalYtd),
        },
        agencyReplacement: {
          month: Math.round(agencyMonth),
          ytd: Math.round(agencyYtd),
        },
        total: {
          month: Math.round(internalMonth + agencyMonth),
          ytd: Math.round(internalYtd + agencyYtd),
        },
      },
      upcomingShifts,
      predictedGaps,
      utilizationRate,
      avgFillLeadTime,
      incentiveShiftsThisMonth,
      escalationsThisMonth,
      facilityBreakdown,
      fridayShortage,
      totalAnnualWaste,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load StaffIQ dashboard' });
  }
});

// GET /benchmark — facility's learned baseline + network benchmark + standing
router.get('/benchmark', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const [benchmark, profile] = await Promise.all([
      learning.getNetworkBenchmark(),
      learning.getFacilityProfile(facilityId),
    ]);

    // Grade the facility from its own learned profile so the comparison reflects
    // its stable baseline, not just the most recent upload.
    let networkGrade = null;
    if (profile) {
      const metrics = {
        costPerRoom: profile.avgCostPerRoom,
        careTeamRatio: profile.avgCareTeamRatio,
        wastePerRoom: profile.avgWeekdayWastePerRoom,
        fridayExcessPerRoom: profile.avgFridayWastePerRoom,
        inefficiencyPct: profile.avgWeekdayWastePerRoom != null && profile.avgCostPerRoom
          ? (profile.avgWeekdayWastePerRoom / profile.avgCostPerRoom) * 100
          : null,
      };
      networkGrade = learning.gradeAgainstNetwork(metrics, benchmark);
    }

    res.json({ profile, benchmark, networkGrade });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load StaffIQ benchmark' });
  }
});

// GET /data-readiness — confidence + prioritized "feed me more data" suggestions
router.get('/data-readiness', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const [profile, agg, ratesCount, caseCount] = await Promise.all([
      learning.getFacilityProfile(facilityId),
      prisma.schedulingRecord.aggregate({
        where: { facilityId },
        _count: { _all: true },
        _min: { shiftDate: true },
        _max: { shiftDate: true },
      }),
      prisma.schedulingRecord.count({ where: { facilityId, rate: { not: null } } }),
      prisma.schedulingRecord.count({ where: { facilityId, caseType: { not: null } } }),
    ]);

    const min = agg._min.shiftDate ? new Date(agg._min.shiftDate).getTime() : null;
    const max = agg._max.shiftDate ? new Date(agg._max.shiftDate).getTime() : null;
    const dataSpanDays = min && max ? Math.round((max - min) / 86400000) : 0;

    const readiness = learning.assessDataReadiness({
      totalRecords: agg._count._all,
      dataSpanDays,
      uploadsAnalyzed: profile?.uploadsAnalyzed || 0,
      observationCount: profile?.observationCount || 0,
      hasRates: ratesCount > 0,
      hasCaseTypes: caseCount > 0,
    });

    res.json(readiness);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assess data readiness' });
  }
});

// POST /insights/:id/feedback — coordinator confirms/dismisses an insight.
// This is the labeled signal the learning layer uses to calibrate over time.
router.post('/insights/:id/feedback', facilityAuth, async (req, res) => {
  try {
    const facilityId = req.facility.id;
    const { id } = req.params;
    const { status, reason, note } = req.body || {};

    const allowed = ['ACCEPTED', 'DISMISSED', 'ACTIONED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
    }

    const insight = await prisma.staffIQInsight.findFirst({ where: { id, facilityId } });
    if (!insight) return res.status(404).json({ error: 'Insight not found' });

    const updated = await prisma.staffIQInsight.update({
      where: { id },
      data: {
        status,
        feedback: { reason: reason || null, note: note || null, by: req.user?.userId || null, at: new Date().toISOString() },
        actionedAt: status === 'ACTIONED' ? new Date() : insight.actionedAt,
      },
    });

    // Log the feedback as an outcome so accept/dismiss rates can tune thresholds.
    await learning.recordOutcome(facilityId, 'INSIGHT_FEEDBACK', {
      insightId: id,
      predictedDollar: insight.dollarImpactEstimate,
      metadata: { status, reason: reason || null, insightType: insight.insightType },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record insight feedback' });
  }
});

module.exports = router;
