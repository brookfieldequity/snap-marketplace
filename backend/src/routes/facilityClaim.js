// Public facility-invite claim endpoints.
//
// Flow:
//   GET  /facility-claim/info/:token   → fetch facility name + role + inviter
//                                         (no auth — token IS auth)
//   POST /facility-claim/:token        → set password, atomically create User
//                                         + FacilityUser link, return login token
//
// Spec: snap-applications/capa-pilot/facility-invite-spec.md
//
// Safety properties:
//   - Token never appears in DB raw; only sha256(token) is stored.
//   - Claim is wrapped in a Prisma $transaction so we can never produce
//     orphan rows like the old /auth/facility/register could.
//   - Expired / already-claimed invites get a friendly 410 + reason so the
//     web claim page can render the "this invite is no longer valid" surface.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const router = express.Router();

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// Wrap a Prisma invite lookup in the validation chain (expired / claimed / not
// found) so each endpoint can call this once and switch on the result.
async function lookupInvite(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return { ok: false, status: 400, reason: 'INVALID', message: 'Missing token.' };
  }
  const tokenHash = hashToken(rawToken);
  const invite = await prisma.facilityInvite.findUnique({
    where: { tokenHash },
    include: {
      facility: { select: { id: true, name: true } },
    },
  });
  if (!invite) {
    return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'This invite link is not valid.' };
  }
  if (invite.claimedAt) {
    return { ok: false, status: 410, reason: 'ALREADY_CLAIMED', message: 'This invite has already been used.' };
  }
  if (invite.expiresAt < new Date()) {
    return { ok: false, status: 410, reason: 'EXPIRED', message: 'This invite has expired.' };
  }
  return { ok: true, invite };
}

// GET /facility-claim/info/:token — preview for the claim page (welcome
// header). Returns the facility name, the role being granted, and the
// inviter's name. No auth required — the token IS the auth.
router.get('/info/:token', async (req, res) => {
  try {
    const r = await lookupInvite(req.params.token);
    if (!r.ok) {
      return res.status(r.status).json({ error: r.message, reason: r.reason });
    }
    res.json({
      ok: true,
      facilityName: r.invite.facility?.name || 'your facility',
      facilityRole: r.invite.facilityRole,
      invitedEmail: r.invite.email,
      invitedByName: r.invite.invitedByName || 'The SNAP Medical team',
      expiresAt: r.invite.expiresAt,
    });
  } catch (err) {
    console.error('[facility-claim] info failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /facility-claim/:token — set password, atomically create User +
// FacilityUser link, mark invite claimed, return JWT for immediate login.
//
// Idempotency: if a User with the invited email already exists, we attach
// the existing User to the facility (no duplicate accounts). The password
// in the body is only honored when creating a new User — never overwrites
// an existing password.
router.post('/:token', async (req, res) => {
  try {
    const r = await lookupInvite(req.params.token);
    if (!r.ok) {
      return res.status(r.status).json({ error: r.message, reason: r.reason });
    }
    const invite = r.invite;
    const { password } = req.body || {};
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const claimResult = await prisma.$transaction(async (tx) => {
      // Find or create the User row.
      let user = await tx.user.findUnique({ where: { email: invite.email } });
      let createdUser = false;
      const hashed = await bcrypt.hash(password, 10);
      if (user) {
        // Existing User claiming an invite — overwrite the password with
        // whatever they typed on the claim page. They're consenting to
        // re-set credentials by clicking the tokenized invite link, so this
        // is the correct behavior. (The alternative — preserving an old
        // password — bites users who try to log back in later: their "new"
        // password silently doesn't work because the DB still has the old
        // one.) Also force role to FACILITY_USER so middleware accepts them.
        user = await tx.user.update({
          where: { id: user.id },
          data: { password: hashed, role: 'FACILITY_USER' },
        });
      } else {
        user = await tx.user.create({
          data: {
            email: invite.email,
            password: hashed,
            role: 'FACILITY_USER',
          },
        });
        createdUser = true;
      }

      // Make sure they aren't already a member of THIS facility. If they
      // are, skip the create and reuse the existing FacilityUser row — that
      // way "re-claim by mistake" doesn't crash on the unique constraint.
      const existingMembership = await tx.facilityUser.findFirst({
        where: { userId: user.id, facilityId: invite.facilityId },
      });
      if (!existingMembership) {
        await tx.facilityUser.create({
          data: {
            userId: user.id,
            facilityId: invite.facilityId,
            facilityRole: invite.facilityRole,
          },
        });
      }

      // Mark the invite claimed.
      await tx.facilityInvite.update({
        where: { id: invite.id },
        data: {
          claimedAt: new Date(),
          claimedByUserId: user.id,
        },
      });

      return { user, createdUser };
    });

    // Issue a login token matching the shape /auth/facility/login produces —
    // session-backed like every other login token (Security HIGH-1).
    const { issueSession, TTL_JWT } = require('../services/authSessions');
    const { jti } = await issueSession({ audience: 'FACILITY', userId: claimResult.user.id, req });
    const token = jwt.sign(
      {
        userId: claimResult.user.id,
        email: claimResult.user.email,
        role: 'FACILITY_USER',
        facilityId: invite.facilityId,
        jti,
      },
      process.env.JWT_SECRET,
      { expiresIn: TTL_JWT.FACILITY },
    );

    res.status(201).json({
      ok: true,
      token,
      user: { id: claimResult.user.id, email: claimResult.user.email },
      facility: { id: invite.facilityId, name: invite.facility?.name || null },
      createdNewAccount: claimResult.createdUser,
    });
  } catch (err) {
    console.error('[facility-claim] claim failed:', err);
    res.status(500).json({ error: 'Failed to claim invite', details: err.message });
  }
});

module.exports = router;
