const express = require('express');
const { Expo } = require('expo-server-sdk');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');
const { sendSMS } = require('../services/notifications');

const router = express.Router();
const expo = new Expo();

// ── Push helper ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget Expo push to an array of tokens.
 * Silently skips invalid/missing tokens.
 */
async function sendPushNotifications(tokens, message) {
  const validTokens = tokens.filter((t) => t && Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return;

  const messages = validTokens.map((to) => ({ to, sound: 'default', body: message }));
  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    expo.sendPushNotificationsAsync(chunk).catch((err) => {
      console.error('Expo push error:', err);
    });
  }
}

/**
 * Format a Date as "MMM D, YYYY" (e.g. "Jun 3, 2026").
 */
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET / — list all windows for the facility
router.get('/', facilityAuth, async (req, res) => {
  try {
    const windows = await prisma.availabilityWindow.findMany({
      where: { facilityId: req.facility.id },
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(windows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a window
router.post('/', facilityAuth, async (req, res) => {
  try {
    const { windowName, openDate, closeDate, message, notifyAll } = req.body;

    const open = new Date(openDate);
    const status = open <= new Date() ? 'ACTIVE' : 'DRAFT';

    const window = await prisma.availabilityWindow.create({
      data: {
        facilityId: req.facility.id,
        windowName,
        openDate: open,
        closeDate: new Date(closeDate),
        message: message || null,
        notifyAll: notifyAll ?? false,
        status,
      },
    });

    res.status(201).json(window);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — single window with submission count and submitter list
router.get('/:id', facilityAuth, async (req, res) => {
  try {
    const window = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { submissions: true } },
        submissions: {
          include: {
            provider: { select: { id: true, userId: true } },
          },
        },
      },
    });

    if (!window || window.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(window);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — update a window
router.patch('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { windowName, openDate, closeDate, message, notifyAll, status } = req.body;

    const updated = await prisma.availabilityWindow.update({
      where: { id: req.params.id },
      data: {
        ...(windowName !== undefined && { windowName }),
        ...(openDate !== undefined && { openDate: new Date(openDate) }),
        ...(closeDate !== undefined && { closeDate: new Date(closeDate) }),
        ...(message !== undefined && { message }),
        ...(notifyAll !== undefined && { notifyAll }),
        ...(status !== undefined && { status }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete a window
router.delete('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.availabilityWindow.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/activate — set ACTIVE and push to linked roster providers
router.post('/:id/activate', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const updated = await prisma.availabilityWindow.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' },
    });

    // Fire-and-forget push + SMS notifications
    (async () => {
      try {
        const rosterEntries = await prisma.internalRosterEntry.findMany({
          where: { facilityId: req.facility.id },
          select: { linkedProviderId: true, phoneNumber: true },
        });

        const msg = `${req.facility.name} is now collecting availability for ${existing.windowName}. Please submit by ${formatDate(existing.closeDate)}.`;

        // Push to linked SNAP providers
        const providerIds = rosterEntries.map((e) => e.linkedProviderId).filter(Boolean);
        if (providerIds.length > 0) {
          const profiles = await prisma.providerProfile.findMany({
            where: { id: { in: providerIds }, expoPushToken: { not: null } },
            select: { expoPushToken: true },
          });
          await sendPushNotifications(profiles.map((p) => p.expoPushToken), msg);
        }

        // SMS to all roster members with phone numbers
        await Promise.all(rosterEntries.map((e) => sendSMS(e.phoneNumber, msg)));
      } catch (err) {
        console.error('Activate push/SMS error:', err);
      }
    })();

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/remind — push to linked providers who have NOT submitted
router.post('/:id/remind', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
      include: { submissions: { select: { providerId: true } } },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ success: true, message: 'Reminders queued' });

    // Fire-and-forget after responding
    (async () => {
      try {
        const submittedProviderIds = new Set(existing.submissions.map((s) => s.providerId));

        const rosterEntries = await prisma.internalRosterEntry.findMany({
          where: { facilityId: req.facility.id, linkedProviderId: { not: null } },
          select: { linkedProviderId: true },
        });

        const unsubmittedIds = rosterEntries
          .map((e) => e.linkedProviderId)
          .filter((id) => !submittedProviderIds.has(id));

        if (unsubmittedIds.length === 0) return;

        const profiles = await prisma.providerProfile.findMany({
          where: { id: { in: unsubmittedIds }, expoPushToken: { not: null } },
          select: { expoPushToken: true },
        });

        const tokens = profiles.map((p) => p.expoPushToken);
        const msg = `Reminder: ${req.facility.name} is still collecting availability for ${existing.windowName}. Please submit by ${formatDate(existing.closeDate)}.`;
        await sendPushNotifications(tokens, msg);
      } catch (err) {
        console.error('Remind push error:', err);
      }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/report — submission completion report
router.get('/:id/report', facilityAuth, async (req, res) => {
  try {
    const window = await prisma.availabilityWindow.findUnique({
      where: { id: req.params.id },
      include: { submissions: { select: { providerId: true } } },
    });

    if (!window || window.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const totalRoster = await prisma.internalRosterEntry.count({
      where: { facilityId: req.facility.id },
    });

    const submittedProviderIds = new Set(window.submissions.map((s) => s.providerId));
    const submitted = submittedProviderIds.size;

    // Roster entries with linkedProviderId that have no submission
    const linkedEntries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id, linkedProviderId: { not: null } },
      select: { id: true, providerName: true, linkedProviderId: true },
    });

    const notSubmitted = linkedEntries.filter(
      (e) => !submittedProviderIds.has(e.linkedProviderId)
    );

    const percentComplete =
      totalRoster > 0 ? Math.round((submitted / totalRoster) * 100) : 0;

    res.json({
      windowId: window.id,
      windowName: window.windowName,
      totalRoster,
      submitted,
      notSubmitted,
      percentComplete,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
