'use strict';

const { calculateStaffIQScore } = require('../utils/staffiqScore');

/**
 * StaffIQ learning layer.
 *
 * This is the piece that makes StaffIQ "get smarter" with data and becomes the
 * defensible moat:
 *
 *   1. Per-facility learned baselines (FacilityStaffingProfile) — each facility's
 *      own normal patterns, recomputed over its full schedule history on every
 *      analysis so the baseline is always exactly reproducible from the data,
 *      and gains confidence only as genuinely new staffed days arrive.
 *
 *   2. Cross-facility network benchmarks (StaffIQBenchmark) — percentile context
 *      computed across every participating facility. Seeded with published-norm
 *      priors so it's useful on day one (the "jump start"), then progressively
 *      replaced by real, computed distributions as facilities sign up and feed it.
 *
 *   3. Outcome feedback (StaffIQOutcome) — realized results (incentive fills,
 *      escalations, insight accept/dismiss) that let estimates be calibrated
 *      against ground truth over time.
 *
 * Everything here is best-effort: a failure to update the learning layer must
 * never break an analysis run, so callers should wrap calls in try/catch (or use
 * the safe wrappers below).
 */

const prisma = require('../config/db');

// Metrics tracked in the network benchmark. All are per-room or ratios so they
// are directly comparable across facilities of different sizes.
const BENCHMARK_METRICS = [
  'costPerRoom',
  'careTeamRatio',
  'inefficiencyPct',
  'wastePerRoom',
  'fridayExcessPerRoom',
];

// Published-norm priors used to jump-start the benchmark before enough real
// facilities exist to compute a meaningful distribution. Values are illustrative
// anesthesia-staffing norms ($/room over a ~10hr shift, ratios, percentages) and
// are clearly flagged as `seed_prior` so they can be distinguished from computed
// network data in the UI.
const SEED_PRIORS = {
  costPerRoom:         { p25: 2700, median: 3000, p75: 3400, mean: 3050 },
  careTeamRatio:       { p25: 2.0,  median: 2.5,  p75: 3.0,  mean: 2.5 },
  inefficiencyPct:     { p25: 5,    median: 12,   p75: 22,   mean: 13 },
  wastePerRoom:        { p25: 40,   median: 150,  p75: 350,  mean: 180 },
  fridayExcessPerRoom: { p25: 0,    median: 120,  p75: 400,  mean: 160 },
};

// Below this many participating facilities, the computed distribution is too thin
// to be trustworthy, so seed priors remain the displayed benchmark.
const MIN_FACILITIES_FOR_COMPUTED = 3;

// ── Aggregation helpers ────────────────────────────────────────────────────────

/**
 * Collapse the per-location facilityResults array (from analyzeFacilitySchedule)
 * into one set of facility-level, network-comparable metrics, weighting each
 * location by its volume (room-days).
 */
function summarizeResults(facilityResults) {
  if (!facilityResults || facilityResults.length === 0) return null;

  let totalActualCost = 0;
  let totalRooms = 0;          // room-days across all weekdays
  let roomDays = 0;            // weight = avgRooms * totalDays per location
  let wIneff = 0;
  let wRatio = 0;
  let wWeekdayWaste = 0;
  let wFridayExcess = 0;
  let totalDays = 0;
  let weekdayRoomsW = 0;       // weighted avg-weekday-rooms accumulator
  let fridayRoomsW = 0;
  let fridaySample = 0;

  for (const f of facilityResults) {
    const weight = Math.max(1, (f.avgRooms || 0) * (f.totalDays || 0));
    totalActualCost += f.totalActualCost || 0;
    totalRooms += (f.avgRooms || 0) * (f.totalDays || 0);
    roomDays += weight;
    wIneff += (f.inefficiencyPct || 0) * weight;
    // Care-team ratio is the average of the per-location care-team ratios.
    const locRatio = f.weekdayRatios && f.weekdayRatios.length
      ? f.weekdayRatios.reduce((a, b) => a + b, 0) / f.weekdayRatios.length
      : (f.avgWeekdayRatio || 0);
    wRatio += locRatio * weight;
    wWeekdayWaste += (f.avgWeekdayWastePerRoom || 0) * weight;
    wFridayExcess += (f.excessWastePerRoom || 0) * weight;
    totalDays += f.totalDays || 0;
    weekdayRoomsW += (f.avgWeekdayRooms || 0) * weight;
    fridayRoomsW += (f.avgFridayRooms || 0) * weight;
    fridaySample += f.fridaySampleSize || 0;
  }

  const div = roomDays || 1;
  const avgWeekdayRooms = weekdayRoomsW / div;
  const avgFridayRooms = fridayRoomsW / div;

  return {
    costPerRoom: totalRooms > 0 ? totalActualCost / totalRooms : null,
    careTeamRatio: wRatio / div,
    inefficiencyPct: wIneff / div,
    wastePerRoom: wWeekdayWaste / div,
    fridayExcessPerRoom: wFridayExcess / div,
    fridayRoomIndex: avgWeekdayRooms > 0 ? avgFridayRooms / avgWeekdayRooms : null,
    avgWeekdayRooms,
    avgFridayRooms,
    observationDays: totalDays,
    fridaySample,
  };
}

// ── Per-facility learned baseline ────────────────────────────────────────────────

/**
 * Refresh the facility's learned profile from a fresh analysis.
 *
 * The analysis always runs over the facility's FULL schedule history, so the
 * summarized metrics already ARE the properly day-weighted baseline across
 * everything observed — the profile mirrors them directly (SET, not blend).
 * Critically, observationCount is SET from the number of distinct staffed days
 * in the dataset: re-running analysis on unchanged data must never raise the
 * count, the confidence score, or flip the savings basis to "realized" (the
 * old accumulate-on-every-run behavior inflated all three). Only genuinely new
 * staffed days move confidence.
 *
 * @returns the updated profile, or null on failure (never throws).
 */
async function updateFacilityProfile(facilityId, facilityResults, score, dataSpanDays) {
  try {
    const metrics = summarizeResults(facilityResults);
    if (!metrics) return null;

    const existing = await prisma.facilityStaffingProfile.findUnique({ where: { facilityId } });
    const priorObs = existing?.observationCount || 0;
    const newObs = Math.max(1, Math.round(metrics.observationDays || 0));
    const hasNewData = !existing || newObs > priorObs;

    const roomsByDow = {
      weekday: round1(metrics.avgWeekdayRooms),
      friday: round1(metrics.avgFridayRooms),
    };

    const data = {
      avgRoomsByDow: roomsByDow,
      avgCareTeamRatio: round2(metrics.careTeamRatio),
      avgCostPerRoom: round0(metrics.costPerRoom),
      avgWeekdayWastePerRoom: round0(metrics.wastePerRoom),
      avgFridayWastePerRoom: round0(metrics.fridayExcessPerRoom),
      fridayRoomIndex: round2(metrics.fridayRoomIndex),
      observationCount: newObs,
      // Counts uploads that actually added staffed days, not analyze clicks.
      uploadsAnalyzed: (existing?.uploadsAnalyzed || 0) + (hasNewData ? 1 : 0),
      dataSpanDays: dataSpanDays != null ? dataSpanDays : existing?.dataSpanDays,
      lastScore: score != null ? Math.round(score) : existing?.lastScore,
    };

    return prisma.facilityStaffingProfile.upsert({
      where: { facilityId },
      create: { facilityId, ...data },
      update: data,
    });
  } catch (err) {
    console.error('updateFacilityProfile failed (non-fatal):', err.message);
    return null;
  }
}

async function getFacilityProfile(facilityId) {
  try {
    return await prisma.facilityStaffingProfile.findUnique({ where: { facilityId } });
  } catch (err) {
    console.error('getFacilityProfile failed:', err.message);
    return null;
  }
}

// ── Network benchmark ────────────────────────────────────────────────────────

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Ensure seed-prior benchmark rows exist (jump start). Never clobbers rows that
 * have already been replaced by computed network data.
 */
async function seedNetworkPriors() {
  try {
    for (const metric of BENCHMARK_METRICS) {
      const prior = SEED_PRIORS[metric];
      const existing = await prisma.staffIQBenchmark.findUnique({
        where: { metric_scope: { metric, scope: 'network' } },
      });
      if (existing && existing.source === 'computed') continue; // don't overwrite real data
      await prisma.staffIQBenchmark.upsert({
        where: { metric_scope: { metric, scope: 'network' } },
        create: { metric, scope: 'network', ...prior, sampleFacilities: 0, source: 'seed_prior' },
        update: { ...prior, source: 'seed_prior' },
      });
    }
    return true;
  } catch (err) {
    console.error('seedNetworkPriors failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * Recompute network benchmark percentiles across all facility profiles. Until
 * MIN_FACILITIES_FOR_COMPUTED facilities exist, seed priors are kept in place so
 * comparisons stay sensible with a thin network.
 */
async function updateNetworkBenchmark() {
  try {
    // Demo/test facilities must never shape the network benchmark — with a thin
    // network even one fake profile would poison the percentiles every real
    // facility is graded against.
    const profiles = await prisma.facilityStaffingProfile.findMany({
      where: { facility: { isDemo: false } },
    });

    const series = {
      costPerRoom: [],
      careTeamRatio: [],
      inefficiencyPct: [],
      wastePerRoom: [],
      fridayExcessPerRoom: [],
    };
    for (const p of profiles) {
      if (p.avgCostPerRoom != null) series.costPerRoom.push(p.avgCostPerRoom);
      if (p.avgCareTeamRatio != null) series.careTeamRatio.push(p.avgCareTeamRatio);
      if (p.avgWeekdayWastePerRoom != null) series.wastePerRoom.push(p.avgWeekdayWastePerRoom);
      if (p.avgFridayWastePerRoom != null) series.fridayExcessPerRoom.push(p.avgFridayWastePerRoom);
      // inefficiencyPct isn't stored directly on the profile; derive a proxy from
      // waste-per-room vs cost-per-room when both are present.
      if (p.avgWeekdayWastePerRoom != null && p.avgCostPerRoom) {
        series.inefficiencyPct.push((p.avgWeekdayWastePerRoom / p.avgCostPerRoom) * 100);
      }
    }

    const facilityCount = profiles.length;

    if (facilityCount < MIN_FACILITIES_FOR_COMPUTED) {
      // Thin network — make sure priors are present and stop.
      await seedNetworkPriors();
      return { computed: false, facilityCount };
    }

    for (const metric of BENCHMARK_METRICS) {
      const vals = series[metric].slice().sort((a, b) => a - b);
      if (!vals.length) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      await prisma.staffIQBenchmark.upsert({
        where: { metric_scope: { metric, scope: 'network' } },
        create: {
          metric, scope: 'network',
          p25: round2(quantile(vals, 0.25)),
          median: round2(quantile(vals, 0.5)),
          p75: round2(quantile(vals, 0.75)),
          mean: round2(mean),
          sampleFacilities: vals.length,
          source: 'computed',
        },
        update: {
          p25: round2(quantile(vals, 0.25)),
          median: round2(quantile(vals, 0.5)),
          p75: round2(quantile(vals, 0.75)),
          mean: round2(mean),
          sampleFacilities: vals.length,
          source: 'computed',
        },
      });
    }
    return { computed: true, facilityCount };
  } catch (err) {
    console.error('updateNetworkBenchmark failed (non-fatal):', err.message);
    return { computed: false, error: err.message };
  }
}

async function getNetworkBenchmark() {
  try {
    const rows = await prisma.staffIQBenchmark.findMany({ where: { scope: 'network' } });
    const out = {};
    for (const r of rows) {
      out[r.metric] = {
        p25: r.p25, median: r.median, p75: r.p75, mean: r.mean,
        sampleFacilities: r.sampleFacilities, source: r.source,
      };
    }
    return out;
  } catch (err) {
    console.error('getNetworkBenchmark failed:', err.message);
    return {};
  }
}

/**
 * Grade a facility's metrics against the network benchmark. For each metric where
 * lower-is-better (everything except careTeamRatio), returns a standing label and
 * a 0–100 percentile-ish position. Returns { standings, networkPercentile }.
 */
function gradeAgainstNetwork(metrics, benchmark) {
  const lowerIsBetter = {
    costPerRoom: true,
    inefficiencyPct: true,
    wastePerRoom: true,
    fridayExcessPerRoom: true,
    careTeamRatio: false, // higher leverage is generally better, to a point
  };

  const standings = {};
  const positions = [];

  for (const metric of BENCHMARK_METRICS) {
    const v = metrics[metric];
    const b = benchmark[metric];
    if (v == null || !b || b.median == null) continue;

    // Position 0..100 where 100 = best. Map value within [p25,p75] then invert if
    // lower-is-better.
    const span = (b.p75 - b.p25) || 1;
    let pos = ((v - b.p25) / span) * 50 + 25; // 25 at p25, 75 at p75
    pos = Math.max(0, Math.min(100, pos));
    if (lowerIsBetter[metric]) pos = 100 - pos;

    let label;
    if (pos >= 75) label = 'top quartile';
    else if (pos >= 50) label = 'above median';
    else if (pos >= 25) label = 'below median';
    else label = 'bottom quartile';

    standings[metric] = {
      value: round2(v),
      median: b.median,
      p25: b.p25,
      p75: b.p75,
      position: Math.round(pos),
      label,
      source: b.source,
    };
    positions.push(pos);
  }

  const networkPercentile = positions.length
    ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length)
    : null;

  return { standings, networkPercentile };
}

// ── Outcome feedback ───────────────────────────────────────────────────────────

async function recordOutcome(facilityId, outcomeType, { insightId, predictedDollar, realizedDollar, metadata } = {}) {
  try {
    return await prisma.staffIQOutcome.create({
      data: {
        facilityId,
        outcomeType,
        insightId: insightId || null,
        predictedDollar: predictedDollar != null ? predictedDollar : null,
        realizedDollar: realizedDollar != null ? realizedDollar : null,
        metadata: metadata || null,
      },
    });
  } catch (err) {
    console.error('recordOutcome failed (non-fatal):', err.message);
    return null;
  }
}

// ── Data-readiness assessment ("what makes StaffIQ smarter") ─────────────────────

/**
 * Translate the facility's current data footprint into a 0–100 confidence score
 * plus concrete, prioritized suggestions for what additional data would sharpen
 * the analysis. Drives the "feed me more data" prompt in the portal.
 */
function assessDataReadiness({ totalRecords, dataSpanDays, uploadsAnalyzed, observationCount, hasRates, hasCaseTypes }) {
  const checks = [];
  const span = dataSpanDays || 0;

  // Volume of weekday observations.
  const obs = observationCount || 0;
  checks.push({
    key: 'volume',
    met: obs >= 60,
    weight: 30,
    progress: Math.min(100, Math.round((obs / 60) * 100)),
    label: 'Schedule volume',
    detail: obs >= 60
      ? 'Strong sample of staffed days.'
      : `Add more schedules — ${obs}/60 staffed days analyzed. Each upload tightens the baseline.`,
  });

  // Calendar span — multiple months reveal seasonality and stable Friday patterns.
  checks.push({
    key: 'span',
    met: span >= 90,
    weight: 25,
    progress: Math.min(100, Math.round((span / 90) * 100)),
    label: 'Time span',
    detail: span >= 90
      ? 'Enough history to see weekly and seasonal patterns.'
      : `Upload more months of history (${span}/90 days). 3+ months unlocks reliable Friday and seasonal detection.`,
  });

  // Repeat uploads — the EMA needs more than one snapshot to learn.
  const ups = uploadsAnalyzed || 0;
  checks.push({
    key: 'recurrence',
    met: ups >= 3,
    weight: 15,
    progress: Math.min(100, Math.round((ups / 3) * 100)),
    label: 'Recurring uploads',
    detail: ups >= 3
      ? 'Baseline is learning across multiple uploads.'
      : `Upload each new month as it closes (${ups}/3). Recurring data is how the baseline keeps improving.`,
  });

  // Rates — without per-provider rates we fall back to defaults.
  checks.push({
    key: 'rates',
    met: !!hasRates,
    weight: 20,
    progress: hasRates ? 100 : 0,
    label: 'Provider rates',
    detail: hasRates
      ? 'Cost estimates use your actual rates.'
      : 'Add a rate/cost column so savings are computed on your real numbers, not defaults.',
  });

  // Case types / acuity — enables clinical-override accuracy.
  checks.push({
    key: 'acuity',
    met: !!hasCaseTypes,
    weight: 10,
    progress: hasCaseTypes ? 100 : 0,
    label: 'Case type / acuity',
    detail: hasCaseTypes
      ? 'Acuity context improves clinical-override detection.'
      : 'Include case type or acuity to distinguish intentional high-acuity coverage from true inefficiency.',
  });

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const confidence = Math.round(
    checks.reduce((s, c) => s + (c.progress / 100) * c.weight, 0) / totalWeight * 100
  );

  const suggestions = checks
    .filter((c) => !c.met)
    .sort((a, b) => b.weight - a.weight)
    .map((c) => ({ label: c.label, detail: c.detail, impact: c.weight }));

  return { confidence, checks, suggestions, totalRecords: totalRecords || 0 };
}

// ── Unified savings authority ("StaffIQ saves you $X/month") ─────────────────────
//
// ONE number, two levers, built ON the learning layer so it starts simple (priors
// + the facility's entered inputs) and gets smarter as real schedules/fills accrue
// (per-facility EMA baseline + actual bookings). Each lever independently uses its
// best available source and reports whether it's `projected` or `realized`, so the
// headline never artificially drops as data comes in — it just gets more accurate.
//
// This replaces the old split heuristics (flat 12% internal-efficiency + hardcoded
// agency replacement) as the single savings authority — no double-count, because
// lever 1 is staffing-MODEL efficiency (right-sizing the care team) and lever 2 is
// agency-RATE displacement; they measure different dollars.

// Agency rate priors (loaded $/hr a locum agency would charge). Used only when
// the facility hasn't entered its own agency bill rates in StaffIQ Inputs — the
// facility's real rates always win, and the UI labels prior-based figures
// "estimated" (decided with Matt 2026-07-07).
const AGENCY_RATE_PRIORS = { ANESTHESIOLOGIST: 425, CRNA: 300, ANESTHESIA_ASSISTANT: 250 };
const WEEKDAYS_PER_MONTH = 21.7;
const FRIDAYS_PER_MONTH = 4.34;
// Enough learned observation-days before we trust realized waste over the projection.
const MIN_OBS_FOR_REALIZED = 20;
// Realized savings window: trailing 30 days, NOT calendar month — "your savings
// over the last 30 days" moves smoothly as fills land and age out, with no
// artificial crash at month boundaries (decided with Matt 2026-07-07).
const REALIZED_WINDOW_DAYS = 30;
// Network median score: 100 − median facility waste (12%).
// "You're 88; network median is 88" is the benchmark context shown in the UI.
const NETWORK_MEDIAN_SCORE = 100 - SEED_PRIORS.inefficiencyPct.median; // 88

/**
 * Compute BOTH the projected and realized value of each savings lever.
 * Shared by projectFacilitySavings (which picks the best available basis per
 * lever for the hero number) and recordSavingsSnapshots (which stores both
 * sides so projected-vs-realized calibration can be measured over time).
 */
async function computeSavingsLevers(facilityId) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - REALIZED_WINDOW_DAYS * 86400000);

  const [profile, latestInput, recentBookings] = await Promise.all([
    prisma.facilityStaffingProfile.findUnique({ where: { facilityId } }),
    prisma.staffIQInput.findFirst({ where: { facilityId }, orderBy: { calculatedAt: 'desc' } }),
    prisma.shiftBooking.findMany({
      where: { shift: { facilityId }, confirmedAt: { gte: windowStart }, completedAt: { not: null } },
      include: { shift: { select: { specialty: true, durationHours: true, currentRate: true } } },
    }),
  ]);

  // Effective agency bill rates: facility-entered when present, priors otherwise.
  const agencyRates = {
    ANESTHESIOLOGIST: latestInput?.agencyAnesthesiologistRate || AGENCY_RATE_PRIORS.ANESTHESIOLOGIST,
    CRNA: latestInput?.agencyCrnaRate || AGENCY_RATE_PRIORS.CRNA,
    ANESTHESIA_ASSISTANT: latestInput?.agencyAaRate || AGENCY_RATE_PRIORS.ANESTHESIA_ASSISTANT,
  };
  // 'facility' once both primary rates are theirs (AA is rare enough that its
  // fallback doesn't demote the label); 'estimated' when nothing was entered.
  const agencyRateSource =
    latestInput?.agencyAnesthesiologistRate != null && latestInput?.agencyCrnaRate != null ? 'facility'
      : (latestInput?.agencyAnesthesiologistRate != null || latestInput?.agencyCrnaRate != null ? 'mixed'
        : 'estimated');

  const profileReady = !!profile
    && (profile.observationCount || 0) >= MIN_OBS_FOR_REALIZED
    && profile.avgWeekdayWastePerRoom != null;

  // ── Lever 1 — staffing-model efficiency ──────────────────────────────────
  // Realized: learned waste-per-room (vs the optimal care team) over a month of
  // room-days. avgWeekdayWastePerRoom applies across all weekdays; the Friday
  // figure is the EXTRA shortfall on Fridays (see staffiqScore.js).
  let lever1Realized = null;
  if (profileReady) {
    const rooms = profile.avgRoomsByDow || {};
    const weekdayRooms = Number(rooms.weekday) || 0;
    const fridayRooms = Number(rooms.friday) || weekdayRooms;
    lever1Realized = (profile.avgWeekdayWastePerRoom || 0) * weekdayRooms * WEEKDAYS_PER_MONTH
      + (profile.avgFridayWastePerRoom || 0) * fridayRooms * FRIDAYS_PER_MONTH;
  }
  // Projected: the team-model + overstaffing inefficiency the input form already
  // computed (annual) → monthly. Includes the labeled industry-typical floor.
  const lever1Projected = latestInput
    ? ((latestInput.inefficiency1Cost || 0) + (latestInput.inefficiency2Cost || 0)) / 12
    : null;

  // ── Lever 2 — agency displacement ────────────────────────────────────────
  // Realized: savings vs agency on shifts SNAP filled in the trailing window.
  let lever2Realized = null;
  if (recentBookings.length) {
    lever2Realized = recentBookings.reduce((sum, b) => {
      const agencyRate = agencyRates[b.shift.specialty] || agencyRates.CRNA;
      const providerRate = b.providerHourlyRate || b.shift.currentRate || 0;
      const hours = b.shiftDurationHours || b.shift.durationHours || 0;
      return sum + Math.max(0, (agencyRate - providerRate) * hours);
    }, 0);
  }
  // Projected: displace the facility's current agency shifts at SNAP rates.
  let lever2Projected = null;
  if (latestInput) {
    const hrs = latestInput.avgShiftHours || 10;
    const anesPrem = Math.max(0, (agencyRates.ANESTHESIOLOGIST - (latestInput.avgAnesthesiologistRate || 390)));
    const crnaPrem = Math.max(0, (agencyRates.CRNA - (latestInput.avgCrnaRate || 260)));
    lever2Projected = ((latestInput.agencyAnesthesiologistsPerMonth || 0) * anesPrem
      + (latestInput.agencyCrnasPerMonth || 0) * crnaPrem) * hrs;
  }

  return {
    profile,
    latestInput,
    profileReady,
    agencyRates,
    agencyRateSource,
    bookingsInWindow: recentBookings.length,
    lever1: { projected: lever1Projected, realized: lever1Realized },
    lever2: { projected: lever2Projected, realized: lever2Realized },
  };
}

async function projectFacilitySavings(facilityId) {
  try {
    const L = await computeSavingsLevers(facilityId);
    const { profile, latestInput, profileReady } = L;

    const lever1Basis = L.lever1.realized != null ? 'realized'
      : (L.lever1.projected != null ? 'projected' : 'none');
    const lever2Basis = L.lever2.realized != null ? 'realized'
      : (L.lever2.projected != null ? 'projected' : 'none');
    const lever1 = lever1Basis === 'realized' ? L.lever1.realized : (L.lever1.projected || 0);
    const lever2 = lever2Basis === 'realized' ? L.lever2.realized : (L.lever2.projected || 0);

    const anyRealized = lever1Basis === 'realized' || lever2Basis === 'realized';
    const anyProjected = lever1Basis === 'projected' || lever2Basis === 'projected';
    const basis = anyRealized ? 'realized' : (anyProjected ? 'projected' : 'insufficient');

    if (basis === 'insufficient') {
      return { monthly: null, annual: null, basis, confidence: 0, components: [], savingsVersion: 'learned_v2' };
    }

    const monthly = Math.round(lever1 + lever2);
    const confidence = profile
      ? Math.min(100, Math.round(((profile.observationCount || 0) / 60) * 100))
      : (latestInput ? 35 : 0);

    // ── Efficiency score (0–100) — score = 100 − wasteRatioPct, no multipliers
    // wasteRatioPct = lever-1 waste ÷ total staffing spend × 100 (size-invariant).
    // Score gap IS the waste percentage: score 92 = 8% waste = 8% of spend = lever-1 $/mo.
    // Agency displacement (lever 2) is excluded — it's a sourcing win, not an efficiency grade.
    // Realized path: actual waste from uploaded schedule data.
    // Projected path: team-model + overstaffing inefficiency from the StaffIQ Inputs form.
    let score = null;
    let scoreBasis = 'insufficient';
    if (lever1Basis !== 'none') {
      let wasteRatioPct = null;
      if (profileReady && profile.avgCostPerRoom > 0) {
        wasteRatioPct = (profile.avgWeekdayWastePerRoom / profile.avgCostPerRoom) * 100;
        scoreBasis = 'realized';
      } else if (latestInput) {
        const sc = calculateStaffIQScore(latestInput);
        wasteRatioPct = (sc.inefficiency1Pct || 0) + (sc.inefficiency2Pct || 0);
        scoreBasis = 'projected';
      }
      if (wasteRatioPct != null) {
        score = Math.max(0, Math.min(100, Math.round(100 - wasteRatioPct)));
      }
    }

    return {
      monthly,
      annual: monthly * 12,
      basis,                       // 'projected' until enough of the facility's own data is in
      score,                       // 0-100; gap from 100 = waste% = lever-1 $/spend
      scoreBasis,                  // 'projected' | 'realized' | 'insufficient'
      networkMedianScore: NETWORK_MEDIAN_SCORE, // 88 — benchmark context for "you're X, median is 88"
      confidence,
      savingsVersion: 'learned_v2',
      realizedWindowDays: REALIZED_WINDOW_DAYS, // realized = trailing window, not calendar month
      components: [
        { key: 'staffing_efficiency', label: 'Staffing-model efficiency', monthly: Math.round(lever1), basis: lever1Basis },
        { key: 'agency_displacement', label: 'Agency displacement', monthly: Math.round(lever2), basis: lever2Basis },
      ],
      // Drill-down honesty: every assumption behind the number, so the UI can
      // label what's estimated vs entered vs measured.
      assumptions: {
        agencyRates: L.agencyRates,
        agencyRateSource: L.agencyRateSource, // 'facility' | 'mixed' | 'estimated'
        efficiencyFloorApplied: lever1Basis === 'projected' && !!latestInput
          ? !!(calculateStaffIQScore(latestInput).floorApplied)
          : false,
      },
    };
  } catch (err) {
    console.error('projectFacilitySavings failed (non-fatal):', err.message);
    return { monthly: null, annual: null, basis: 'insufficient', confidence: 0, components: [], savingsVersion: 'learned_v2' };
  }
}

/**
 * Project the hero number from raw prospect inputs — no facility record, no
 * persistence. This is the FIRST-SALES-MEETING quote: it runs exactly the same
 * math as the facility dashboard's projected path (calculateStaffIQScore for
 * lever 1, agency premium displacement for lever 2), so the number a prospect
 * hears in the pitch is the number they see in the portal on day one.
 * Insufficient inputs return an explicit 'insufficient' basis — never a
 * fabricated number.
 */
function projectFromInputs(raw = {}) {
  const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
  const rooms = num(raw.totalLocations);
  if (!rooms || rooms <= 0) {
    return { monthly: null, annual: null, basis: 'insufficient', components: [], savingsVersion: 'learned_v2' };
  }

  const inputs = {
    totalLocations: rooms,
    avgRoomsPerDay: num(raw.avgRoomsPerDay) ?? Math.round(rooms * 0.75),
    avgAnesthesiologistRate: num(raw.avgAnesthesiologistRate) ?? 390,
    avgCrnaRate: num(raw.avgCrnaRate) ?? 260,
    avgShiftHours: num(raw.avgShiftHours) ?? 10,
    operatingDaysPerYear: num(raw.operatingDaysPerYear) ?? 250,
    primaryTeamModel: raw.primaryTeamModel || 'mixed',
  };

  // Lever 1 — staffing-model efficiency (same engine as StaffIQ Inputs).
  const sc = calculateStaffIQScore(inputs);
  const lever1 = ((sc.inefficiency1Cost || 0) + (sc.inefficiency2Cost || 0)) / 12;

  // Lever 2 — agency displacement, at their agency rates when given.
  const enteredAnes = num(raw.agencyAnesthesiologistRate);
  const enteredCrna = num(raw.agencyCrnaRate);
  const agencyRates = {
    ANESTHESIOLOGIST: enteredAnes || AGENCY_RATE_PRIORS.ANESTHESIOLOGIST,
    CRNA: enteredCrna || AGENCY_RATE_PRIORS.CRNA,
    ANESTHESIA_ASSISTANT: num(raw.agencyAaRate) || AGENCY_RATE_PRIORS.ANESTHESIA_ASSISTANT,
  };
  const agencyRateSource = enteredAnes != null && enteredCrna != null ? 'facility'
    : (enteredAnes != null || enteredCrna != null ? 'mixed' : 'estimated');
  const anesPrem = Math.max(0, agencyRates.ANESTHESIOLOGIST - inputs.avgAnesthesiologistRate);
  const crnaPrem = Math.max(0, agencyRates.CRNA - inputs.avgCrnaRate);
  const lever2 = ((num(raw.agencyAnesthesiologistsPerMonth) || 0) * anesPrem
    + (num(raw.agencyCrnasPerMonth) || 0) * crnaPrem) * inputs.avgShiftHours;

  const monthly = Math.round(lever1 + lever2);
  return {
    monthly,
    annual: monthly * 12,
    basis: 'projected',
    score: sc.score,
    scoreBasis: 'projected',
    networkMedianScore: NETWORK_MEDIAN_SCORE,
    wasteRatioPct: Math.round(((sc.inefficiency1Pct || 0) + (sc.inefficiency2Pct || 0)) * 10) / 10,
    totalBudget: sc.totalBudget, // annual staffing spend the waste% applies to
    confidence: 35, // projection-only confidence, same as the dashboard's input-only state
    savingsVersion: 'learned_v2',
    inputs, // echo the resolved inputs so the pitch can show what was assumed
    components: [
      { key: 'staffing_efficiency', label: 'Staffing-model efficiency', monthly: Math.round(lever1), basis: 'projected' },
      { key: 'agency_displacement', label: 'Agency displacement', monthly: Math.round(lever2), basis: 'projected' },
    ],
    assumptions: {
      agencyRates,
      agencyRateSource,
      efficiencyFloorApplied: !!sc.floorApplied,
    },
  };
}

// ── Projected-vs-realized calibration (MEASURE ONLY — decided 2026-07-07) ──────
//
// Snapshots store what StaffIQ projected next to what it measured, per facility,
// so accuracy can be tracked and shown (admin panel, eventually the facility
// drill-down convergence chart). DELIBERATELY NOT USED to auto-adjust the
// customer-facing projection yet — the turn-on task (3+ matched cycles, ±25%
// cap, Matt's sign-off) is tracked in Notion: "Turn ON StaffIQ auto-calibration".

/**
 * Record one projected-vs-realized snapshot per (non-demo) facility.
 * Run monthly by cron; safe to call ad hoc — each call appends a new snapshot.
 */
async function recordSavingsSnapshots() {
  try {
    const facilities = await prisma.facility.findMany({
      where: { isDemo: false },
      select: { id: true },
    });

    let recorded = 0;
    for (const f of facilities) {
      try {
        const L = await computeSavingsLevers(f.id);
        const projected = (L.lever1.projected != null || L.lever2.projected != null)
          ? Math.round((L.lever1.projected || 0) + (L.lever2.projected || 0))
          : null;
        const realized = (L.lever1.realized != null || L.lever2.realized != null)
          ? Math.round((L.lever1.realized || 0) + (L.lever2.realized || 0))
          : null;
        if (projected == null && realized == null) continue; // nothing to measure yet

        await prisma.staffIQOutcome.create({
          data: {
            facilityId: f.id,
            outcomeType: 'SAVINGS_SNAPSHOT',
            predictedDollar: projected,
            realizedDollar: realized,
            metadata: {
              lever1: { projected: round0(L.lever1.projected), realized: round0(L.lever1.realized) },
              lever2: { projected: round0(L.lever2.projected), realized: round0(L.lever2.realized) },
              agencyRateSource: L.agencyRateSource,
              observationCount: L.profile?.observationCount || 0,
              bookingsInWindow: L.bookingsInWindow,
              realizedWindowDays: REALIZED_WINDOW_DAYS,
              savingsVersion: 'learned_v2',
            },
          },
        });
        recorded++;
      } catch (inner) {
        console.error(`recordSavingsSnapshots: facility ${f.id} failed (non-fatal):`, inner.message);
      }
    }
    return { recorded, facilities: facilities.length };
  } catch (err) {
    console.error('recordSavingsSnapshots failed (non-fatal):', err.message);
    return { recorded: 0, error: err.message };
  }
}

/**
 * Summarize calibration history for the admin panel: per facility, the snapshot
 * series plus how many cycles have BOTH sides and the average realized/projected
 * ratio across them (the number that will eventually drive auto-calibration).
 */
async function getSavingsCalibration() {
  try {
    const snaps = await prisma.staffIQOutcome.findMany({
      where: { outcomeType: 'SAVINGS_SNAPSHOT' },
      orderBy: { createdAt: 'asc' },
      include: { facility: { select: { id: true, name: true, isDemo: true } } },
    });

    const byFacility = new Map();
    for (const s of snaps) {
      if (!byFacility.has(s.facilityId)) {
        byFacility.set(s.facilityId, { facilityId: s.facilityId, facilityName: s.facility?.name || s.facilityId, snapshots: [] });
      }
      byFacility.get(s.facilityId).snapshots.push({
        at: s.createdAt,
        projected: s.predictedDollar,
        realized: s.realizedDollar,
        detail: s.metadata || null,
      });
    }

    const rows = [];
    for (const row of byFacility.values()) {
      const matched = row.snapshots.filter((s) => s.projected != null && s.realized != null && s.projected > 0);
      const avgRatio = matched.length
        ? matched.reduce((sum, s) => sum + s.realized / s.projected, 0) / matched.length
        : null;
      rows.push({
        ...row,
        matchedCycles: matched.length,
        avgRealizedToProjected: avgRatio != null ? Math.round(avgRatio * 100) / 100 : null,
        readyForCalibration: matched.length >= 3, // the agreed turn-on threshold
      });
    }
    return { facilities: rows, autoCalibration: 'off' };
  } catch (err) {
    console.error('getSavingsCalibration failed:', err.message);
    return { facilities: [], autoCalibration: 'off', error: err.message };
  }
}

// ── small rounding helpers ───────────────────────────────────────────────────

function round0(n) { return n == null ? null : Math.round(n); }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

module.exports = {
  BENCHMARK_METRICS,
  SEED_PRIORS,
  summarizeResults,
  updateFacilityProfile,
  getFacilityProfile,
  seedNetworkPriors,
  updateNetworkBenchmark,
  getNetworkBenchmark,
  gradeAgainstNetwork,
  recordOutcome,
  assessDataReadiness,
  projectFacilitySavings,
  projectFromInputs,
  computeSavingsLevers,
  recordSavingsSnapshots,
  getSavingsCalibration,
};
