const express = require('express');
const prisma = require('../config/db');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

const VALID_STATUSES = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'CUSTOMER', 'NOT_INTERESTED'];

// ── GET / — list all leads, optional ?status filter ──────────────────────────

router.get('/', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      where.followUpStatus = status;
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// ── GET /export — return all leads as JSON array ──────────────────────────────

router.get('/export', adminAuth, async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json(leads);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export leads' });
  }
});

// ── GET /stats — aggregate stats ──────────────────────────────────────────────

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      select: {
        followUpStatus:  true,
        savingsEstimate: true,
      },
    });

    const total = leads.length;

    const byStatus = VALID_STATUSES.reduce((acc, s) => {
      acc[s] = 0;
      return acc;
    }, {});

    let totalSavingsEstimate = 0;

    for (const lead of leads) {
      if (byStatus[lead.followUpStatus] !== undefined) {
        byStatus[lead.followUpStatus]++;
      }
      if (lead.savingsEstimate) {
        totalSavingsEstimate += lead.savingsEstimate;
      }
    }

    const avgSavingsEstimate = total > 0 ? totalSavingsEstimate / total : 0;

    res.json({ total, byStatus, totalSavingsEstimate, avgSavingsEstimate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lead stats' });
  }
});

// ── PATCH /:id — update followUpStatus ───────────────────────────────────────

router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpStatus } = req.body;

    if (!followUpStatus) {
      return res.status(400).json({ error: 'followUpStatus is required' });
    }

    if (!VALID_STATUSES.includes(followUpStatus)) {
      return res.status(400).json({ error: `Invalid followUpStatus. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const lead = await prisma.lead.update({
      where: { id },
      data:  { followUpStatus },
    });

    res.json({ lead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

module.exports = router;
