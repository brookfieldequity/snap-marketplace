'use strict';

/**
 * StaffIQ learning layer.
 *
 * This is the piece that makes StaffIQ "get smarter" with data and becomes the
 * defensible moat:
 *
 *   1. Per-facility learned baselines (FacilityStaffingProfile) — each facility's
 *      own normal patterns, blended as an exponential moving average so the
 *      baseline stabilizes and gains confidence as more schedule data arrives.
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

// ── Per-facility learned baseline (EMA) ─────────────────────────────────────────

function ema(prev, observed, alpha) {
  if (prev == null || Number.isNaN(prev)) return observed;
  if (observed == null || Number.isNaN(observed)) return prev;
  return alpha * observed + (1 - alpha) * prev;
}

/**
 * Fold a fresh analysis into the facility's learned profile.
 *
 * The blend weight (alpha) is proportional to how much new data this run adds
 * relative to everything seen before — so the very first upload essentially sets
 * the baseline, and each subsequent upload nudges it less, letting the baseline
 * converge and grow more confident as the facility feeds more schedules.
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
    // alpha capped at 0.6 so a single large upload can't fully overwrite history.
    const alpha = existing ? Math.min(0.6, newObs / (newObs + priorObs)) : 1;

    const roomsByDow = {
      weekday: round1(metrics.avgWeekdayRooms),
      friday: round1(metrics.avgFridayRooms),
    };

    const data = {
      avgRoomsByDow: roomsByDow,
      avgCareTeamRatio: round2(ema(existing?.avgCareTeamRatio, metrics.careTeamRatio, alpha)),
      avgCostPerRoom: round0(ema(existing?.avgCostPerRoom, metrics.costPerRoom, alpha)),
      avgWeekdayWastePerRoom: round0(ema(existing?.avgWeekdayWastePerRoom, metrics.wastePerRoom, alpha)),
      avgFridayWastePerRoom: round0(ema(existing?.avgFridayWastePerRoom, metrics.fridayExcessPerRoom, alpha)),
      fridayRoomIndex: round2(ema(existing?.fridayRoomIndex, metrics.fridayRoomIndex, alpha)),
      observationCount: priorObs + newObs,
      uploadsAnalyzed: (existing?.uploadsAnalyzed || 0) + 1,
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
    const profiles = await prisma.facilityStaffingProfile.findMany();

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
};
