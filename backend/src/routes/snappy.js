// Snappy assistant endpoint (Task #17).
//   POST /api/snappy/chat  { messages: [{role, content}, ...] }
// Facility-authed: tools run with req.facility context, so Snappy can only
// ever read the asking facility's own operational data.

const express = require('express');
const facilityAuth = require('../middleware/facilityAuth');
const snappy = require('../services/snappy');

const router = express.Router();

router.post('/chat', facilityAuth, async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }
    const ctx = {
      facility: req.facility,
      userEmail: req.user?.email || null,
    };
    const { reply, escalated } = await snappy.chat({ messages, ctx });
    res.json({ reply, escalated });
  } catch (err) {
    console.error('[snappy] chat failed:', err);
    res.status(500).json({
      reply: "Sorry — I hit a problem on my end. You can reach the SNAP team at matt@snapmedical.app.",
      error: 'snappy_error',
    });
  }
});

module.exports = router;
