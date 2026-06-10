// Snappy assistant endpoints (Task #17).
//   POST /api/snappy/chat           { messages } — facility web portal (facilityAuth)
//   POST /api/snappy/provider-chat  { messages } — provider mobile app (auth)
// Each runs tools with the caller's own context, so Snappy can only ever read
// the asking facility's (or provider's) own data.

const express = require('express');
const facilityAuth = require('../middleware/facilityAuth');
const auth = require('../middleware/auth');
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

// Provider mobile app — runs with the authenticated provider's identity.
router.post('/provider-chat', auth, async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }
    const ctx = {
      userId: req.user?.userId,
      userEmail: req.user?.email || null,
    };
    const { reply, escalated } = await snappy.providerChat({ messages, ctx });
    res.json({ reply, escalated });
  } catch (err) {
    console.error('[snappy] provider chat failed:', err);
    res.status(500).json({
      reply: "Sorry — I hit a problem on my end. You can reach the SNAP team at matt@snapmedical.app.",
      error: 'snappy_error',
    });
  }
});

module.exports = router;
