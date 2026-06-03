/**
 * Read endpoints for the "Cost Savings" / "Time Saved by SNAP Automation"
 * widgets. Two routes:
 *   GET /api/automation-events/savings           — current facility's savings
 *                                                  (facilityAuth)
 *   GET /api/automation-events/savings/aggregate — SNAP-wide aggregate
 *                                                  (adminAuth)
 *
 * Both return the same shape: { thisWeek, thisMonth, total } where each
 * period is { eventCount, minutesSaved, hoursSaved, dollarsSaved }. The
 * widget UI toggles between periods client-side; only one round-trip
 * needed per page load.
 *
 * Write side (logging events) is internal — no public POST endpoint. Other
 * route handlers import logAutomationEvent from services/automationEvents.js
 * and call it directly after their primary operation succeeds.
 */

const express = require('express');
const facilityAuth = require('../middleware/facilityAuth');
const adminAuth = require('../middleware/adminAuth');
const { getSavings } = require('../services/automationEvents');

const router = express.Router();

router.get('/savings', facilityAuth, async (req, res) => {
  try {
    const savings = await getSavings({ facilityId: req.facility.id });
    res.json(savings);
  } catch (err) {
    console.error('[automation-events:facility] error:', err);
    res.status(500).json({ error: 'Failed to load savings.' });
  }
});

router.get('/savings/aggregate', adminAuth, async (req, res) => {
  try {
    const savings = await getSavings({ facilityId: null });
    res.json(savings);
  } catch (err) {
    console.error('[automation-events:aggregate] error:', err);
    res.status(500).json({ error: 'Failed to load aggregate savings.' });
  }
});

module.exports = router;
