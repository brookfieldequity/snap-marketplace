'use strict';

// Default loaded costs per hour
const DEFAULT_ANES_RATE = 390;
const DEFAULT_CRNA_RATE = 260;
const DEFAULT_SHIFT_HOURS = 10;
const DEFAULT_OPERATING_DAYS = 250;

// Signup-projection floor (decided with Matt 2026-07-07): every projection built
// from the 2-minute inputs form assumes at least this much team-model waste,
// because form inputs can't reveal day-to-day inefficiency the way schedules do.
// This is an INDUSTRY-TYPICAL assumption and must be labeled as such in any
// drill-down ("based on industry-typical patterns — your uploaded schedules
// replace this with your actual numbers"). Realized data overrides it entirely.
// Future: derive from the network benchmark instead of a constant (option C).
const PROJECTION_FLOOR_INEFF1_PCT = 2.0;

// Friday-shortage detection tuning.
// A Friday "shortage" means the facility spends materially MORE per staffed room
// on Fridays than on comparable Mon–Thu days — typically because CRNAs are
// unavailable and rooms get backfilled with (pricier) anesthesiologists, or run
// thinner care teams. We measure this with waste-per-room (actual minus the
// optimal care-team cost, divided by rooms), which is volume-independent — a
// smaller-but-efficiently-staffed Friday produces ZERO excess and is never flagged.
const FRIDAY_MIN_SAMPLE = 3;                 // need >=3 Fridays before we trust the signal
const FRIDAY_EXCESS_WASTE_PER_ROOM = 100;    // $/room over the shift above weekday baseline

function fridayConfidence(sampleSize) {
  if (sampleSize >= 8) return 'high';
  if (sampleSize >= FRIDAY_MIN_SAMPLE) return 'medium';
  return 'low';
}

// Map a weekday abbreviation ("Mon".."Sun") to a JS day-of-week index (0=Sun..6=Sat).
const DOW_LABELS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function dayOfWeekFromLabel(label) {
  if (label == null) return null;
  const key = String(label).trim().slice(0, 3).toLowerCase();
  return key in DOW_LABELS ? DOW_LABELS[key] : null;
}

/**
 * Given a single day's staffing (anes count, crna count), determine if it's efficient.
 * Efficient configurations:
 *   - Solo ANES (0 CRNAs): always efficient
 *   - 1:3 (1 ANES per 3 CRNAs): optimal standard
 *   - 1:4 (1 ANES per 4 CRNAs): optimal low acuity
 *   - Ratio >= 1:3 (each ANES covering >= 3 CRNAs): efficient
 * Inefficient:
 *   - CRNAs present but ratio < 1:3 (each ANES covering < 3 CRNAs)
 */
function analyzeDayEfficiency(anesCount, crnaCount, anesRate = DEFAULT_ANES_RATE, crnaRate = DEFAULT_CRNA_RATE, shiftHours = DEFAULT_SHIFT_HOURS) {
  const totalRooms = anesCount + crnaCount;
  const actualCost = (anesCount * anesRate + crnaCount * crnaRate) * shiftHours;

  // Optimal: ceil(rooms/4) ANES, rest CRNAs
  const optimalAnes = Math.ceil(totalRooms / 4);
  const optimalCrnas = totalRooms - optimalAnes;
  const optimalCost = (optimalAnes * anesRate + optimalCrnas * crnaRate) * shiftHours;

  const dailyWaste = Math.max(0, actualCost - optimalCost);
  const isEfficient = dailyWaste === 0;
  // Waste per room is volume-independent: it answers "how much more than the
  // optimal mix does each staffed room cost on this day?" — the basis for a fair
  // Friday-vs-weekday comparison regardless of how many rooms ran.
  const wastePerRoom = totalRooms > 0 ? dailyWaste / totalRooms : 0;

  // Clinical override flag: all-ANES days with 3+ rooms (may be intentional high-acuity)
  const isPotentialClinicalOverride = crnaCount === 0 && anesCount >= 3;

  // A true care-team day has both provider types present — the only configuration
  // where the supervision ratio is meaningful. Solo-MD and independent-CRNA days
  // are excluded from ratio statistics so they don't distort Friday detection.
  const isCareTeam = anesCount > 0 && crnaCount > 0;

  // Supervision ratio (CRNAs per ANES)
  const supervisionRatio = anesCount > 0 ? crnaCount / anesCount : 0;

  return {
    totalRooms,
    actualCost,
    optimalCost,
    dailyWaste,
    wastePerRoom,
    isEfficient,
    isPotentialClinicalOverride,
    isCareTeam,
    supervisionRatio,
    optimalAnes,
    optimalCrnas,
  };
}

/**
 * Analyze a set of daily records for a facility.
 * records: [{ date, anesCount, crnaCount, isWeekend? }]
 * Returns efficiency stats, Friday shortage analysis, cost summary.
 */
function analyzeFacilitySchedule(records, facilityName = '', rates = {}) {
  const anesRate = rates.anesRate || DEFAULT_ANES_RATE;
  const crnaRate = rates.crnaRate || DEFAULT_CRNA_RATE;
  const shiftHours = rates.shiftHours || DEFAULT_SHIFT_HOURS;
  const operatingDays = rates.operatingDays || DEFAULT_OPERATING_DAYS;

  let totalDays = 0;
  let inefficientDays = 0;
  let clinicalOverrideDays = 0;
  let totalActualCost = 0;
  let totalOptimalCost = 0;
  let totalRooms = 0;

  // ── The waste SPLIT (methodology decision, 2026-07-08) ──────────────────────
  // Care-team waste: cost above optimal on days that are NOT flagged as
  // potential clinical overrides — recoverable through scheduling alone. This
  // is the number StaffIQ claims as savings.
  // Structural waste: cost above the care-team model on all-MD (3+ room) days —
  // converting those sites is a practice-model decision, so it is reported as a
  // SEPARATE opportunity, never blended into the recoverable figure.
  let totalCareTeamWaste = 0;
  let totalStructuralWaste = 0;

  // Care-team supervision ratios (display only) — computed solely on days with
  // both provider types present, so solo/independent days never skew them.
  const weekdayRatios = []; // Mon-Thu care-team days
  const fridayRatios = [];   // Friday care-team days

  // Two waste-per-room sample sets:
  //  • recoverable (care-team basis) — feeds the learned baseline, lever-1
  //    realized savings, and the network benchmark (conservative by design);
  //  • total basis — drives Friday-shortage detection, which MUST keep override
  //    days in view (an all-MD Friday backfilling a CRNA shortage is exactly
  //    the pattern it exists to catch).
  const weekdayRecoverableWPR = [];
  const weekdayTotalWPR = [];
  const fridayTotalWPR = [];
  let fridayRoomTotal = 0;
  let fridayDayCount = 0;
  let weekdayRoomTotal = 0;
  let weekdayDayCount = 0;

  records.forEach(rec => {
    if (rec.isWeekend) return;
    const day = analyzeDayEfficiency(rec.anesCount, rec.crnaCount, anesRate, crnaRate, shiftHours);
    totalDays++;
    totalActualCost += day.actualCost;
    totalOptimalCost += day.optimalCost;
    totalRooms += day.totalRooms;

    if (!day.isEfficient && !day.isPotentialClinicalOverride) inefficientDays++;
    if (day.isPotentialClinicalOverride) {
      clinicalOverrideDays++;
      totalStructuralWaste += day.dailyWaste;
    } else {
      totalCareTeamWaste += day.dailyWaste;
    }
    const recoverableWPR = day.isPotentialClinicalOverride ? 0 : day.wastePerRoom;

    // Prefer the weekday the source file stated (rec.dayOfWeek, 0=Sun..6=Sat);
    // fall back to deriving it from the date string only if no label was carried.
    const dow = Number.isInteger(rec.dayOfWeek)
      ? rec.dayOfWeek
      : new Date(rec.date + 'T12:00:00').getDay();

    if (dow === 5) {
      fridayDayCount++;
      fridayRoomTotal += day.totalRooms;
      fridayTotalWPR.push(day.wastePerRoom);
      if (day.isCareTeam) fridayRatios.push(day.supervisionRatio);
    } else if (dow >= 1 && dow <= 4) {
      weekdayDayCount++;
      weekdayRoomTotal += day.totalRooms;
      weekdayTotalWPR.push(day.wastePerRoom);
      weekdayRecoverableWPR.push(recoverableWPR);
      if (day.isCareTeam) weekdayRatios.push(day.supervisionRatio);
    }
  });

  const inefficiencyPct = totalDays > 0 ? (inefficientDays / totalDays) * 100 : 0;
  // Annualized on each location's own observed-day count. annualWaste is the
  // RECOVERABLE (care-team) figure — the only number presented as savings.
  const annualWaste = totalCareTeamWaste * (operatingDays / Math.max(totalDays, 1));
  const annualStructuralOpportunity = totalStructuralWaste * (operatingDays / Math.max(totalDays, 1));

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // Display-only care-team ratios.
  const avgWeekdayRatio = avg(weekdayRatios);
  const avgFridayRatio = avg(fridayRatios);
  const fridayRatioDrop = avgWeekdayRatio > 0 ? (avgWeekdayRatio - avgFridayRatio) / avgWeekdayRatio : 0;

  // Friday-shortage decision: do Fridays carry materially more cost-above-optimal
  // per room than Mon–Thu? This is true only when Fridays are genuinely staffed
  // less efficiently (e.g. MD backfill) — not merely lighter. TOTAL-waste basis
  // on both sides so all-MD Friday backfills stay visible.
  const avgFridayWastePerRoom = avg(fridayTotalWPR);
  const avgWeekdayTotalWastePerRoom = avg(weekdayTotalWPR);
  const excessWastePerRoom = Math.max(0, avgFridayWastePerRoom - avgWeekdayTotalWastePerRoom);
  // Recoverable (care-team) weekday waste per room — the conservative basis the
  // learned profile, realized savings, and network benchmark run on.
  const avgWeekdayWastePerRoom = avg(weekdayRecoverableWPR);
  const avgFridayRooms = fridayDayCount > 0 ? fridayRoomTotal / fridayDayCount : 0;
  const avgWeekdayRooms = weekdayDayCount > 0 ? weekdayRoomTotal / weekdayDayCount : 0;

  const hasFridayShortage =
    fridayDayCount >= FRIDAY_MIN_SAMPLE &&
    excessWastePerRoom > FRIDAY_EXCESS_WASTE_PER_ROOM;

  // Annual Friday premium: excess waste per room, on actual Friday room volume,
  // across the facility's own count of operating Fridays (operatingDays / 5).
  // wastePerRoom already bakes in shiftHours, so no extra hours multiplier.
  let fridayAnnualPremium = 0;
  if (hasFridayShortage) {
    const fridaysPerYear = operatingDays / 5;
    fridayAnnualPremium = Math.round(excessWastePerRoom * avgFridayRooms * fridaysPerYear);
  }

  return {
    facilityName,
    totalDays,
    inefficientDays,
    clinicalOverrideDays,
    inefficiencyPct: Math.round(inefficiencyPct * 10) / 10,
    totalActualCost: Math.round(totalActualCost),
    totalOptimalCost: Math.round(totalOptimalCost),
    annualWaste: Math.round(annualWaste),
    avgWeekdayRatio: Math.round(avgWeekdayRatio * 100) / 100,
    avgFridayRatio: Math.round(avgFridayRatio * 100) / 100,
    hasFridayShortage,
    fridayRatioDrop: Math.round(fridayRatioDrop * 100),
    fridayAnnualPremium,
    // Volume + confidence context so the UI can be honest about the signal.
    avgFridayRooms: Math.round(avgFridayRooms * 10) / 10,
    avgWeekdayRooms: Math.round(avgWeekdayRooms * 10) / 10,
    fridaySampleSize: fridayDayCount,
    fridayConfidence: fridayConfidence(fridayDayCount),
    avgFridayWastePerRoom: Math.round(avgFridayWastePerRoom),
    avgWeekdayWastePerRoom: Math.round(avgWeekdayWastePerRoom),
    excessWastePerRoom: Math.round(excessWastePerRoom),
    avgRooms: totalDays > 0 ? Math.round((totalRooms / totalDays) * 10) / 10 : 0,
    // The split, in raw observed dollars (annualized versions above).
    totalCareTeamWaste: Math.round(totalCareTeamWaste),
    totalStructuralWaste: Math.round(totalStructuralWaste),
    annualStructuralOpportunity: Math.round(annualStructuralOpportunity),
    weekdayRatios,
    fridayRatios,
  };
}

/**
 * Calculate StaffIQ score from facility analysis results.
 * facilities: array of results from analyzeFacilitySchedule()
 * Returns: { score, deduction1, deduction2, deduction3, details }
 */
function calculateScoreFromAnalysis(facilities) {
  if (!facilities || facilities.length === 0) {
    // No data → no score. Callers guard on records existing before invoking;
    // never fabricate a number for an empty facility.
    return { score: null, wasteRatioPct: null, structuralRatioPct: null, deduction1: 0, deduction2: 0, deduction3: 0, details: [], calculationMethod: 'insufficient_data' };
  }

  // One score formula everywhere: score = 100 − RECOVERABLE waste% of actual
  // staffing spend, where recoverable = care-team scheduling waste only
  // (methodology decision 2026-07-08). All-MD clinical-override days are priced
  // separately as structuralRatioPct and never counted against the score — a
  // deliberate practice model is not a scheduling failure. Friday inefficiency
  // is already inside the care-team waste, so there is no separate Friday
  // deduction (and no double-count). The gap from 100 IS the percentage of
  // spend recoverable through scheduling — a CFO can recompute it.
  const totalActual = facilities.reduce((s, f) => s + (f.totalActualCost || 0), 0);
  const totalCareTeam = facilities.reduce((s, f) => s + (f.totalCareTeamWaste || 0), 0);
  const totalStructural = facilities.reduce((s, f) => s + (f.totalStructuralWaste || 0), 0);
  const wasteRatioPct = totalActual > 0
    ? Math.round((totalCareTeam / totalActual) * 1000) / 10
    : 0;
  const structuralRatioPct = totalActual > 0
    ? Math.round((totalStructural / totalActual) * 1000) / 10
    : 0;

  const score = Math.min(100, Math.max(0, Math.round(100 - wasteRatioPct)));

  return {
    score,
    wasteRatioPct,        // recoverable (care-team) — the score basis
    structuralRatioPct,   // all-MD structural opportunity — reported separately
    // Back-compat breakdown fields (the whole gap is measured recoverable waste).
    deduction1: wasteRatioPct,
    deduction2: 0,
    deduction3: 0,
    totalDeduction: wasteRatioPct,
    details: facilities,
    calculationMethod: 'data_upload',
  };
}

/**
 * Calculate StaffIQ score from manual StaffIQInput form data.
 */
function calculateStaffIQScore(inputs) {
  const {
    totalLocations,
    avgRoomsPerDay,
    avgAnesthesiologistRate = DEFAULT_ANES_RATE,
    avgCrnaRate = DEFAULT_CRNA_RATE,
    avgShiftHours = DEFAULT_SHIFT_HOURS,
    operatingDaysPerYear = DEFAULT_OPERATING_DAYS,
    primaryTeamModel,
  } = inputs;

  const anesRate = Number(avgAnesthesiologistRate);
  const crnaRate = Number(avgCrnaRate);
  const shiftHours = Number(avgShiftHours);
  const rooms = Number(totalLocations);
  const operatingDays = Number(operatingDaysPerYear);

  // Estimate ANES/CRNA split based on team model
  let crnaPerAnes;
  if (primaryTeamModel === '1:3') crnaPerAnes = 3;
  else if (primaryTeamModel === '1:4') crnaPerAnes = 4;
  else if (primaryTeamModel === 'solo') crnaPerAnes = 0;
  else if (primaryTeamModel === '1:2') crnaPerAnes = 2;
  else crnaPerAnes = 2.5; // mixed

  // Inefficiency #1 — Team model. Floored at PROJECTION_FLOOR_INEFF1_PCT
  // (industry-typical assumption, labeled in the drill-down) — form inputs
  // alone can't surface the day-to-day waste that schedule uploads reveal.
  let inefficiency1Pct;
  if (crnaPerAnes < 1 && crnaPerAnes > 0) inefficiency1Pct = 7.5;
  else if (crnaPerAnes > 0 && crnaPerAnes < 3) inefficiency1Pct = Math.round((3 - crnaPerAnes) / 3 * 7.5 * 10) / 10;
  else inefficiency1Pct = PROJECTION_FLOOR_INEFF1_PCT; // efficient (>=1:3) or solo — floor only
  inefficiency1Pct = Math.max(PROJECTION_FLOOR_INEFF1_PCT, inefficiency1Pct);
  const floorApplied = inefficiency1Pct === PROJECTION_FLOOR_INEFF1_PCT;

  const totalBudget = rooms * ((anesRate + crnaPerAnes * crnaRate) / (1 + crnaPerAnes)) * shiftHours * operatingDays;
  const inefficiency1Cost = Math.round(totalBudget * (inefficiency1Pct / 100));

  // Inefficiency #2 — Overstaffing to maximum capacity (industry-typical
  // assumption: ~25% of rooms carry a ~$35/hr staffing premium; also labeled
  // as an estimate in the drill-down, replaced by realized data).
  const overstaffedRooms = rooms * 0.25;
  const inefficiency2Cost = Math.round(overstaffedRooms * 35 * shiftHours * operatingDays);
  const inefficiency2Pct = totalBudget > 0 ? Math.round((inefficiency2Cost / totalBudget) * 1000) / 10 : 0.5;

  // One score formula everywhere: score = 100 − waste% of staffing spend.
  // The gap from 100 IS the waste percentage — a CFO can recompute it.
  const wasteRatioPct = inefficiency1Pct + inefficiency2Pct;
  const score = Math.min(100, Math.max(0, Math.round(100 - wasteRatioPct)));

  return {
    score,
    inefficiency1Pct,
    inefficiency2Pct,
    inefficiency1Cost,
    inefficiency2Cost,
    totalBudget: Math.round(totalBudget),
    floorApplied, // true when the industry-typical floor set lever 1 (label it)
    // Back-compat deduction breakdown: components now sum exactly to 100 − score.
    deduction1: Math.round(inefficiency1Pct * 10) / 10,
    deduction2: 0,
    deduction3: Math.round(inefficiency2Pct * 10) / 10,
  };
}

function getScoreStatus(score) {
  if (score >= 90) return { label: 'Excellent', message: 'Your facility is operating at excellent efficiency. Industry leading performance.', zone: 'blue' };
  if (score >= 71) return { label: 'Good', message: 'Your facility is performing well. Minor optimizations available.', zone: 'green' };
  if (score >= 41) return { label: 'Below Average', message: 'Your facility is below industry average efficiency. Significant savings available.', zone: 'yellow' };
  return { label: 'Critical', message: 'Your facility has critical staffing inefficiencies. Immediate action recommended.', zone: 'red' };
}

module.exports = {
  analyzeDayEfficiency,
  analyzeFacilitySchedule,
  calculateScoreFromAnalysis,
  calculateStaffIQScore,
  getScoreStatus,
  dayOfWeekFromLabel,
  DEFAULT_ANES_RATE,
  DEFAULT_CRNA_RATE,
  DEFAULT_SHIFT_HOURS,
  DEFAULT_OPERATING_DAYS,
  PROJECTION_FLOOR_INEFF1_PCT,
};
