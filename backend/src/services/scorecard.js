// Admin scorecard service — composes the EOS weekly "seven numbers" (+ a few
// secondaries) from data that already exists, falling back to manual inputs for
// what the platform can't compute yet. See docs/admin-scorecard-spec.md.
//
// Each metric is returned as { key, label, value, target, unit, status, source }
// where status is 'green' | 'yellow' | 'red' | 'na'. Nothing here invents a live
// number — MANUAL/BLOCKED metrics are flagged via `source` so the UI can label them.

const prisma = require('../config/db');
const roiCalc = require('./roiCalc');

// Live facility tier prices (display/sales — no billing yet). Used only for the
// synthetic MRR estimate until Stripe exists. Keep in sync with the web pricing.
const TIER_PRICE = { BASIC: 2500, PROFESSIONAL: 5000, ENTERPRISE: 10000 };

// RAG against a target. higherIsBetter=false means lower is better (e.g. days-to-close).
function rag(value, target, { higherIsBetter = true } = {}) {
  if (value == null || target == null) return 'na';
  if (higherIsBetter) {
    if (value >= target) return 'green';
    if (value >= target * 0.9) return 'yellow';
    return 'red';
  }
  if (value <= target) return 'green';
  if (value <= target * 1.1) return 'yellow';
  return 'red';
}

function weekAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

// CAPA backup-staffing reduction % from the existing ROI system. Picks the
// facility named exactly "CAPA" (not "CAPA Pilot"); falls back to the first
// facility that has a baseline + at least one snapshot.
async function capaBackupReduction() {
  let facility = await prisma.facility.findFirst({
    where: { name: 'CAPA', roiBaseline: { isNot: null } },
    include: { roiBaseline: true, roiSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!facility) {
    facility = await prisma.facility.findFirst({
      where: { roiBaseline: { isNot: null }, roiSnapshots: { some: {} } },
      include: { roiBaseline: true, roiSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }
  if (!facility?.roiBaseline) return { pct: null, facilityName: null };
  const snapshot = facility.roiSnapshots?.[0] || null;
  const metrics = roiCalc.computeMetricProgress(facility.roiBaseline, snapshot);
  const backup = metrics.find((m) => m.key === 'backupShiftsPerDay');
  if (!backup || !backup.baseline) return { pct: 0, facilityName: facility.name };
  const pct = Math.round(((backup.baseline - backup.actual) / backup.baseline) * 100);
  return { pct, facilityName: facility.name };
}

async function getScorecard() {
  const since = weekAgo();
  const [
    manual,
    activeCredGroups,
    newCredGroups,
    expiringCount,
    shiftsCompletedCum,
    shiftsCompletedWeek,
    subsByTier,
    completedThisWeekBookings,
    capa,
  ] = await Promise.all([
    prisma.scorecardManual.findUnique({ where: { id: 'singleton' } }),
    // #1 active credentialed providers — distinct providers with an ACTIVE credential.
    // NOTE: proxy. Confirm the precise "all required credentials current" definition
    // against the credentialing flow before treating as authoritative.
    prisma.providerCredential.groupBy({
      by: ['providerId'],
      where: { status: 'ACTIVE', providerId: { not: null } },
    }),
    prisma.providerCredential.groupBy({
      by: ['providerId'],
      where: { status: 'ACTIVE', providerId: { not: null }, updatedAt: { gte: since } },
    }),
    prisma.providerCredential.count({ where: { status: 'EXPIRING_SOON' } }),
    // #2 completed shifts (bookings with a completedAt), cumulative + this week.
    prisma.shiftBooking.count({ where: { completedAt: { not: null } } }),
    prisma.shiftBooking.count({ where: { completedAt: { gte: since } } }),
    prisma.facilitySubscription.groupBy({ by: ['tier'], _count: { tier: true } }),
    prisma.shiftBooking.findMany({
      where: { completedAt: { gte: since } },
      select: { totalShiftValue: true },
    }),
    capaBackupReduction(),
  ]);

  const activeProviders = activeCredGroups.length;
  const newProvidersWeek = newCredGroups.length;

  // #5 MRR — manual override if set, else synthetic estimate (tier counts × price
  // + 10% platform-fee run-rate on this week's GTV annualized to monthly).
  const subscriptionMrr = subsByTier.reduce(
    (sum, r) => sum + (TIER_PRICE[r.tier] || 0) * r._count.tier, 0);
  const weekGtv = completedThisWeekBookings.reduce((s, b) => s + (b.totalShiftValue || 0), 0);
  const txnFeeMonthlyEstimate = Math.round((weekGtv * 0.1) * (52 / 12));
  const mrrEstimate = subscriptionMrr + txnFeeMonthlyEstimate;
  const mrrValue = manual?.mrrMonthly != null ? manual.mrrMonthly : mrrEstimate;
  const mrrIsManual = manual?.mrrMonthly != null;

  const metrics = [
    {
      key: 'activeProviders', label: 'Active Credentialed Providers', unit: '',
      value: activeProviders, target: 10, secondary: `+${newProvidersWeek} this week`,
      status: rag(newProvidersWeek, 10), source: 'auto',
    },
    {
      key: 'shiftsCompleted', label: 'Completed Marketplace Shifts', unit: '',
      value: shiftsCompletedCum, target: 50, secondary: `+${shiftsCompletedWeek} this week`,
      status: rag(shiftsCompletedWeek, 50), source: 'auto',
    },
    {
      key: 'pipelineActive', label: 'Active Pipeline Conversations', unit: '',
      value: manual?.pipelineActive ?? null, target: 5,
      status: rag(manual?.pipelineActive ?? null, 5), source: 'manual (HubSpot)',
    },
    {
      key: 'daysToClose', label: 'Avg Days to Close', unit: ' days',
      value: manual?.avgDaysToClose ?? null, target: 30,
      status: rag(manual?.avgDaysToClose ?? null, 30, { higherIsBetter: false }),
      source: 'manual (HubSpot)',
    },
    {
      key: 'mrr', label: 'Monthly Recurring Revenue', unit: '$',
      value: mrrValue, target: null,
      status: 'na', // "growing" is judged vs. last snapshot, not a fixed target
      source: mrrIsManual ? 'manual' : 'estimate (no billing yet)',
    },
    {
      key: 'capaBackupReduction', label: 'CAPA Backup Staffing Reduction', unit: '%',
      value: capa.pct, target: 20, status: rag(capa.pct, 20),
      secondary: capa.facilityName ? `via ${capa.facilityName} ROI` : 'no baseline yet',
      source: 'auto (ROI)',
    },
    {
      key: 'capaNps', label: 'CAPA Administrator NPS', unit: '/10',
      value: manual?.capaNps ?? null, target: 8, status: rag(manual?.capaNps ?? null, 8),
      source: 'manual (no survey yet)',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    secondary: {
      providersNewThisWeek: newProvidersWeek,
      credentialsExpiringSoon: expiringCount,
      mrrEstimate, mrrIsManual,
      totalFacilities: subsByTier.reduce((s, r) => s + r._count.tier, 0),
    },
    manual: manual || null,
  };
}

// Upsert the manual inputs (MRR / pipeline / days-to-close / NPS).
async function setManual(values, updatedBy) {
  const data = {
    mrrMonthly: values.mrrMonthly ?? null,
    pipelineActive: values.pipelineActive ?? null,
    avgDaysToClose: values.avgDaysToClose ?? null,
    capaNps: values.capaNps ?? null,
    updatedBy: updatedBy || null,
  };
  return prisma.scorecardManual.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });
}

module.exports = { getScorecard, setManual };
