const express = require('express');
const prisma = require('../config/db');
const facilityAuth = require('../middleware/facilityAuth');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve whether a snapAccountEmail is linked to a registered SNAP provider.
 * Returns { snapAccountLinked, linkedProviderId } ready to merge into a update.
 */
async function resolveLinkFields(email) {
  if (!email) return { snapAccountLinked: false, linkedProviderId: null };

  const user = await prisma.user.findUnique({
    where: { email },
    include: { providerProfile: { select: { id: true } } },
  });

  if (user?.providerProfile) {
    return { snapAccountLinked: true, linkedProviderId: user.providerProfile.id };
  }
  return { snapAccountLinked: false, linkedProviderId: null };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET / — list all roster entries for the facility
router.get('/', facilityAuth, async (req, res) => {
  try {
    const entries = await prisma.internalRosterEntry.findMany({
      where: { facilityId: req.facility.id },
      orderBy: { providerName: 'asc' },
    });
    res.json(entries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a roster entry
router.post('/', facilityAuth, async (req, res) => {
  try {
    const {
      providerName,
      providerType,
      employmentCategory,
      snapAccountEmail,
      phoneNumber,
      licenseNumber,
      licenseExpiration,
      notes,
    } = req.body;

    const linkFields = await resolveLinkFields(snapAccountEmail);

    const entry = await prisma.internalRosterEntry.create({
      data: {
        facilityId: req.facility.id,
        providerName,
        providerType,
        employmentCategory,
        snapAccountEmail: snapAccountEmail || null,
        phoneNumber: phoneNumber || null,
        licenseNumber: licenseNumber || null,
        licenseExpiration: licenseExpiration ? new Date(licenseExpiration) : null,
        notes: notes || null,
        ...linkFields,
      },
    });

    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — partial update a roster entry
router.patch('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const {
      providerName,
      providerType,
      employmentCategory,
      snapAccountEmail,
      phoneNumber,
      licenseNumber,
      licenseExpiration,
      notes,
    } = req.body;

    // Re-check linkage if email is being changed
    let linkFields = {};
    if (snapAccountEmail !== undefined) {
      linkFields = await resolveLinkFields(snapAccountEmail);
    }

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: {
        ...(providerName !== undefined && { providerName }),
        ...(providerType !== undefined && { providerType }),
        ...(employmentCategory !== undefined && { employmentCategory }),
        ...(snapAccountEmail !== undefined && { snapAccountEmail }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(licenseNumber !== undefined && { licenseNumber }),
        ...(licenseExpiration !== undefined && {
          licenseExpiration: licenseExpiration ? new Date(licenseExpiration) : null,
        }),
        ...(notes !== undefined && { notes }),
        ...linkFields,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete a roster entry
router.delete('/:id', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.internalRosterEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/invite — mark invite sent, auto-link if provider found
router.post('/:id/invite', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const linkFields = await resolveLinkFields(existing.snapAccountEmail);

    // TODO: send SMS/email via Twilio (Phase 2)

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: {
        inviteSentAt: new Date(),
        ...linkFields,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/link-check — check SNAP account registration and auto-link
router.post('/:id/link-check', facilityAuth, async (req, res) => {
  try {
    const existing = await prisma.internalRosterEntry.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.facilityId !== req.facility.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const linkFields = await resolveLinkFields(existing.snapAccountEmail);

    const updated = await prisma.internalRosterEntry.update({
      where: { id: req.params.id },
      data: linkFields,
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
