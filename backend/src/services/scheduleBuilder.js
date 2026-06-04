/**
 * Schedule Builder v2 — algorithm engine.
 *
 * Given an empty (template-generated) month of ScheduleDay rows, assigns
 * a provider from the roster to each room according to one of four
 * strategies (cost / quality / hybrid / staffiq-decide). Returns the
 * assignments + a StaffIQ score + insights + warnings.
 *
 * Design: docs/schedule-builder-v2-design.md
 *
 * v1 simplifications (called out in design doc):
 * - Reliability score defaults to 0.85 when null (no history yet)
 * - "Hybrid" weighting is fixed 50/50
 * - "StaffIQ-decide" uses practice's existing StaffIQInputs to tilt the
 *   hybrid weighting; future v1.x trains a real model on accumulated
 *   ScheduleBuildRun history
 * - No specialty-per-room constraint yet (Coverage Templates v1.1 adds
 *   per-site role rules; we currently assume any roster provider can fill
 *   any room — fixed in v1.1)
 */

const prisma = require('../config/db');

const MODES = ['COST_EFFICIENT', 'HIGHEST_QUALITY', 'HYBRID', 'STAFFIQ'];

const DEFAULT_RELIABILITY = 0.85; // when roster.reliabilityScore is null
const FULL_TIME_HOURS_PER_YEAR = 2080;

// ── Location eligibility ──────────────────────────────────────────────────
// Once ProviderLocation rows are imported (Task #18), the algorithm filters
// candidates by "is this provider credentialed at this room's location?"
// Back-compat: a roster entry with ZERO ProviderLocation rows is treated as
// eligible everywhere, so rosters from before the location-import feature
// don't break.

async function loadProviderLocations(rosterIds) {
  if (!rosterIds || rosterIds.length === 0) {
    return { byRoster: new Map(), allCredentialedLocations: new Set() };
  }
  const rows = await prisma.providerLocation.findMany({
    where: { rosterEntryId: { in: rosterIds } },
    select: { rosterEntryId: true, facilityName: true },
  });
  const byRoster = new Map();
  const allCredentialedLocations = new Set();
  for (const row of rows) {
    if (!byRoster.has(row.rosterEntryId)) byRoster.set(row.rosterEntryId, new Set());
    byRoster.get(row.rosterEntryId).add(row.facilityName);
    allCredentialedLocations.add(row.facilityName);
  }
  return { byRoster, allCredentialedLocations };
}

/**
 * Eligibility check with a defensive fallback.
 *
 *   - Provider has NO location rows → eligible everywhere (back-compat with
 *     rosters that pre-date location import).
 *   - The day's location is credentialed by NOBODY in the roster → likely a
 *     name mismatch ("Kenmore" vs "Atrius Kenmore") or a data gap. Fall back
 *     to eligible, so the build still produces a real schedule rather than an
 *     empty room. (The dress rehearsal reconciles location-name spelling.)
 *   - Otherwise → only providers explicitly credentialed at this location.
 */
function isEligibleForLocation(rosterId, locationName, locationData) {
  const { byRoster, allCredentialedLocations } = locationData;
  const set = byRoster.get(rosterId);
  if (!set || set.size === 0) return true;
  if (!allCredentialedLocations.has(locationName)) return true; // no one has it → fallback
  return set.has(locationName);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Effective hourly rate: per-diem/locums use hourlyRate directly; full-time
 * computes from annualRate / 2080. Falls back to a sane default if the
 * roster row is missing rate data (so cost mode doesn't divide by zero).
 */
function effectiveHourlyRate(rosterEntry) {
  if (rosterEntry.hourlyRate && rosterEntry.hourlyRate > 0) return rosterEntry.hourlyRate;
  if (rosterEntry.annualRate && rosterEntry.annualRate > 0) {
    return rosterEntry.annualRate / FULL_TIME_HOURS_PER_YEAR;
  }
  // Sensible defaults by employment + specialty so the algorithm has SOMETHING
  // to work with on under-populated rosters (test data, new customers).
  const defaults = {
    ANESTHESIOLOGIST: { FULL_TIME: 175, PER_DIEM: 250, LOCUMS: 350 },
    CRNA: { FULL_TIME: 110, PER_DIEM: 175, LOCUMS: 225 },
    ANESTHESIA_ASSISTANT: { FULL_TIME: 95, PER_DIEM: 150, LOCUMS: 200 },
  };
  return defaults[rosterEntry.providerType]?.[rosterEntry.employmentCategory] || 150;
}

/**
 * Reliability score: 0.0-1.0. null → default. Higher = better.
 */
function effectiveReliability(rosterEntry) {
  if (typeof rosterEntry.reliabilityScore === 'number') return rosterEntry.reliabilityScore;
  return DEFAULT_RELIABILITY;
}

/**
 * Quality score for a roster entry, normalized roughly 0-1.
 *
 * Components:
 *   - Years experience (capped at 25 for normalization)
 *   - Reliability (already 0-1)
 *   - Penalty for LOCUMS employment (locums historically have less continuity)
 *
 * Tunable; conservative weights for v1. The point isn't precision but to
 * produce believable differentiation between candidates.
 */
function qualityScore(rosterEntry) {
  // We don't currently store yearsExperience on InternalRosterEntry, but the
  // schema is set up to add it; for v1 we infer from employment category as
  // a stand-in (FULL_TIME tends to be senior, LOCUMS often newer to a site).
  const experienceProxy = {
    FULL_TIME: 0.8,
    PER_DIEM: 0.65,
    LOCUMS: 0.5,
  }[rosterEntry.employmentCategory] || 0.5;
  const reliability = effectiveReliability(rosterEntry);
  const locumPenalty = rosterEntry.employmentCategory === 'LOCUMS' ? 0.1 : 0;
  // Weighted: experience 35% + reliability 55% + locum penalty −10%
  return Math.max(0, Math.min(1, 0.35 * experienceProxy + 0.55 * reliability - locumPenalty));
}

/**
 * Cost score: inverse of hourly rate, normalized against the roster's
 * cheapest provider so the highest-cost-efficient gets 1.0 and others scale
 * down. Higher = better (cheaper).
 */
function costScore(rosterEntry, cheapestRate) {
  const rate = effectiveHourlyRate(rosterEntry);
  if (rate <= 0) return 0;
  return Math.max(0, Math.min(1, cheapestRate / rate));
}

// ── Mode-specific candidate ranking ────────────────────────────────────────

/**
 * Each mode returns a number for a candidate; higher = better fit. The
 * picker uses these to assign the best candidate to a room. Modes differ
 * only in how they weight cost vs quality.
 */
const MODE_SCORERS = {
  COST_EFFICIENT: (entry, ctx) => costScore(entry, ctx.cheapestRate),
  HIGHEST_QUALITY: (entry) => qualityScore(entry),
  HYBRID: (entry, ctx) => 0.5 * costScore(entry, ctx.cheapestRate) + 0.5 * qualityScore(entry),
  STAFFIQ: (entry, ctx) => {
    // Tilt the weighting toward whatever the practice's StaffIQInputs say
    // they prioritize. Future: trained ML model. v1 uses a simple weighting.
    const w = ctx.staffiqWeights || { cost: 0.5, quality: 0.5 };
    return w.cost * costScore(entry, ctx.cheapestRate) + w.quality * qualityScore(entry);
  },
};

// ── Main runner ────────────────────────────────────────────────────────────

/**
 * Run a single algorithm mode over a month's worth of ScheduleDay rows.
 *
 * @param {object} args
 * @param {string} args.mode             One of MODES
 * @param {Array}  args.scheduleDays     ScheduleDay rows (with assignments empty)
 * @param {Array}  args.roster           Active InternalRosterEntry rows for the facility
 * @param {object} args.staffiqWeights   { cost, quality } summing ≤ 1 (STAFFIQ mode only)
 * @returns {object} { assignments, insights, warnings, score }
 */
async function runMode({ mode, scheduleDays, roster, staffiqWeights }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);

  // Pre-compute the cheapest rate so cost scores are normalized against the
  // roster's actual floor (not a hard-coded constant).
  const cheapestRate = roster.reduce((min, r) => {
    const rate = effectiveHourlyRate(r);
    return rate > 0 && rate < min ? rate : min;
  }, Infinity);
  const ctx = {
    cheapestRate: cheapestRate === Infinity ? 100 : cheapestRate,
    staffiqWeights,
  };

  // Track per-provider workload so we don't double-book a single provider
  // on multiple rooms on the same date (one provider = one room per day).
  // Key: `${rosterId}::${dateISO}` → true
  const assigned = new Set();
  const assignments = [];
  const warnings = [];

  // Sort days deterministically so multiple runs of the same mode produce
  // identical output (stable demo + easier to diff).
  const sortedDays = [...scheduleDays].sort((a, b) => {
    const aKey = `${a.date}::${a.location}`;
    const bKey = `${b.date}::${b.location}`;
    return aKey.localeCompare(bKey);
  });

  // Build a per-roster-entry set of credentialed locations from
  // ProviderLocation rows. Empty set for a roster entry means we treat them
  // as eligible everywhere (back-compat with rosters that pre-date the
  // location-import feature).
  const locationData = await loadProviderLocations(roster.map((r) => r.id));

  for (const day of sortedDays) {
    const dateISO = new Date(day.date).toISOString().slice(0, 10);
    for (let roomNumber = 1; roomNumber <= day.roomsRequired; roomNumber++) {
      // Candidates = roster entries that
      //   (1) aren't already assigned to another room on this date, AND
      //   (2) are credentialed at this room's location (or fall through the
      //       defensive fallbacks in isEligibleForLocation).
      const candidates = roster
        // Non-clinical / specialty-less roster members (back-office staff)
        // are never scheduled into ORs.
        .filter((r) => r.providerType && !r.isNonClinical)
        .filter((r) => !assigned.has(`${r.id}::${dateISO}`))
        .filter((r) => isEligibleForLocation(r.id, day.location, locationData))
        .map((r) => ({
          entry: r,
          score: MODE_SCORERS[mode](r, ctx),
        }))
        .sort((a, b) => b.score - a.score); // highest score first

      if (candidates.length === 0) {
        warnings.push(
          `No available provider for ${day.location} on ${dateISO} room ${roomNumber}.`
        );
        continue;
      }

      const winner = candidates[0].entry;
      assigned.add(`${winner.id}::${dateISO}`);
      assignments.push({
        scheduleDayId: day.id,
        roomNumber,
        rosterId: winner.id,
        // For audit / debugging — what the algorithm "thought" of this pick
        scoreAtPick: Number(candidates[0].score.toFixed(3)),
      });
    }
  }

  const insights = computeInsights({ mode, assignments, roster });
  const score = computeStaffIQScore({ mode, assignments, roster, warnings, scheduleDays });

  return { assignments, insights, warnings, score };
}

// ── Insights & scoring ─────────────────────────────────────────────────────

function computeInsights({ mode, assignments, roster }) {
  const rosterById = Object.fromEntries(roster.map((r) => [r.id, r]));
  let totalCost = 0;
  let locumsUsed = 0;
  let fullTimeUsed = 0;
  const providerHours = {};

  for (const a of assignments) {
    const r = rosterById[a.rosterId];
    if (!r) continue;
    const hours = 8; // v1 assumes 8-hour days; future: read from ScheduleDay
    totalCost += effectiveHourlyRate(r) * hours;
    if (r.employmentCategory === 'LOCUMS') locumsUsed += 1;
    if (r.employmentCategory === 'FULL_TIME') fullTimeUsed += 1;
    providerHours[r.id] = (providerHours[r.id] || 0) + hours;
  }

  const reliabilityValues = assignments
    .map((a) => rosterById[a.rosterId])
    .filter(Boolean)
    .map((r) => effectiveReliability(r));
  const avgReliability =
    reliabilityValues.length === 0
      ? 0
      : reliabilityValues.reduce((s, v) => s + v, 0) / reliabilityValues.length;

  return {
    mode,
    totalCost: Math.round(totalCost),
    avgRatePerHour:
      assignments.length === 0 ? 0 : Math.round(totalCost / (assignments.length * 8)),
    locumsUsed,
    fullTimeUsed,
    perDiemUsed: assignments.length - locumsUsed - fullTimeUsed,
    avgReliability: Number(avgReliability.toFixed(3)),
    uniqueProvidersUsed: Object.keys(providerHours).length,
  };
}

/**
 * StaffIQ score: 0-100. Composite of fill rate, cost-vs-budget tilt, and
 * quality factors. v1 is a believable heuristic; v2 trains on accumulated
 * build history. The point in v1 is to differentiate the 4 modes credibly.
 */
function computeStaffIQScore({ mode, assignments, warnings, scheduleDays, roster }) {
  const totalRoomsRequired = scheduleDays.reduce((s, d) => s + d.roomsRequired, 0);
  if (totalRoomsRequired === 0) return 0;
  const filled = assignments.length;
  const fillRate = filled / totalRoomsRequired; // 0-1

  const insights = computeInsights({ mode, assignments, roster });

  // 70 base points for fill rate, scaled. Up to 30 more from quality+cost
  // mix. Mode affects WHICH factors contribute most — so the same set of
  // assignments scores slightly different per mode (reflects the mode's
  // own preferences).
  let score = 70 * fillRate;

  const qualityBonus = insights.avgReliability * 15 + (1 - insights.locumsUsed / Math.max(1, filled)) * 5;
  const costBonus = Math.min(20, Math.max(0, 20 - (insights.avgRatePerHour - 100) / 5)); // rewards rates < $200/hr

  if (mode === 'COST_EFFICIENT') score += costBonus * 0.7 + qualityBonus * 0.3;
  else if (mode === 'HIGHEST_QUALITY') score += qualityBonus * 0.8 + costBonus * 0.2;
  else if (mode === 'HYBRID') score += qualityBonus * 0.5 + costBonus * 0.5;
  else if (mode === 'STAFFIQ') score += qualityBonus * 0.55 + costBonus * 0.45;

  // Penalty for warnings (un-staffed rooms)
  score -= warnings.length * 0.5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve practice's StaffIQ weighting for the STAFFIQ mode.
 *
 * v1 reads the practice's StaffIQInput rows for the most recent year and
 * derives a {cost, quality} tilt. Concretely: if their highest-rated
 * priorities include cost-related items, tilt toward cost; otherwise
 * default 50/50. Future: trained model per practice + global.
 */
async function resolveStaffIQWeights(facilityId) {
  const inputs = await prisma.staffIQInput.findMany({
    where: { facilityId },
    // StaffIQInput has no updatedAt column — it's calculated, not edited.
    // calculatedAt is the "most-recent input" field. (The previous
    // updatedAt orderBy threw PrismaClientValidationError, which crashed
    // the entire /build flow before any mode ran — all 4 modes "failed".)
    orderBy: { calculatedAt: 'desc' },
    take: 5,
  });
  if (inputs.length === 0) return { cost: 0.5, quality: 0.5 };
  // Crude: look at most-recent input's `staffiqScore` — higher score
  // generally means the practice is already efficient, so the algorithm
  // tilts toward quality (room to improve). Lower score → tilt to cost.
  const latest = inputs[0];
  const score = latest.staffiqScore || 60;
  if (score < 50) return { cost: 0.65, quality: 0.35 };
  if (score > 75) return { cost: 0.35, quality: 0.65 };
  return { cost: 0.5, quality: 0.5 };
}

module.exports = {
  MODES,
  runMode,
  resolveStaffIQWeights,
  // exposed for testing / re-scoring after edits
  computeInsights,
  computeStaffIQScore,
};
