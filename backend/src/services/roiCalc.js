/**
 * ROI math helpers. Pure functions — no DB access. Called from the admin
 * ROI endpoints and shared with the prospect-projection path so one math
 * rule covers customer dashboards + sales projections.
 *
 * Mirrors the CAPA-pilot tracker JSX 1:1. All inputs are facility-baseline
 * fields + per-month actuals; outputs are derived savings + KPIs.
 */

// Targets are global tuning constants. Could become per-facility later;
// kept inline for v1 so the calculation surface stays small.
const TARGETS = Object.freeze({
  backupReduction: 0.20,         // 20% fewer backup shifts/day
  adminSchedulingReduction: 0.35,
  credentialingReduction: 0.40,
  turnaroundReduction: 0.50,
  gapRateReduction: 0.60,
  satisfactionTarget: 8.5,
});

// Annual cost scale factor. SendGrid weeks per month is 4.33 because we
// want the math to match the JSX prototype exactly.
const WEEKS_PER_MONTH = 4.33;
const DAYS_PER_MONTH = 30;

/**
 * Baseline cost rollup for a facility. All monthly.
 * Input: full FacilityRoiBaseline row.
 */
function computeBaselineCosts(b) {
  if (!b) return {
    backupMonthly: 0, adminSchedulingMonthly: 0, credentialingMonthly: 0,
    adminTotalMonthly: 0,
  };
  const backupMonthly =
    b.backupShiftsPerDay * DAYS_PER_MONTH * b.shiftHours *
    b.providerHourlyRate * b.backupPremium;
  const adminSchedulingMonthly =
    b.adminSchedulingStaff * b.adminSchedulingHours * WEEKS_PER_MONTH * b.adminSchedulingRate;
  const credentialingMonthly =
    b.credentialingStaff * b.credentialingHours * WEEKS_PER_MONTH * b.credentialingRate;
  return {
    backupMonthly,
    adminSchedulingMonthly,
    credentialingMonthly,
    adminTotalMonthly: adminSchedulingMonthly + credentialingMonthly,
  };
}

/**
 * Actual cost rollup for a given snapshot. Mirrors the baseline math but
 * with the actual numbers entered (or auto-pulled). Missing fields fall
 * back to baseline so partial snapshots produce a sane "no change" view.
 */
function computeActualCosts(b, s) {
  if (!b) return { backupMonthly: 0, adminSchedulingMonthly: 0, credentialingMonthly: 0 };
  const backupShiftsPerDay = s?.backupShiftsPerDay ?? b.backupShiftsPerDay;
  const adminSchedulingHours = s?.adminSchedulingHours ?? (b.adminSchedulingStaff * b.adminSchedulingHours);
  const credentialingHours = s?.credentialingHours ?? (b.credentialingStaff * b.credentialingHours);
  const backupMonthly =
    backupShiftsPerDay * DAYS_PER_MONTH * b.shiftHours *
    b.providerHourlyRate * b.backupPremium;
  const adminSchedulingMonthly =
    adminSchedulingHours * WEEKS_PER_MONTH * b.adminSchedulingRate;
  const credentialingMonthly =
    credentialingHours * WEEKS_PER_MONTH * b.credentialingRate;
  return {
    backupMonthly,
    adminSchedulingMonthly,
    credentialingMonthly,
    adminTotalMonthly: adminSchedulingMonthly + credentialingMonthly,
  };
}

/**
 * Headline savings (monthly + annualized) and the two component
 * breakdowns. Same outputs the dashboard KPIs render.
 */
function computeSavings(b, s) {
  const base = computeBaselineCosts(b);
  const act = computeActualCosts(b, s);
  const backupSavingsMonthly = base.backupMonthly - act.backupMonthly;
  const adminSavingsMonthly = base.adminTotalMonthly - act.adminTotalMonthly;
  const totalMonthly = backupSavingsMonthly + adminSavingsMonthly;
  return {
    baseline: base,
    actual: act,
    backupSavingsMonthly,
    adminSavingsMonthly,
    totalMonthly,
    totalAnnualized: totalMonthly * 12,
  };
}

/**
 * Per-metric progress vector. For each baseline+actual+target, returns
 * the % distance traveled toward target. Mirrors the JSX prototype.
 */
function computeMetricProgress(b, s) {
  if (!b) return [];
  const baselineAdminHours = b.adminSchedulingStaff * b.adminSchedulingHours;
  const baselineCredHours = b.credentialingStaff * b.credentialingHours;
  const metrics = [
    {
      key: 'backupShiftsPerDay',
      label: 'Backup Shifts / Day',
      unit: 'shifts',
      baseline: b.backupShiftsPerDay,
      actual: s?.backupShiftsPerDay ?? b.backupShiftsPerDay,
      target: round1(b.backupShiftsPerDay * (1 - TARGETS.backupReduction)),
    },
    {
      key: 'adminSchedulingHours',
      label: 'Admin Scheduling Hours / Week',
      unit: 'hrs',
      baseline: baselineAdminHours,
      actual: s?.adminSchedulingHours ?? baselineAdminHours,
      target: Math.round(baselineAdminHours * (1 - TARGETS.adminSchedulingReduction)),
    },
    {
      key: 'credentialingHours',
      label: 'Credentialing Hours / Week',
      unit: 'hrs',
      baseline: baselineCredHours,
      actual: s?.credentialingHours ?? baselineCredHours,
      target: Math.round(baselineCredHours * (1 - TARGETS.credentialingReduction)),
    },
    {
      key: 'credentialingTurnaround',
      label: 'Credentialing Turnaround',
      unit: 'days',
      baseline: b.credentialingTurnaround,
      actual: s?.credentialingTurnaround ?? b.credentialingTurnaround,
      target: Math.round(b.credentialingTurnaround * (1 - TARGETS.turnaroundReduction)),
    },
    {
      key: 'schedulingGapRate',
      label: 'Schedule Gap Rate',
      unit: '%',
      baseline: b.schedulingGapRate,
      actual: s?.schedulingGapRate ?? b.schedulingGapRate,
      target: round1(b.schedulingGapRate * (1 - TARGETS.gapRateReduction)),
    },
    {
      key: 'providerSatisfaction',
      label: 'Provider Satisfaction',
      unit: '/10',
      baseline: b.providerSatisfaction,
      actual: s?.providerSatisfaction ?? b.providerSatisfaction,
      target: TARGETS.satisfactionTarget,
    },
  ];
  return metrics.map((m) => ({
    ...m,
    progress: progressTowardsTarget(m),
  }));
}

function progressTowardsTarget(m) {
  const isReduction = m.target < m.baseline;
  if (isReduction) {
    const totalChange = m.baseline - m.target;
    const actualChange = m.baseline - m.actual;
    if (totalChange === 0) return 0;
    return clamp01(actualChange / totalChange) * 100;
  }
  const totalChange = m.target - m.baseline;
  const actualChange = m.actual - m.baseline;
  if (totalChange === 0) return 0;
  return clamp01(actualChange / totalChange) * 100;
}

/**
 * Project savings for a prospect at a different scale. Pure linear scale
 * by provider-count ratio against a chosen baseline customer (defaults
 * to the passed-in baseline). Returns a slim shape for the prospect tab.
 *
 * @param {object} sourceBaseline - baseline row from a real customer
 * @param {object} sourceSnapshot - latest snapshot from that customer (drives the % reductions)
 * @param {object} prospect - { providerCount, monthlyProviderCost? }
 */
function projectForProspect(sourceBaseline, sourceSnapshot, prospect) {
  if (!sourceBaseline || !prospect?.providerCount) {
    return { scale: 0, monthlySavings: 0, annualSavings: 0 };
  }
  const sourceSavings = computeSavings(sourceBaseline, sourceSnapshot).totalMonthly;
  const scale = prospect.providerCount / Math.max(1, sourceBaseline.providerCount);
  const monthlySavings = sourceSavings * scale;
  return {
    scale,
    sourceCustomerProviderCount: sourceBaseline.providerCount,
    sourceMonthlySavings: sourceSavings,
    monthlySavings,
    annualSavings: monthlySavings * 12,
  };
}

/** Aggregate rollup across N facilities for the SNAP-wide band. */
function rollup(rows) {
  // rows: [{ baseline, latestSnapshot }]
  let totalSavingsMonthly = 0;
  let totalProviders = 0;
  let facilitiesWithSavings = 0;
  for (const r of rows) {
    if (!r.baseline) continue;
    const s = computeSavings(r.baseline, r.latestSnapshot);
    totalSavingsMonthly += s.totalMonthly;
    totalProviders += r.baseline.providerCount || 0;
    if (s.totalMonthly > 0) facilitiesWithSavings++;
  }
  return {
    totalSavingsMonthly,
    totalSavingsAnnualized: totalSavingsMonthly * 12,
    totalProviders,
    facilitiesTracked: rows.length,
    facilitiesWithSavings,
  };
}

// helpers
function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function round1(n) { return Math.round(n * 10) / 10; }

module.exports = {
  TARGETS,
  computeBaselineCosts,
  computeActualCosts,
  computeSavings,
  computeMetricProgress,
  projectForProspect,
  rollup,
};
