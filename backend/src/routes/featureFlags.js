const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const adminAuth = require('../middleware/adminAuth');
const { FLAGS, getEffectiveFlags } = require('../config/featureFlags');

const router = express.Router();

// ── Facility: read my own effective flags ──────────────────────────────────────
// Used by the web app to decide which nav items / features to render.
router.get('/me', facilityAuth, async (req, res) => {
  try {
    const effective = await getEffectiveFlags(req.facility.id);
    if (!effective) return res.status(404).json({ error: 'Facility not found' });
    // Flatten to { flagName: boolean } for easy client consumption, plus the
    // full detail for any UI that wants source/tier.
    const enabled = {};
    for (const [name, v] of Object.entries(effective.flags)) enabled[name] = v.enabled;
    res.json({ tier: effective.tier, enabled, detail: effective.flags });
  } catch (err) {
    console.error('[feature-flags/me]', err.message);
    res.status(500).json({ error: 'Failed to load feature flags' });
  }
});

// ── Admin: flag catalog (metadata for the toggle UI) ────────────────────────────
router.get('/catalog', adminAuth, (req, res) => {
  res.json({
    flags: Object.entries(FLAGS).map(([name, meta]) => ({ name, ...meta })),
  });
});

// ── Admin: effective flags for a specific facility ──────────────────────────────
router.get('/facility/:facilityId', adminAuth, async (req, res) => {
  try {
    const effective = await getEffectiveFlags(req.params.facilityId);
    if (!effective) return res.status(404).json({ error: 'Facility not found' });
    res.json(effective);
  } catch (err) {
    console.error('[feature-flags/facility]', err.message);
    res.status(500).json({ error: 'Failed to load feature flags' });
  }
});

// ── Admin: set or clear a per-facility override ─────────────────────────────────
// Body: { flagName, enabled }            → upsert an OVERRIDE row
//       { flagName, reset: true }        → delete the override (revert to tier)
router.put('/facility/:facilityId', adminAuth, async (req, res) => {
  const { facilityId } = req.params;
  const { flagName, enabled, reset, notes } = req.body || {};
  if (!flagName || !FLAGS[flagName]) {
    return res.status(400).json({ error: 'Unknown flag' });
  }
  try {
    if (reset) {
      await prisma.facilityFeatureFlag
        .delete({ where: { facilityId_flagName: { facilityId, flagName } } })
        .catch(() => {}); // no-op if there was no override
    } else {
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      await prisma.facilityFeatureFlag.upsert({
        where: { facilityId_flagName: { facilityId, flagName } },
        create: { facilityId, flagName, enabled, source: 'OVERRIDE', setById: req.user.userId, notes },
        update: { enabled, source: 'OVERRIDE', setById: req.user.userId, setAt: new Date(), notes },
      });
    }
    const effective = await getEffectiveFlags(facilityId);
    res.json(effective);
  } catch (err) {
    console.error('[feature-flags PUT]', err.message);
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

module.exports = router;
