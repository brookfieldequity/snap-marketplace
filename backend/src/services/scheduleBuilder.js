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
 *
 * Care-team model (Task #21 Phase B): each ScheduleDay carries a coverage
 * model via supervisionRatio — null = legacy role-agnostic, 0 = MD-only,
 * 3/4 = team (CRNAs in rooms supervised by anesthesiologists at 1:ratio).
 * Supervising MDs are stored as assignments in a reserved room-number range
 * (SUPERVISOR_ROOM_BASE+) with role SUPERVISING_MD.
 */

const prisma = require('../config/db');

const MODES = ['COST_EFFICIENT', 'HIGHEST_QUALITY', 'HYBRID', 'STAFFIQ'];

const DEFAULT_RELIABILITY = 0.85; // when roster.reliabilityScore is null
const FULL_TIME_HOURS_PER_YEAR = 2080;
// Assumed hours per staffed room per day. Used for every cost figure so the
// builder, re-score, and the month "Est. Cost" summary all agree. v1 constant;
// future: read per-day shift length from ScheduleDay.
const SHIFT_HOURS_PER_DAY = 8;
// How strongly a provider's site shift-share preference influences candidate
// ranking, on top of the mode's cost/quality score (both ~0-1). Strong enough
// to steer people toward their home sites, not so strong it ignores cost.
const SITE_SHARE_WEIGHT = 0.6;
// Task #21: an admin-ACCEPTED "request to work" is a strong preference — bias
// the provider into the schedule that day well above cost/quality/site-share,
// but still below the hard constraints (off-keys, eligibility, role) which are
// filters, not scores. Site match on the request gets the full weight; a
// day-only request (no site) still gets most of it.
const WORK_REQUEST_WEIGHT = 3.0;

// Supervising-MD assignments use room numbers in a reserved high range so
// they never collide with real OR rooms (which are 1..roomsRequired, always
// well below this). The role tag (SUPERVISING_MD) is the source of truth;
// this just keeps the (scheduleDayId, roomNumber) unique constraint happy.
const SUPERVISOR_ROOM_BASE = 900;

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
    select: { rosterEntryId: true, facilityName: true, shiftSharePct: true },
  });
  const byRoster = new Map();
  const allCredentialedLocations = new Set();
  // rosterId → Map<location, targetSharePct> for providers with a share set.
  const shareByRoster = new Map();
  for (const row of rows) {
    if (!byRoster.has(row.rosterEntryId)) byRoster.set(row.rosterEntryId, new Set());
    byRoster.get(row.rosterEntryId).add(row.facilityName);
    allCredentialedLocations.add(row.facilityName);
    if (row.shiftSharePct != null) {
      if (!shareByRoster.has(row.rosterEntryId)) shareByRoster.set(row.rosterEntryId, new Map());
      shareByRoster.get(row.rosterEntryId).set(row.facilityName, row.shiftSharePct);
    }
  }
  return { byRoster, allCredentialedLocations, shareByRoster };
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
async function runMode({ mode, scheduleDays, roster, staffiqWeights, unavailableKeys, workRequestKeys }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  // Set of `${rosterId}::${YYYY-MM-DD}` for providers who are off (PTO /
  // explicitly unavailable). Hard-excluded from assignment — never scheduled.
  const offKeys = unavailableKeys instanceof Set ? unavailableKeys : new Set();
  // Task #21: accepted "request to work" preferences. Map of
  // `${rosterId}::${YYYY-MM-DD}` → requested siteName (or null = any site).
  // A provider with an accepted WORK request for the day gets a strong score
  // bonus toward being placed (full weight when the request's site matches).
  const workReqMap = workRequestKeys instanceof Map ? workRequestKeys : new Map();
  const workRequestBonus = (rosterId, dateISO, location) => {
    if (!workReqMap.has(`${rosterId}::${dateISO}`)) return 0;
    const wantSite = workReqMap.get(`${rosterId}::${dateISO}`);
    // Full weight when no specific site was requested or it matches this
    // location; a partial bonus when they asked for a different site (still
    // want to work that day, just preferred elsewhere).
    if (!wantSite || wantSite === location) return WORK_REQUEST_WEIGHT;
    return WORK_REQUEST_WEIGHT * 0.4;
  };

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
  // CRNA-gap signal for the StaffIQ optimizer (Task #26): one entry per
  // team-location-day where rooms had to be backfilled with solo MDs.
  const crnaGaps = [];

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
  const { shareByRoster } = locationData;

  // Running per-provider site distribution, so StaffIQ steers each provider
  // toward their target shift-share mix. The bonus is the provider's remaining
  // "deficit" at this site (target share − share assigned so far): it starts at
  // the target (favoring home sites) and shrinks to 0 as they fill their share,
  // which also prevents over-concentrating anyone at one site.
  const locCount = new Map(); // `${rosterId}::${location}` → count
  const totCount = new Map(); // rosterId → total shifts assigned this run
  const siteShareBonus = (rosterId, location) => {
    const shares = shareByRoster.get(rosterId);
    if (!shares) return 0;
    const pct = shares.get(location);
    if (pct == null) return 0;
    const target = pct / 100;
    const tot = totCount.get(rosterId) || 0;
    const loc = locCount.get(`${rosterId}::${location}`) || 0;
    const actual = tot > 0 ? loc / tot : 0;
    return Math.max(0, target - actual); // 0..1
  };

  for (const day of sortedDays) {
    const dateISO = new Date(day.date).toISOString().slice(0, 10);

    // Pick the best-scoring available provider matching a role predicate.
    // Honors cross-location same-day dedup (`assigned`), location
    // credentialing, non-clinical exclusion, and the role filter. Returns
    // the chosen entry+score or null if none qualify.
    const pickBest = (rolePredicate) => {
      const ranked = roster
        .filter((r) => r.providerType && !r.isNonClinical)
        .filter(rolePredicate)
        .filter((r) => !assigned.has(`${r.id}::${dateISO}`))
        .filter((r) => !offKeys.has(`${r.id}::${dateISO}`)) // PTO / unavailable
        .filter((r) => isEligibleForLocation(r.id, day.location, locationData))
        .map((r) => ({ entry: r, score: MODE_SCORERS[mode](r, ctx) + SITE_SHARE_WEIGHT * siteShareBonus(r.id, day.location) + workRequestBonus(r.id, dateISO, day.location) }))
        .sort((a, b) => b.score - a.score);
      return ranked[0] || null;
    };
    const place = (pick, roomNumber, role) => {
      assigned.add(`${pick.entry.id}::${dateISO}`);
      // Track the site distribution so siteShareBonus self-corrects toward each
      // provider's target mix. Supervisor placements count too (same site).
      locCount.set(`${pick.entry.id}::${day.location}`, (locCount.get(`${pick.entry.id}::${day.location}`) || 0) + 1);
      totCount.set(pick.entry.id, (totCount.get(pick.entry.id) || 0) + 1);
      assignments.push({
        scheduleDayId: day.id,
        roomNumber,
        rosterId: pick.entry.id,
        role,
        scoreAtPick: Number(pick.score.toFixed(3)),
      });
    };

    const isCrna = (r) => r.providerType === 'CRNA';
    const isMd = (r) => r.providerType === 'ANESTHESIOLOGIST';

    // Coverage model from the (refined) supervisionRatio semantic:
    //   null → LEGACY role-agnostic (any clinical provider fills any room;
    //          preserves behavior for schedules with no care-team model set)
    //   0    → MD_ONLY (every room a solo anesthesiologist)
    //   3/4  → TEAM (rooms staffed by CRNAs, supervised by MDs at the ratio)
    const ratio = day.supervisionRatio;

    if (ratio === 3 || ratio === 4) {
      // ── Team model: CRNAs in rooms, MDs supervising at 1:ratio ──────────
      // CRNAs fill rooms greedily. When CRNAs run short, uncovered rooms are
      // backfilled with SOLO MDs (the realistic scheduler move). The number
      // of MD-backfilled rooms is the CRNA-gap signal StaffIQ uses to
      // recommend incentivizing CRNAs (Task #26): a CRNA at a premium is
      // cheaper than an MD in a room (~$800/day each).
      let filledCrnaRooms = 0;
      let crnaGapRooms = 0;
      for (let roomNumber = 1; roomNumber <= day.roomsRequired; roomNumber++) {
        const crna = pickBest(isCrna);
        if (crna) {
          place(crna, roomNumber, 'CRNA_ROOM');
          filledCrnaRooms += 1;
          continue;
        }
        // No CRNA available — backfill the room with a solo MD if possible.
        const md = pickBest(isMd);
        if (md) {
          place(md, roomNumber, 'SOLO_MD_ROOM');
          crnaGapRooms += 1;
          continue;
        }
        warnings.push(
          `No available CRNA or anesthesiologist for ${day.location} on ${dateISO} room ${roomNumber}.`
        );
      }
      // Supervising anesthesiologists for the CRNA rooms only = ceil(CRNA /
      // ratio), packed for efficiency. Solo-MD backfill rooms need no
      // supervision. Stored in a reserved room-number range so they don't
      // collide with real rooms.
      const supervisorsNeeded = Math.ceil(filledCrnaRooms / ratio);
      for (let s = 0; s < supervisorsNeeded; s++) {
        const pick = pickBest(isMd);
        if (!pick) {
          warnings.push(
            `No available anesthesiologist to supervise ${day.location} on ${dateISO} ` +
              `(need ${supervisorsNeeded} for ${filledCrnaRooms} CRNA rooms at 1:${ratio}).`
          );
          break;
        }
        place(pick, SUPERVISOR_ROOM_BASE + s, 'SUPERVISING_MD');
      }
      if (crnaGapRooms > 0) {
        crnaGaps.push({
          scheduleDayId: day.id,
          location: day.location,
          date: dateISO,
          ratio,
          gapRooms: crnaGapRooms,
          filledCrnaRooms,
        });
      }
    } else if (ratio === 0) {
      // ── MD-only: every room a solo anesthesiologist ─────────────────────
      for (let roomNumber = 1; roomNumber <= day.roomsRequired; roomNumber++) {
        const pick = pickBest(isMd);
        if (!pick) {
          warnings.push(`No available anesthesiologist for ${day.location} on ${dateISO} room ${roomNumber}.`);
          continue;
        }
        place(pick, roomNumber, 'SOLO_MD_ROOM');
      }
    } else {
      // ── Legacy / role-agnostic: any clinical provider fills any room ────
      for (let roomNumber = 1; roomNumber <= day.roomsRequired; roomNumber++) {
        const pick = pickBest(() => true);
        if (!pick) {
          warnings.push(`No available provider for ${day.location} on ${dateISO} room ${roomNumber}.`);
          continue;
        }
        place(pick, roomNumber, null);
      }
    }
  }

  const insights = computeInsights({ mode, assignments, roster });
  const score = computeStaffIQScore({ mode, assignments, roster, warnings, scheduleDays });
  const staffiqRecommendations = computeCrnaGapRecommendations(crnaGaps, roster);

  return { assignments, insights, warnings, score, staffiqRecommendations };
}

/**
 * StaffIQ CRNA-gap optimizer (Task #26).
 *
 * For each team-location-day where rooms were backfilled with solo MDs for
 * lack of CRNAs, compute the dollar economics of instead incentivizing
 * CRNAs to fill those rooms. An MD in a room is ~$300/hr; a CRNA ~$200/hr.
 * Swapping a solo-MD room for a CRNA saves the rate differential, minus any
 * extra supervising MD the new CRNA pushes you into (1 supervisor per `ratio`
 * CRNAs). Even paying the CRNA a premium, you usually come out well ahead —
 * and the recommendation drives an incentive shift into the marketplace.
 *
 * Returns { gaps: [...], totalProjectedSavings } where each gap carries the
 * per-day MD-backfill penalty, projected savings, and the break-even CRNA
 * rate (the coordinator's bidding ceiling).
 */
function computeCrnaGapRecommendations(crnaGaps, roster) {
  if (!crnaGaps || crnaGaps.length === 0) {
    return { gaps: [], totalProjectedSavings: 0 };
  }
  const HOURS = 8;
  const ratesFor = (type) =>
    roster
      .filter((r) => r.providerType === type)
      .map((r) => effectiveHourlyRate(r))
      .filter((x) => x > 0);
  const avg = (arr, fallback) =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : fallback;
  const crnaRate = avg(ratesFor('CRNA'), 200);
  const mdRate = avg(ratesFor('ANESTHESIOLOGIST'), 300);

  const gaps = crnaGaps
    .map((g) => {
      const removedMd = g.gapRooms * mdRate * HOURS; // solo MDs we'd remove
      const addedCrna = g.gapRooms * crnaRate * HOURS; // CRNAs we'd add (std rate)
      // Extra supervising MDs the new CRNAs push us into (1 per `ratio`).
      const supervisorDelta =
        (Math.ceil((g.filledCrnaRooms + g.gapRooms) / g.ratio) -
          Math.ceil(g.filledCrnaRooms / g.ratio)) *
        mdRate *
        HOURS;
      const projectedSavingsPerDay = Math.round(removedMd - addedCrna - supervisorDelta);
      // The CRNA hourly rate at which the swap breaks even — how high the
      // coordinator can bid on an incentive shift and still save money.
      const maxCrnaRate = Math.round(crnaRate + projectedSavingsPerDay / (g.gapRooms * HOURS));
      return {
        scheduleDayId: g.scheduleDayId,
        location: g.location,
        date: g.date,
        ratio: g.ratio,
        crnaShortfall: g.gapRooms,
        mdBackfillCostPerDay: Math.round(removedMd),
        projectedSavingsPerDay,
        recommendedCrnaRate: Math.round(crnaRate),
        maxCrnaRate,
      };
    })
    .filter((g) => g.projectedSavingsPerDay > 0);

  const totalProjectedSavings = gaps.reduce((s, g) => s + g.projectedSavingsPerDay, 0);
  return { gaps, totalProjectedSavings };
}

// ── Insights & scoring ─────────────────────────────────────────────────────

function hasExplicitRate(r) {
  return (r.hourlyRate && r.hourlyRate > 0) || (r.annualRate && r.annualRate > 0);
}

function computeInsights({ mode, assignments, roster }) {
  const rosterById = Object.fromEntries(roster.map((r) => [r.id, r]));
  let totalCost = 0;
  let locumsUsed = 0;
  let fullTimeUsed = 0;
  // Care-team breakdown so the cost/coverage is legible to coordinators.
  let crnaRooms = 0;
  let soloMdRooms = 0;
  let supervisingMds = 0;
  const providerHours = {};
  // Providers in this schedule whose rate had to be defaulted. The cost story
  // is only as honest as the rate inputs; surface this so the UI can warn.
  const defaultRateProviders = new Set();

  for (const a of assignments) {
    const r = rosterById[a.rosterId];
    if (!r) continue;
    const hours = SHIFT_HOURS_PER_DAY;
    totalCost += effectiveHourlyRate(r) * hours;
    if (!hasExplicitRate(r)) defaultRateProviders.add(r.id);
    if (r.employmentCategory === 'LOCUMS') locumsUsed += 1;
    if (r.employmentCategory === 'FULL_TIME') fullTimeUsed += 1;
    if (a.role === 'CRNA_ROOM') crnaRooms += 1;
    else if (a.role === 'SOLO_MD_ROOM') soloMdRooms += 1;
    else if (a.role === 'SUPERVISING_MD') supervisingMds += 1;
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
    // Care-team breakdown (Task #21 Phase B). supervisingMds are paid MDs
    // not in a room; crnaRooms + soloMdRooms = actual OR rooms staffed.
    crnaRooms,
    soloMdRooms,
    supervisingMds,
    // OR room-days actually staffed (every non-supervisor assignment is one
    // room for one day). Drives the industry-baseline cost comparison:
    // baseline = facility.industryRoomRatePerDay * roomDays.
    roomDays: assignments.length - supervisingMds,
    // Count of unique providers in this schedule whose rate had to be
    // defaulted (no hourlyRate / annualRate on file). The UI surfaces this
    // so the savings number is presented as "approximate" until rates land.
    defaultRateProviders: defaultRateProviders.size,
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
  // Supervising MDs are not rooms — exclude them from the fill-rate numerator
  // so a team-model schedule doesn't read as >100% filled.
  const filled = assignments.filter((a) => a.role !== 'SUPERVISING_MD').length;
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

/**
 * Derive crnaGaps from already-materialized ScheduleDay rows (with their
 * assignments). Used by the re-score path, which works from the live edited
 * schedule rather than a fresh build. A team-model day (supervisionRatio
 * 3/4) is CRNA-short by the number of SOLO_MD_ROOM assignments it carries.
 */
function deriveCrnaGaps(days) {
  const gaps = [];
  for (const d of days) {
    if (d.supervisionRatio !== 3 && d.supervisionRatio !== 4) continue;
    const a = d.assignments || [];
    const filledCrnaRooms = a.filter((x) => x.role === 'CRNA_ROOM' && x.rosterId).length;
    const gapRooms = a.filter((x) => x.role === 'SOLO_MD_ROOM' && x.rosterId).length;
    if (gapRooms > 0) {
      gaps.push({
        scheduleDayId: d.id,
        location: d.location,
        date: new Date(d.date).toISOString().slice(0, 10),
        ratio: d.supervisionRatio,
        gapRooms,
        filledCrnaRooms,
      });
    }
  }
  return gaps;
}

module.exports = {
  MODES,
  runMode,
  resolveStaffIQWeights,
  // exposed for testing / re-scoring after edits
  computeInsights,
  computeStaffIQScore,
  computeCrnaGapRecommendations,
  deriveCrnaGaps,
  // exposed so the month "Est. Cost" summary uses the SAME real-rate math as
  // the builder (one consistent SNAP cost number across the page).
  effectiveHourlyRate,
  SHIFT_HOURS_PER_DAY,
};
