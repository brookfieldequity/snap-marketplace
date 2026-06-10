// Provider notification inbox API (Task #16).
//
//   GET  /notifications              → list (newest first, paginated)
//   GET  /notifications/unread-count → badge count
//   POST /notifications/:id/read     → mark one read
//   POST /notifications/read-all     → mark all read
//
// All endpoints are provider-authed (auth.js attaches req.user with profileId).

const express = require('express');
const prisma = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

// Resolve the caller's ProviderProfile id. The provider JWT carries profileId,
// but fall back to a lookup by userId in case an older token omits it.
async function resolveProfileId(req) {
  if (req.user?.profileId) return req.user.profileId;
  if (!req.user?.userId) return null;
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: req.user.userId },
    select: { id: true },
  });
  return profile?.id || null;
}

// GET /notifications?limit=&before=
router.get('/', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.json({ notifications: [], unreadCount: 0 });

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = req.query.before ? new Date(req.query.before) : null;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          providerId,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { providerId, readAt: null } }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notifications] list failed:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.json({ unreadCount: 0 });
    const unreadCount = await prisma.notification.count({
      where: { providerId, readAt: null },
    });
    res.json({ unreadCount });
  } catch (err) {
    console.error('[notifications] unread-count failed:', err);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

// POST /notifications/:id/read
router.post('/:id/read', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });
    // Scope the update to the caller so one provider can't mark another's rows.
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, providerId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count });
  } catch (err) {
    console.error('[notifications] mark-read failed:', err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// POST /notifications/read-all
router.post('/read-all', auth, async (req, res) => {
  try {
    const providerId = await resolveProfileId(req);
    if (!providerId) return res.status(404).json({ error: 'No provider profile' });
    const result = await prisma.notification.updateMany({
      where: { providerId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count });
  } catch (err) {
    console.error('[notifications] read-all failed:', err);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

module.exports = router;
