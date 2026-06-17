'use strict';

// Default loaded costs per hour
const DEFAULT_ANES_RATE = 390;
const DEFAULT_CRNA_RATE = 260;
const DEFAULT_SHIFT_HOURS = 10;
const DEFAULT_OPERATING_DAYS = 250;

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

  // Care-team supervision ratios (display only) — computed solely on days with
  // both provider types present, so solo/independent days never skew them.
  const weekdayRatios = []; // Mon-Thu care-team days
  const fridayRatios = [];   // Friday care-team days

  // Waste-per-room samples drive the actual Friday-shortage decision.
  const weekdayWastePerRoom = [];
  const fridayWastePerRoom = [];
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
    if (day.isPotentialClinicalOverride) clinicalOverrideDays++;

    // Prefer the weekday the source file stated (rec.dayOfWeek, 0=Sun..6=Sat);
    // fall back to deriving it from the date string only if no label was carried.
    const dow = Number.isInteger(rec.dayOfWeek)
      ? rec.dayOfWeek
      : new Date(rec.date + 'T12:00:00').getDay();

    if (dow === 5) {
      fridayDayCount++;
      fridayRoomTotal += day.totalRooms;
      fridayWastePerRoom.push(day.wastePerRoom);
      if (day.isCareTeam) fridayRatios.push(day.supervisionRatio);
    } else if (dow >= 1 && dow <= 4) {
      weekdayDayCount++;
      weekdayRoomTotal += day.totalRooms;
      weekdayWastePerRoom.push(day.wastePerRoom);
      if (day.isCareTeam) weekdayRatios.push(day.supervisionRatio);
    }
  });

  const inefficiencyPct = totalDays > 0 ? (inefficientDays / totalDays) * 100 : 0;
  const annualWaste = (totalActualCost - totalOptimalCost) * (operatingDays / Math.max(totalDays, 1));

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // Display-only care-team ratios.
  const avgWeekdayRatio = avg(weekdayRatios);
  const avgFridayRatio = avg(fridayRatios);
  const fridayRatioDrop = avgWeekdayRatio > 0 ? (avgWeekdayRatio - avgFridayRatio) / avgWeekdayRatio : 0;

  // Friday-shortage decision: do Fridays carry materially more cost-above-optimal
  // per room than Mon–Thu? This is true only when Fridays are genuinely staffed
  // less efficiently (e.g. MD backfill) — not merely lighter.
  const avgFridayWastePerRoom = avg(fridayWastePerRoom);
  const avgWeekdayWastePerRoom = avg(weekdayWastePerRoom);
  const excessWastePerRoom = Math.max(0, avgFridayWastePerRoom - avgWeekdayWastePerRoom);
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
    return { score: 84, deduction1: 8, deduction2: 5, deduction3: 3, details: [], calculationMethod: 'default' };
  }

  // Deduction 1: Team model inefficiency (weighted by room count)
  const totalRooms = facilities.reduce((s, f) => s + f.avgRooms * f.totalDays, 0);
  let weightedInefficiency = 0;
  facilities.forEach(f => {
    const weight = totalRooms > 0 ? (f.avgRooms * f.totalDays) / totalRooms : 1 / facilities.length;
    weightedInefficiency += f.inefficiencyPct * weight;
  });
  const deduction1 = Math.round(weightedInefficiency * 0.5 * 10) / 10;

  // Deduction 2: Friday shortage (5 pts per affected facility)
  const facilitiesWithFriday = facilities.filter(f => f.hasFridayShortage).length;
  const deduction2 = facilitiesWithFriday * 5;

  // Deduction 3: Utilization gap (compare actual avg utilization vs 75% target)
  // Each 1% below 75% avg utilization = 0.3 pts deduction
  const avgUtilization = facilities.reduce((s, f) => {
    // Utilization: avgRoomsRun / maxRooms (we approximate maxRooms as avgRooms * 1.25 if no data)
    return s + Math.min(f.avgRooms / (f.avgRooms * 1.15), 1);
  }, 0) / facilities.length;
  const utilizationGap = Math.max(0, 0.75 - avgUtilization) * 100;
  const deduction3 = Math.round(utilizationGap * 0.3 * 10) / 10;

  const score = Math.min(100, Math.max(0, Math.round(100 - deduction1 - deduction2 - deduction3)));

  return {
    score,
    deduction1,
    deduction2,
    deduction3,
    totalDeduction: Math.round((deduction1 + deduction2 + deduction3) * 10) / 10,
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

  // Inefficiency #1 — Team model
  let inefficiency1Pct;
  if (crnaPerAnes >= 3) inefficiency1Pct = 1.0; // efficient
  else if (crnaPerAnes === 0) inefficiency1Pct = 1.5; // solo - ok
  else if (crnaPerAnes < 1) inefficiency1Pct = 7.5;
  else inefficiency1Pct = Math.round((3 - crnaPerAnes) / 3 * 7.5 * 10) / 10;

  const totalBudget = rooms * ((anesRate + crnaPerAnes * crnaRate) / (1 + crnaPerAnes)) * shiftHours * operatingDays;
  const inefficiency1Cost = Math.round(totalBudget * (inefficiency1Pct / 100));

  // Inefficiency #2 — Overstaffing to maximum capacity
  const overstaffedRooms = rooms * 0.25;
  const inefficiency2Cost = Math.round(overstaffedRooms * 35 * shiftHours * operatingDays);
  const inefficiency2Pct = totalBudget > 0 ? Math.round((inefficiency2Cost / totalBudget) * 1000) / 10 : 0.5;

  const deduction1 = inefficiency1Pct * 0.5;
  const deduction2 = 0; // no Friday data from manual input
  const deduction3 = inefficiency2Pct * 0.3;
  const score = Math.min(100, Math.max(0, Math.round(100 - deduction1 - deduction2 - deduction3)));

  return {
    score,
    inefficiency1Pct,
    inefficiency2Pct,
    inefficiency1Cost,
    inefficiency2Cost,
    totalBudget: Math.round(totalBudget),
    deduction1: Math.round(deduction1 * 10) / 10,
    deduction2,
    deduction3: Math.round(deduction3 * 10) / 10,
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
};
