'use strict';
/**
 * StaffIQ stress test — exercises the score math and the learning/savings
 * pipeline against every locked decision (2026-07-07) plus edge cases.
 * DB is mocked via require.cache injection; no network, no real data touched.
 */

const path = require('path');
const BACKEND = require('path').join(__dirname, '..');

// ── Prisma mock ────────────────────────────────────────────────────────────────
const state = {
  profile: null, profiles: [], input: null, bookings: [],
  benchmarks: {}, outcomes: [], facilities: [],
};
const calls = [];

const mockPrisma = {
  facilityStaffingProfile: {
    findUnique: async (args) => { calls.push(['profile.findUnique', args]); return state.profile; },
    findMany: async (args) => { calls.push(['profile.findMany', args]); return state.profiles; },
    upsert: async (args) => {
      calls.push(['profile.upsert', args]);
      state.profile = state.profile ? { ...state.profile, ...args.update } : { facilityId: args.where.facilityId, ...args.create };
      return state.profile;
    },
  },
  staffIQInput: {
    findFirst: async (args) => { calls.push(['input.findFirst', args]); return state.input; },
  },
  shiftBooking: {
    findMany: async (args) => {
      calls.push(['booking.findMany', args]);
      const gte = args?.where?.confirmedAt?.gte;
      return state.bookings.filter((b) =>
        (!gte || b.confirmedAt >= gte) && b.completedAt != null
      );
    },
  },
  staffIQBenchmark: {
    findUnique: async ({ where }) => state.benchmarks[where.metric_scope.metric] || null,
    findMany: async () => Object.entries(state.benchmarks).map(([metric, v]) => ({ metric, scope: 'network', ...v })),
    upsert: async (args) => {
      calls.push(['benchmark.upsert', args]);
      const existing = state.benchmarks[args.where.metric_scope.metric];
      state.benchmarks[args.where.metric_scope.metric] = existing ? { ...existing, ...args.update } : { ...args.create };
      return state.benchmarks[args.where.metric_scope.metric];
    },
  },
  staffIQOutcome: {
    create: async (args) => {
      calls.push(['outcome.create', args]);
      const row = { id: `o${state.outcomes.length}`, createdAt: new Date(), ...args.data };
      state.outcomes.push(row);
      return row;
    },
    findMany: async (args) => state.outcomes
      .filter((o) => o.outcomeType === args.where.outcomeType)
      .map((o) => ({ ...o, facility: { id: o.facilityId, name: `Facility-${o.facilityId}`, isDemo: false } })),
  },
  facility: {
    findMany: async (args) => { calls.push(['facility.findMany', args]); return state.facilities; },
  },
};

const dbPath = require.resolve(path.join(BACKEND, 'src/config/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockPrisma };

const score = require(path.join(BACKEND, 'src/utils/staffiqScore.js'));
const learning = require(path.join(BACKEND, 'src/services/staffiqLearning.js'));

// ── tiny assert harness ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`); }
}
function section(t) { console.log(`\n═══ ${t} ═══`); }
function resetState() {
  state.profile = null; state.profiles = []; state.input = null;
  state.bookings = []; state.benchmarks = {}; state.outcomes = []; state.facilities = [];
  calls.length = 0;
}
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * 86400000);

(async () => {

section('1. Day-level efficiency math (room model: supervisor sits NO room)');
{
  const solo = score.analyzeDayEfficiency(1, 0);
  check('solo MD day is efficient (zero waste)', solo.dailyWaste === 0 && solo.isEfficient && solo.pattern === 'SOLO_MD', solo);
  const optimal = score.analyzeDayEfficiency(1, 3);
  check('1 MD supervising 3 CRNAs = 3 rooms, zero waste', optimal.dailyWaste === 0 && optimal.totalRooms === 3, optimal);
  check('supervising MD occupies no room (supervisors=1, soloMDs=0)', optimal.supervisors === 1 && optimal.soloMDs === 0);

  // Matt's canonical problem day: 1 MD covering 2 CRNAs + 2 MDs sitting solo.
  const problem = score.analyzeDayEfficiency(3, 2, 390, 260, 10, 4);
  check('PROBLEM_MIX detected: 3 MD + 2 CRNA @1:4 → 4 rooms (1 supervising, 2 solo)',
    problem.pattern === 'PROBLEM_MIX' && problem.totalRooms === 4 && problem.supervisors === 1 && problem.soloMDs === 2, problem);
  check('problem day @1:4 = $2,600/day (= 2 MD→CRNA swaps × $130/hr × 10h, headcount preserved)', problem.dailyWaste === 2600, problem.dailyWaste);
  const problemR3 = score.analyzeDayEfficiency(3, 2, 390, 260, 10, 3);
  check('same day @1:3 (stricter leverage) = $1,300/day — ratio is decisive', problemR3.dailyWaste === 1300, problemR3.dailyWaste);

  const smallMix = score.analyzeDayEfficiency(2, 2, 390, 260, 10, 3);
  check('2 MD + 2 CRNA @1:3 → 3 rooms, $1,300/day PROBLEM_MIX', smallMix.dailyWaste === 1300 && smallMix.pattern === 'PROBLEM_MIX', smallMix);

  // Matt (2026-07-12): problem-mix waste is the SUBSTITUTION delta — the rate
  // difference of MD→CRNA swaps against the cheapest compliant mix covering
  // the SAME rooms with the SAME headcount — never the cost of a provider's
  // full day. A full day is charged only when a position is genuinely
  // redundant (the compliant optimum uses fewer people).
  const oneSwap = score.analyzeDayEfficiency(2, 3, 390, 260, 10, 4);
  check('substitution identity: 2 MD + 3 CRNA @1:4 = ONE swap × ($390−$260) × 10h = $1,300',
    oneSwap.dailyWaste === 1 * (390 - 260) * 10 && oneSwap.pattern === 'PROBLEM_MIX', oneSwap.dailyWaste);
  check('substitution identity: 3 MD + 2 CRNA @1:4 = TWO swaps × ($390−$260) × 10h = $2,600',
    problem.dailyWaste === 2 * (390 - 260) * 10, problem.dailyWaste);
  const customRateSwap = score.analyzeDayEfficiency(3, 2, 400, 300, 8, 4);
  check('substitution identity holds at arbitrary rates/hours: 2 swaps × ($400−$300) × 8h = $1,600',
    customRateSwap.dailyWaste === 2 * (400 - 300) * 8, customRateSwap.dailyWaste);
  const redundant = score.analyzeDayEfficiency(3, 1, 390, 260, 10, 3);
  check('redundant-provider day: 3 MD + 1 CRNA @1:3 → optimal is 3 solo MDs, waste = full CRNA day ($2,600)',
    redundant.dailyWaste === 260 * 10 && redundant.totalRooms === 3, redundant);

  // Matt (2026-07-10): "all-MD days don't necessarily increase costs."
  const allMd3 = score.analyzeDayEfficiency(3, 0, 390, 260, 10, 3);
  check('all-MD 3-room day @1:3 is COST-NEUTRAL (zero waste)', allMd3.dailyWaste === 0 && allMd3.pattern === 'ALL_MD', allMd3);
  const allMd4r4 = score.analyzeDayEfficiency(4, 0, 390, 260, 10, 4);
  check('all-MD 4-room day @1:4 carries structural waste ($1,300)', allMd4r4.dailyWaste === 1300 && allMd4r4.isPotentialClinicalOverride === true, allMd4r4);
  const allMd4r3 = score.analyzeDayEfficiency(4, 0, 390, 260, 10, 3);
  check('all-MD 4-room day @1:3 is cost-neutral (care team saves nothing at 1:3 default rates)', allMd4r3.dailyWaste === 0, allMd4r3);

  const crnaOnly = score.analyzeDayEfficiency(0, 4);
  check('independent-CRNA day never shows negative waste', crnaOnly.dailyWaste === 0 && crnaOnly.wastePerRoom === 0 && crnaOnly.pattern === 'CRNA_ONLY', crnaOnly);
  check('CRNA-only day is not a care-team day (excluded from ratios)', crnaOnly.isCareTeam === false);
  const empty = score.analyzeDayEfficiency(0, 0);
  check('zero-staff day: no division-by-zero, zero waste-per-room', empty.wastePerRoom === 0 && !Number.isNaN(empty.wastePerRoom) && empty.pattern === 'EMPTY');

  // Cheapest-compliant pricing sanity.
  check('1 room: solo MD ($390) beats supervised single CRNA ($650)', score.optimalStaffingCost(1, 390, 260, 4) === 390);
  check('4 rooms @1:4: care team ($1,430) beats 4 solo MDs ($1,560)', score.optimalStaffingCost(4, 390, 260, 4) === 1430);
  check('3 rooms @1:3: care team ties all-MD at $1,170 (default-rate equivalence)', score.optimalStaffingCost(3, 390, 260, 3) === 1170);
}

section('2. Friday detection (the fixed false-positive)');
{
  // Facility runs 6 efficient rooms Mon-Thu, and a LIGHT but efficient Friday (1 MD + 1 CRNA...
  // actually 1:1 is inefficient; use solo-MD Friday which is efficient).
  const week = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 1; d <= 4; d++) week.push({ date: `2026-06-0${d}`, anesCount: 2, crnaCount: 6, dayOfWeek: d }); // 1:3, efficient
    week.push({ date: '2026-06-05', anesCount: 1, crnaCount: 0, dayOfWeek: 5 }); // light solo Friday — efficient
  }
  const light = score.analyzeFacilitySchedule(week, 'LightFriday');
  check('light-but-efficient Friday is NOT flagged as shortage', light.hasFridayShortage === false, light.excessWastePerRoom);
  check('light Friday premium is $0', light.fridayAnnualPremium === 0);

  // Now a real shortage: Fridays run 4 rooms staffed ALL-MD-heavy (2 ANES + 2 CRNA = 1:1)
  const bad = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 1; d <= 4; d++) bad.push({ date: `2026-06-0${d}`, anesCount: 2, crnaCount: 6, dayOfWeek: d });
    bad.push({ date: '2026-06-05', anesCount: 2, crnaCount: 2, dayOfWeek: 5 }); // pricey mix
  }
  const shortage = score.analyzeFacilitySchedule(bad, 'BadFriday');
  check('genuinely MD-heavy Friday IS flagged', shortage.hasFridayShortage === true, shortage);
  check('Friday premium is positive and finite', shortage.fridayAnnualPremium > 0 && Number.isFinite(shortage.fridayAnnualPremium));

  // Sample-size guard: only 2 Fridays → never flagged regardless of waste
  const thin = bad.filter((r, i) => !(r.dayOfWeek === 5 && i > 10));
  const thinRes = score.analyzeFacilitySchedule(thin.slice(0, 12), 'ThinFriday');
  check('fewer than 3 Fridays → no shortage flag (sample guard)', thinRes.hasFridayShortage === false);

  // Weekend exclusion
  const withWeekend = [...week, { date: '2026-06-06', anesCount: 5, crnaCount: 0, isWeekend: true, dayOfWeek: 6 }];
  const wk = score.analyzeFacilitySchedule(withWeekend, 'Wk');
  check('weekend days are excluded from analysis', wk.totalDays === week.length);

  // File-stated weekday label wins over the date
  const labeled = [];
  for (let i = 0; i < 4; i++) {
    labeled.push({ date: '2026-06-01', anesCount: 2, crnaCount: 6, dayOfWeek: 1 });
    labeled.push({ date: '2026-06-01', anesCount: 2, crnaCount: 2, dayOfWeek: 5 }); // same date string, labeled Friday
  }
  const lab = score.analyzeFacilitySchedule(labeled, 'Labeled');
  check('dayOfWeek label from file is trusted over the date', lab.fridaySampleSize === 4, lab.fridaySampleSize);
}

section('3. Score consolidation (one formula everywhere, care-team basis)');
{
  const a = score.calculateScoreFromAnalysis([{ totalActualCost: 30000, totalCareTeamWaste: 3000, totalStructuralWaste: 0 }]);
  check('10% recoverable waste → score exactly 90', a.score === 90 && a.wasteRatioPct === 10, a);
  const b = score.calculateScoreFromAnalysis([
    { totalActualCost: 50000, totalCareTeamWaste: 0, totalStructuralWaste: 0 },
    { totalActualCost: 50000, totalCareTeamWaste: 10000, totalStructuralWaste: 0 },
  ]);
  check('multi-location aggregates by dollars (10% blended)', b.score === 90, b);
  const zero = score.calculateScoreFromAnalysis([{ totalActualCost: 0, totalCareTeamWaste: 0, totalStructuralWaste: 0 }]);
  check('zero-cost dataset → score 100, no NaN', zero.score === 100 && !Number.isNaN(zero.wasteRatioPct), zero);
  const emptyA = score.calculateScoreFromAnalysis([]);
  check('empty analysis → null score, never a fabricated 84', emptyA.score === null && emptyA.calculationMethod === 'insufficient_data');

  // THE SPLIT (methodology decision 2026-07-08): structural (all-MD) dollars
  // never touch the score or the recoverable claim — reported separately.
  const split = score.calculateScoreFromAnalysis([{ totalActualCost: 100000, totalCareTeamWaste: 4000, totalStructuralWaste: 11000 }]);
  check('score built on RECOVERABLE waste only (4% → 96)', split.score === 96 && split.wasteRatioPct === 4, split);
  check('structural opportunity reported separately (11%)', split.structuralRatioPct === 11, split);
  const allStructural = score.calculateScoreFromAnalysis([{ totalActualCost: 100000, totalCareTeamWaste: 0, totalStructuralWaste: 30000 }]);
  check('pure all-MD practice scores 100 (deliberate model ≠ scheduling failure)', allStructural.score === 100 && allStructural.structuralRatioPct === 30, allStructural);
}

section('3b. The waste split inside analyzeFacilitySchedule (room model)');
{
  // Declared MD-only site (like CAPA's Natick/Medford), 3 rooms daily at 1:3:
  // the practice model is cost-neutral — NO waste in either bucket. Matt's
  // "all-MD days don't necessarily increase costs", verified end-to-end.
  const mdOnly = [];
  for (let w = 0; w < 4; w++) for (let d = 1; d <= 4; d++) mdOnly.push({ date: `2026-06-0${d}`, anesCount: 3, crnaCount: 0, dayOfWeek: d });
  const mo = score.analyzeFacilitySchedule(mdOnly, 'MDOnly', { supervisionRatio: 3 });
  check('3-room all-MD site @1:3: recoverable = $0 AND structural = $0 (cost-neutral)',
    mo.annualWaste === 0 && mo.annualStructuralOpportunity === 0, { rec: mo.annualWaste, str: mo.annualStructuralOpportunity });
  check('all-MD site: override days all counted', mo.clinicalOverrideDays === mdOnly.length);
  check('all-MD site: recoverable waste/room baseline = $0', mo.avgWeekdayWastePerRoom === 0);

  // Big all-MD site at a 1:4 facility: care team genuinely wins → structural.
  const bigMd = [];
  for (let w = 0; w < 4; w++) for (let d = 1; d <= 4; d++) bigMd.push({ date: `2026-06-0${d}`, anesCount: 6, crnaCount: 0, dayOfWeek: d });
  const bm = score.analyzeFacilitySchedule(bigMd, 'BigMD', { supervisionRatio: 4 });
  check('6-room all-MD site @1:4: structural > $0, recoverable = $0',
    bm.annualStructuralOpportunity > 0 && bm.annualWaste === 0, { str: bm.annualStructuralOpportunity });

  // Mixed site: problem-mix days AND big all-MD days — split must sum exactly
  // to total actual−optimal (no dollars lost or double-counted).
  const mixed = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 1; d <= 2; d++) mixed.push({ date: `2026-06-0${d}`, anesCount: 3, crnaCount: 3, dayOfWeek: d }); // problem mix @1:4
    for (let d = 3; d <= 4; d++) mixed.push({ date: `2026-06-0${d}`, anesCount: 6, crnaCount: 0, dayOfWeek: d }); // big all-MD
  }
  const mx = score.analyzeFacilitySchedule(mixed, 'Mixed', { supervisionRatio: 4 });
  check('split sums exactly: recoverable + structural = actual − optimal',
    mx.totalCareTeamWaste + mx.totalStructuralWaste === mx.totalActualCost - mx.totalOptimalCost,
    { careTeam: mx.totalCareTeamWaste, structural: mx.totalStructuralWaste, gap: mx.totalActualCost - mx.totalOptimalCost });
  check('mixed site: both buckets positive', mx.totalCareTeamWaste > 0 && mx.totalStructuralWaste > 0);

  // Problem-day itemization: Matt's low-hanging fruit, parsed cleanly.
  const shattuckLike = [];
  for (let w = 0; w < 4; w++) for (let d = 1; d <= 4; d++) shattuckLike.push({ date: `2026-06-0${d}`, anesCount: 3, crnaCount: 1, dayOfWeek: d });
  const sl = score.analyzeFacilitySchedule(shattuckLike, 'ShattuckLike', { supervisionRatio: 3 });
  check('problem days counted and itemized', sl.problemDayCount === shattuckLike.length && sl.problemDays.length > 0, sl.problemDayCount);
  check('itemized day carries the fix-legible config (1 supervising, 2 solo)',
    sl.problemDays[0].supervisors === 1 && sl.problemDays[0].soloMDs === 2 && sl.problemDays[0].dailyWaste === 2600, sl.problemDays[0]);
  check('problem-day waste is recoverable (in annualWaste, not structural)',
    sl.annualWaste > 0 && sl.annualStructuralOpportunity === 0);

  // Friday problem-mix (supervisor under capacity + solo MDs on Fridays) still
  // trips Friday detection...
  const fridayProblem = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 1; d <= 4; d++) fridayProblem.push({ date: `2026-06-0${d}`, anesCount: 2, crnaCount: 6, dayOfWeek: d }); // efficient
    fridayProblem.push({ date: '2026-06-05', anesCount: 3, crnaCount: 1, dayOfWeek: 5 }); // problem-mix Friday
  }
  const fp = score.analyzeFacilitySchedule(fridayProblem, 'FridayProblem', { supervisionRatio: 3 });
  check('problem-mix Friday flags the Friday shortage', fp.hasFridayShortage === true, fp.excessWastePerRoom);
  check('...and its dollars are recoverable', fp.annualWaste > 0);

  // ...but a cost-neutral all-MD Friday must NOT false-flag (the old engine
  // would have — Matt's correction).
  const fridayAllMd = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 1; d <= 4; d++) fridayAllMd.push({ date: `2026-06-0${d}`, anesCount: 2, crnaCount: 6, dayOfWeek: d });
    fridayAllMd.push({ date: '2026-06-05', anesCount: 3, crnaCount: 0, dayOfWeek: 5 }); // all-MD 3-room Friday
  }
  const fa = score.analyzeFacilitySchedule(fridayAllMd, 'FridayAllMd', { supervisionRatio: 3 });
  check('cost-neutral all-MD 3-room Friday does NOT false-flag', fa.hasFridayShortage === false, fa.excessWastePerRoom);
}

section('4. Projection floor (2%, labeled)');
{
  for (const model of ['1:3', 'solo', 'mixed', '1:2']) {
    const r = score.calculateStaffIQScore({ totalLocations: 8, primaryTeamModel: model });
    check(`${model}: ineff1 >= 2%`, r.inefficiency1Pct >= 2.0, r.inefficiency1Pct);
    check(`${model}: score + waste% = 100 (recomputable by a CFO)`,
      Math.abs(100 - r.score - (r.inefficiency1Pct + r.inefficiency2Pct)) < 0.51,
      { score: r.score, waste: r.inefficiency1Pct + r.inefficiency2Pct });
  }
  const eff = score.calculateStaffIQScore({ totalLocations: 8, primaryTeamModel: '1:3' });
  check('efficient model reports floorApplied=true', eff.floorApplied === true);
  const ineff = score.calculateStaffIQScore({ totalLocations: 8, primaryTeamModel: '1:2' });
  check('1:2 model reports floorApplied=false (real inefficiency, not floor)', ineff.floorApplied === false, ineff.inefficiency1Pct);
  check('1:2 projects MORE waste than 1:3 (floor never inverts ordering)',
    ineff.inefficiency1Pct > eff.inefficiency1Pct);
  const one = score.calculateStaffIQScore({ totalLocations: 1, primaryTeamModel: 'solo', avgShiftHours: 8, operatingDaysPerYear: 200 });
  check('1-room solo facility: sane, positive, finite numbers', one.totalBudget > 0 && Number.isFinite(one.score));
}

section('5. Savings authority — basis selection per lever');
{
  // 5a. Nothing at all → insufficient, no fabricated number
  resetState();
  let r = await learning.projectFacilitySavings('f1');
  check('no data → basis insufficient, monthly null', r.basis === 'insufficient' && r.monthly === null, r);

  // 5b. Inputs only → both levers projected
  resetState();
  state.input = {
    totalLocations: 8, avgRoomsPerDay: 6, primaryTeamModel: '1:2',
    inefficiency1Cost: 120000, inefficiency2Cost: 60000, // annual
    agencyAnesthesiologistsPerMonth: 2, agencyCrnasPerMonth: 4,
    avgAnesthesiologistRate: 390, avgCrnaRate: 260, avgShiftHours: 10,
  };
  r = await learning.projectFacilitySavings('f1');
  check('inputs only → basis projected', r.basis === 'projected');
  const lever1 = r.components.find(c => c.key === 'staffing_efficiency');
  const lever2 = r.components.find(c => c.key === 'agency_displacement');
  check('lever1 projected = (ineff1+ineff2)/12 = $15,000', lever1.monthly === 15000, lever1);
  // lever2: anes prem = 425-390=35, crna prem = 300-260=40 → (2*35 + 4*40)*10 = 2300
  check('lever2 projected with PRIOR rates = $2,300', lever2.monthly === 2300, lever2);
  check('agencyRateSource = estimated (nothing entered)', r.assumptions.agencyRateSource === 'estimated');
  check('monthly = lever1 + lever2', r.monthly === 17300, r.monthly);
  check('annual = 12 × monthly', r.annual === 17300 * 12);

  // 5c. Facility enters their own agency rates → theirs win, label flips
  state.input.agencyAnesthesiologistRate = 500; state.input.agencyCrnaRate = 320;
  r = await learning.projectFacilitySavings('f1');
  const l2b = r.components.find(c => c.key === 'agency_displacement');
  // anes prem = 500-390=110, crna prem = 320-260=60 → (2*110 + 4*60)*10 = 4600
  check('lever2 uses FACILITY rates when entered = $4,600', l2b.monthly === 4600, l2b);
  check('agencyRateSource = facility', r.assumptions.agencyRateSource === 'facility');
  check('assumptions expose the effective rates', r.assumptions.agencyRates.ANESTHESIOLOGIST === 500 && r.assumptions.agencyRates.CRNA === 320);

  // 5d. Only one rate entered → mixed
  state.input.agencyCrnaRate = null;
  r = await learning.projectFacilitySavings('f1');
  check('one of two rates entered → agencyRateSource = mixed', r.assumptions.agencyRateSource === 'mixed');
  state.input.agencyCrnaRate = 320;

  // 5e. Profile below the 20-obs gate → lever1 stays projected
  state.profile = { facilityId: 'f1', observationCount: 12, avgWeekdayWastePerRoom: 200, avgFridayWastePerRoom: 50, avgCostPerRoom: 3000, avgRoomsByDow: { weekday: 6, friday: 4 } };
  r = await learning.projectFacilitySavings('f1');
  check('12 observed days < 20 → lever1 still projected', r.components.find(c => c.key === 'staffing_efficiency').basis === 'projected');

  // 5f. Profile at/above gate → lever1 realized, exact math
  state.profile.observationCount = 40;
  r = await learning.projectFacilitySavings('f1');
  const l1r = r.components.find(c => c.key === 'staffing_efficiency');
  const expectL1 = Math.round(200 * 6 * 21.7 + 50 * 4 * 4.34);
  check(`lever1 realized = waste/room × rooms × freq = $${expectL1}`, l1r.monthly === expectL1 && l1r.basis === 'realized', l1r);
  check('overall basis = realized once any lever is realized', r.basis === 'realized');
  check('confidence = obs/60 capped (40/60 → 67%)', r.confidence === 67, r.confidence);
  check('realized score = 100 − waste/cost (200/3000 → 93)', r.score === 93 && r.scoreBasis === 'realized', { score: r.score, basis: r.scoreBasis });

  // 5g. Confidence caps at 100
  state.profile.observationCount = 500;
  r = await learning.projectFacilitySavings('f1');
  check('confidence caps at 100%', r.confidence === 100);
}

section('6. Trailing-30-day realized window (no month-boundary sawtooth)');
{
  resetState();
  state.input = { agencyAnesthesiologistsPerMonth: 0, agencyCrnasPerMonth: 0, avgAnesthesiologistRate: 390, avgCrnaRate: 260, avgShiftHours: 10, inefficiency1Cost: 0, inefficiency2Cost: 0 };
  // one CRNA fill 10 days ago at $250/hr for 10h → saved (300-250)*10 = $500
  state.bookings = [
    { confirmedAt: daysAgo(10), completedAt: daysAgo(10), providerHourlyRate: 250, shiftDurationHours: 10, shift: { specialty: 'CRNA', durationHours: 10, currentRate: 250 } },
    // and one 45 days ago that must NOT count
    { confirmedAt: daysAgo(45), completedAt: daysAgo(45), providerHourlyRate: 200, shiftDurationHours: 10, shift: { specialty: 'CRNA', durationHours: 10, currentRate: 200 } },
  ];
  const r = await learning.projectFacilitySavings('f1');
  const l2 = r.components.find(c => c.key === 'agency_displacement');
  check('fill inside 30d window counts, fill outside does not ($500)', l2.monthly === 500 && l2.basis === 'realized', l2);
  const bookingCall = calls.find(c => c[0] === 'booking.findMany');
  const gte = bookingCall[1].where.confirmedAt.gte;
  const windowDays = Math.round((NOW - gte.getTime()) / 86400000);
  check(`query window is ~30 days (got ${windowDays})`, windowDays >= 29 && windowDays <= 31);
  check('payload advertises realizedWindowDays = 30', r.realizedWindowDays === 30);

  // provider paid MORE than agency → clamps to 0, never negative savings
  state.bookings = [{ confirmedAt: daysAgo(5), completedAt: daysAgo(5), providerHourlyRate: 450, shiftDurationHours: 10, shift: { specialty: 'CRNA', durationHours: 10, currentRate: 450 } }];
  const r2 = await learning.projectFacilitySavings('f1');
  check('above-agency-rate fill contributes $0 (never negative)', r2.components.find(c => c.key === 'agency_displacement').monthly === 0);

  // unknown specialty falls back to CRNA rate, not undefined math
  state.bookings = [{ confirmedAt: daysAgo(5), completedAt: daysAgo(5), providerHourlyRate: 250, shiftDurationHours: 10, shift: { specialty: 'SOMETHING_NEW', durationHours: 10, currentRate: 250 } }];
  const r3 = await learning.projectFacilitySavings('f1');
  check('unknown specialty → CRNA fallback, finite number', Number.isFinite(r3.components.find(c => c.key === 'agency_displacement').monthly));
}

section('7. Observation-count inflation is dead');
{
  resetState();
  const mkResults = (days) => [{
    facilityName: 'Main', totalDays: days, avgRooms: 6, inefficiencyPct: 20,
    totalActualCost: days * 6 * 3000, avgWeekdayWastePerRoom: 150, excessWastePerRoom: 0,
    avgWeekdayRooms: 6, avgFridayRooms: 4, fridaySampleSize: Math.floor(days / 5),
    weekdayRatios: [3, 3], avgWeekdayRatio: 3,
  }];
  await learning.updateFacilityProfile('f1', mkResults(20), 90, 30);
  check('first analysis: observationCount = 20', state.profile.observationCount === 20, state.profile.observationCount);
  check('first analysis: uploadsAnalyzed = 1', state.profile.uploadsAnalyzed === 1);

  // re-run same data 5 times — THE old inflation bug
  for (let i = 0; i < 5; i++) await learning.updateFacilityProfile('f1', mkResults(20), 90, 30);
  check('5 re-runs on SAME data: observationCount still 20 (no inflation)', state.profile.observationCount === 20, state.profile.observationCount);
  check('5 re-runs: uploadsAnalyzed still 1 (no fake recurrence)', state.profile.uploadsAnalyzed === 1, state.profile.uploadsAnalyzed);

  // new month arrives → grows once
  await learning.updateFacilityProfile('f1', mkResults(42), 88, 62);
  check('new data (42 days): observationCount = 42', state.profile.observationCount === 42);
  check('new data: uploadsAnalyzed = 2', state.profile.uploadsAnalyzed === 2);

  // dataset shrinks (records deleted) → profile mirrors reality, count drops
  await learning.updateFacilityProfile('f1', mkResults(10), 92, 15);
  check('shrunken dataset: count drops to 10 (mirrors the data, never lies)', state.profile.observationCount === 10);
}

section('8. Network benchmark — demo exclusion + thin-network guard');
{
  resetState();
  state.profiles = [{ avgCostPerRoom: 3000, avgCareTeamRatio: 3, avgWeekdayWastePerRoom: 150, avgFridayWastePerRoom: 50 }];
  let res = await learning.updateNetworkBenchmark();
  check('1 facility < 3 → benchmark stays on seed priors', res.computed === false);
  const fm = calls.find(c => c[0] === 'profile.findMany');
  check('benchmark query EXCLUDES demo facilities', JSON.stringify(fm[1]).includes('"isDemo":false'), fm[1]);

  state.benchmarks = {}; calls.length = 0;
  // Threshold is 5 facilities (anti-de-anonymization) — 5 profiles, median 3000.
  state.profiles = [
    { avgCostPerRoom: 1000, avgCareTeamRatio: 3.5, avgWeekdayWastePerRoom: 50,  avgFridayWastePerRoom: 0 },
    { avgCostPerRoom: 2000, avgCareTeamRatio: 3, avgWeekdayWastePerRoom: 100, avgFridayWastePerRoom: 0 },
    { avgCostPerRoom: 3000, avgCareTeamRatio: 2.5, avgWeekdayWastePerRoom: 200, avgFridayWastePerRoom: 100 },
    { avgCostPerRoom: 4000, avgCareTeamRatio: 2, avgWeekdayWastePerRoom: 300, avgFridayWastePerRoom: 200 },
    { avgCostPerRoom: 5000, avgCareTeamRatio: 1.5, avgWeekdayWastePerRoom: 400, avgFridayWastePerRoom: 300 },
  ];
  res = await learning.updateNetworkBenchmark();
  check('5 facilities → computed distribution', res.computed === true && res.facilityCount === 5);
  check('median costPerRoom = 3000', state.benchmarks.costPerRoom.median === 3000, state.benchmarks.costPerRoom);
  check('benchmark rows marked source=computed', state.benchmarks.costPerRoom.source === 'computed');

  // seeding never clobbers computed data
  await learning.seedNetworkPriors();
  check('re-seeding priors does NOT overwrite computed rows', state.benchmarks.costPerRoom.median === 3000 && state.benchmarks.costPerRoom.source === 'computed');
}

section('9. Calibration snapshots (measure only)');
{
  resetState();
  state.facilities = [{ id: 'f1' }, { id: 'f2' }];
  // f1 has inputs + realized profile; f2 has nothing
  state.input = {
    inefficiency1Cost: 120000, inefficiency2Cost: 0,
    agencyAnesthesiologistsPerMonth: 1, agencyCrnasPerMonth: 0,
    avgAnesthesiologistRate: 390, avgCrnaRate: 260, avgShiftHours: 10,
  };
  state.profile = { facilityId: 'f1', observationCount: 30, avgWeekdayWastePerRoom: 100, avgFridayWastePerRoom: 0, avgCostPerRoom: 3000, avgRoomsByDow: { weekday: 6, friday: 4 } };
  const snap = await learning.recordSavingsSnapshots();
  check('snapshot run reports counts', snap.facilities === 2 && snap.recorded === 2, snap);
  const facFilter = calls.find(c => c[0] === 'facility.findMany');
  check('snapshot run excludes demo facilities', JSON.stringify(facFilter[1]).includes('"isDemo":false'));
  const s1 = state.outcomes[0];
  check('snapshot stores BOTH projected and realized sides', s1.predictedDollar != null && s1.realizedDollar != null, s1);
  check('snapshot metadata carries per-lever detail + window', s1.metadata.lever1 && s1.metadata.realizedWindowDays === 30);

  // calibration summary math
  state.outcomes = [];
  for (const [p, r] of [[10000, 8000], [10000, 9000], [10000, 10000]]) {
    state.outcomes.push({ facilityId: 'f1', outcomeType: 'SAVINGS_SNAPSHOT', predictedDollar: p, realizedDollar: r, createdAt: new Date(), metadata: {} });
  }
  state.outcomes.push({ facilityId: 'f2', outcomeType: 'SAVINGS_SNAPSHOT', predictedDollar: 5000, realizedDollar: null, createdAt: new Date(), metadata: {} });
  const cal = await learning.getSavingsCalibration();
  const f1 = cal.facilities.find(f => f.facilityId === 'f1');
  const f2 = cal.facilities.find(f => f.facilityId === 'f2');
  check('avg realized÷projected = 0.9 across 3 matched cycles', f1.avgRealizedToProjected === 0.9, f1.avgRealizedToProjected);
  check('3 matched cycles → readyForCalibration = true', f1.readyForCalibration === true);
  check('unmatched snapshots (no realized) do not count as cycles', f2.matchedCycles === 0 && f2.readyForCalibration === false);
  check('auto-calibration explicitly reported OFF', cal.autoCalibration === 'off');
}

section('10. Learning-layer failure isolation (must never break an analysis)');
{
  resetState();
  // make every prisma call explode
  const boom = async () => { throw new Error('db down'); };
  mockPrisma.facilityStaffingProfile.findUnique = boom;
  mockPrisma.facilityStaffingProfile.findMany = boom;
  mockPrisma.staffIQInput.findFirst = boom;
  mockPrisma.shiftBooking.findMany = boom;
  mockPrisma.facility.findMany = boom;
  const p = await learning.updateFacilityProfile('f1', [{ totalDays: 5, avgRooms: 3, totalActualCost: 1000 }], 90, 10);
  check('updateFacilityProfile returns null on DB failure (no throw)', p === null);
  const b = await learning.updateNetworkBenchmark();
  check('updateNetworkBenchmark degrades gracefully', b.computed === false);
  const s = await learning.projectFacilitySavings('f1');
  check('projectFacilitySavings degrades to insufficient (no throw)', s.basis === 'insufficient' && s.monthly === null);
  const snap = await learning.recordSavingsSnapshots();
  check('recordSavingsSnapshots degrades gracefully', snap.recorded === 0);
}

section('11. Pitch projection — same engine as the facility dashboard');
{
  resetState();
  // restore working mocks (section 10 broke them on purpose)
  mockPrisma.facilityStaffingProfile.findUnique = async () => state.profile;
  mockPrisma.staffIQInput.findFirst = async () => state.input;
  mockPrisma.shiftBooking.findMany = async () => [];

  const insufficient = learning.projectFromInputs({});
  check('no rooms → insufficient, never a fabricated pitch number', insufficient.basis === 'insufficient' && insufficient.monthly === null);
  const alsoBad = learning.projectFromInputs({ totalLocations: 'abc' });
  check('garbage input → insufficient, no NaN', alsoBad.basis === 'insufficient');

  const raw = {
    totalLocations: 8, primaryTeamModel: '1:2',
    avgAnesthesiologistRate: 390, avgCrnaRate: 260, avgShiftHours: 10, operatingDaysPerYear: 250,
    agencyAnesthesiologistsPerMonth: 2, agencyCrnasPerMonth: 4,
  };
  const pitch = learning.projectFromInputs(raw);
  check('pitch projection produces a positive monthly number', pitch.monthly > 0 && pitch.basis === 'projected');
  check('pitch score matches the inputs-form score engine', pitch.score === score.calculateStaffIQScore({ ...raw }).score);

  // THE one-authority guarantee: pitch number === facility dashboard number
  // when the same inputs are saved as a StaffIQInput.
  const sc = score.calculateStaffIQScore({ ...raw });
  state.input = {
    ...raw,
    inefficiency1Cost: sc.inefficiency1Cost,
    inefficiency2Cost: sc.inefficiency2Cost,
  };
  const dash = await learning.projectFacilitySavings('f1');
  check('PITCH NUMBER === DASHBOARD NUMBER for identical inputs (one engine)', pitch.monthly === dash.monthly, { pitch: pitch.monthly, dashboard: dash.monthly });
  check('pitch lever split matches dashboard lever split',
    pitch.components[0].monthly === dash.components[0].monthly && pitch.components[1].monthly === dash.components[1].monthly,
    { pitch: pitch.components.map(c => c.monthly), dash: dash.components.map(c => c.monthly) });

  // Agency rates: entered rates flow through and flip the label
  const withRates = learning.projectFromInputs({ ...raw, agencyAnesthesiologistRate: 500, agencyCrnaRate: 320 });
  check('pitch uses entered agency rates (bigger lever 2)',
    withRates.components[1].monthly > pitch.components[1].monthly);
  check('pitch agencyRateSource flips to facility', withRates.assumptions.agencyRateSource === 'facility');
  check('default pitch labeled estimated', pitch.assumptions.agencyRateSource === 'estimated');

  const efficient = learning.projectFromInputs({ totalLocations: 8, primaryTeamModel: '1:3' });
  check('efficient prospect still projects a number (2% floor) with floorApplied flag',
    efficient.monthly > 0 && efficient.assumptions.efficiencyFloorApplied === true);
  check('pitch echoes resolved inputs for the deck to display', efficient.inputs.totalLocations === 8 && efficient.inputs.avgAnesthesiologistRate === 390);
}

console.log(`\n════════════════════════════════`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
