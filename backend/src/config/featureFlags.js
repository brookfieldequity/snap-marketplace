const prisma = require('./db');

// ──────────────────────────────────────────────────────────────────────────────
// Feature flags — the single source of truth for which features a facility can
// access. Effective value for a flag is resolved as:
//   1. explicit per-facility override row (FacilityFeatureFlag) if one exists
//   2. otherwise the default for the facility's SubscriptionTier (below)
//   3. otherwise the flag's hard default (false)
//
// Flags are set ONLY by SNAP admins. Facility admins can read their own
// effective flags but can never modify them. Subscription-tier pricing is NOT
// defined yet (deferred) — these tier defaults are a starting map and are the
// ONE place to edit when tiers firm up.
// ──────────────────────────────────────────────────────────────────────────────

// Flag catalog. `category` groups them in the admin UI. `adminOnly: true`
// marks flags that should never be on in the current go-to-market regardless
// of tier (they exist as architecture only).
const FLAGS = {
  // SNAP Shifts
  payroll_builder: {
    label: 'Payroll Builder',
    description: 'SNAP Shifts payroll CSV export to ADP/Gusto.',
    category: 'SNAP Shifts',
  },
  // SNAP Marketplace — Position 1
  marketplace_core: {
    label: 'Marketplace Core',
    description: 'Post and fill externally-sourced marketplace shifts.',
    category: 'Marketplace',
  },
  shift_verification: {
    label: 'Shift Verification',
    description: 'Dual provider + facility shift verification workflow.',
    category: 'Marketplace',
  },
  transaction_fees: {
    label: 'Transaction Fees',
    description: 'Charge the 5% platform fee on verified marketplace shifts.',
    category: 'Marketplace',
  },
  internal_shift_fee: {
    label: 'Internal Shift Fee',
    description:
      'ARCHITECTURE ONLY — per-shift fee on INTERNAL shifts. Never activate in the current go-to-market; internal shifts are subscription-only.',
    category: 'Marketplace',
    adminOnly: true,
  },
  // SNAP Marketplace — Position 2 (Stripe Connect, V3 — off everywhere for now)
  stripe_connect: {
    label: 'Stripe Connect Payouts',
    description: 'V3 — facilitate full provider payment via Stripe Connect.',
    category: 'Payments (V3)',
    adminOnly: true,
  },
  instant_payout: {
    label: 'Instant Payout',
    description: 'V3 — instant provider payout to debit card.',
    category: 'Payments (V3)',
    adminOnly: true,
  },
  facilitation_fee: {
    label: 'Facilitation Fee',
    description: 'V3 — 1.75% payment facilitation fee (paired with Stripe Connect).',
    category: 'Payments (V3)',
    adminOnly: true,
  },
};

// Per-tier defaults. Anything omitted defaults to false. adminOnly flags are
// intentionally left false at every tier.
const TIER_DEFAULTS = {
  BASIC: {
    marketplace_core: true,
    shift_verification: true,
    transaction_fees: true,
    // payroll_builder OFF — Basic facilities don't get payroll export.
  },
  PROFESSIONAL: {
    marketplace_core: true,
    shift_verification: true,
    transaction_fees: true,
    payroll_builder: true,
  },
  ENTERPRISE: {
    marketplace_core: true,
    shift_verification: true,
    transaction_fees: true,
    payroll_builder: true,
  },
};

const ALL_FLAG_NAMES = Object.keys(FLAGS);

function tierDefault(tier, flagName) {
  const t = TIER_DEFAULTS[tier] || TIER_DEFAULTS.BASIC;
  return Boolean(t[flagName]);
}

// Resolve every flag for a facility into { flagName: { enabled, source } }.
// `source` is 'OVERRIDE' when an explicit row decides it, else 'TIER'.
async function getEffectiveFlags(facilityId) {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { subscription: true },
  });
  if (!facility) return null;
  const tier = facility.subscription?.tier || 'BASIC';

  const overrides = await prisma.facilityFeatureFlag.findMany({
    where: { facilityId },
  });
  const overrideMap = new Map(overrides.map((o) => [o.flagName, o]));

  const result = {};
  for (const name of ALL_FLAG_NAMES) {
    if (overrideMap.has(name)) {
      result[name] = { enabled: overrideMap.get(name).enabled, source: 'OVERRIDE' };
    } else {
      result[name] = { enabled: tierDefault(tier, name), source: 'TIER' };
    }
  }
  return { tier, flags: result };
}

// Boolean check for one flag for one facility.
async function isFlagEnabled(facilityId, flagName) {
  const override = await prisma.facilityFeatureFlag.findUnique({
    where: { facilityId_flagName: { facilityId, flagName } },
  });
  if (override) return override.enabled;
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { subscription: true },
  });
  const tier = facility?.subscription?.tier || 'BASIC';
  return tierDefault(tier, flagName);
}

// Express middleware factory. Use on facilityAuth-protected routes:
//   router.use(requireFlag('payroll_builder'))
// Reads req.facility (set by facilityAuth) and 403s if the flag is off.
function requireFlag(flagName) {
  return async (req, res, next) => {
    try {
      const facilityId = req.facility?.id;
      if (!facilityId) return res.status(403).json({ error: 'No facility associated' });
      const enabled = await isFlagEnabled(facilityId, flagName);
      if (!enabled) {
        return res.status(403).json({ error: 'Feature not enabled for this facility', flag: flagName });
      }
      next();
    } catch (err) {
      console.error('[requireFlag]', flagName, err.message);
      res.status(500).json({ error: 'Feature check failed' });
    }
  };
}

module.exports = {
  FLAGS,
  TIER_DEFAULTS,
  ALL_FLAG_NAMES,
  getEffectiveFlags,
  isFlagEnabled,
  requireFlag,
};
