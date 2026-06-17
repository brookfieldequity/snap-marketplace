const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const { reverseLinkForProvider } = require('../services/rosterLink');
const { sendEmail } = require('../services/notifications');

const router = express.Router();

const CONTACT_PATTERN = /(\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|@[a-zA-Z0-9.]+\.[a-zA-Z]{2,})/;

function parseLicenseExpiry(val) {
  if (!val) return undefined;
  // Accept MM/YYYY → first day of that month
  const mmyyyy = val.match(/^(\d{2})\/(\d{4})$/);
  if (mmyyyy) return new Date(`${mmyyyy[2]}-${mmyyyy[1]}-01`);
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

function calcProfilePct(profile) {
  const fields = [
    profile.firstName, profile.lastName, profile.specialty,
    profile.yearsExperience, profile.city, profile.photoUrl,
    profile.maLicenseNumber, profile.personalStatement,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

// ── Provider registration ─────────────────────────────────────────────────────

router.post('/provider/register', async (req, res) => {
  try {
    const {
      email, password, firstName, lastName, specialty,
      yearsExperience, city, zipCode, maLicenseNumber, maLicenseExpiry,
      maLicenseAcknowledged, pin,
    } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!maLicenseAcknowledged) return res.status(400).json({ error: 'Massachusetts license acknowledgment required' });
    if (!pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'A 4-digit PIN is required' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashedPw = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(pin, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPw,
        role: 'PROVIDER',
        providerProfile: {
          create: {
            firstName, lastName,
            specialty: specialty || undefined,
            yearsExperience: yearsExperience ? parseInt(yearsExperience) : undefined,
            city,
            zipCode,
            maLicenseNumber,
            maLicenseExpiry: maLicenseExpiry ? parseLicenseExpiry(maLicenseExpiry) : undefined,
            maLicenseAcknowledged: !!maLicenseAcknowledged,
            pin: hashedPin,
            profileCompletePct: 20,
          },
        },
      },
      include: { providerProfile: true },
    });

    const pct = calcProfilePct(user.providerProfile);
    await prisma.providerProfile.update({
      where: { id: user.providerProfile.id },
      data: { profileCompletePct: pct },
    });

    // Stitch this newly-registered provider to any roster row a facility
    // already imported for them (matched by NPI or email). Idempotent +
    // non-fatal — never block registration if it errors.
    reverseLinkForProvider({
      id: user.providerProfile.id,
      userEmail: user.email,
      npiNumber: user.providerProfile.npiNumber || null,
    }).catch((e) => console.error('[auth] reverse-link on register failed:', e.message));

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, profileId: user.providerProfile.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ token, user: { id: user.id, email: user.email, profileId: user.providerProfile.id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Provider login ────────────────────────────────────────────────────────────

router.post('/provider/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { providerProfile: true },
    });
    if (!user || user.role !== 'PROVIDER') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Award daily login VIP point
    if (user.providerProfile) {
      const today = new Date().toDateString();
      const lastLogin = user.providerProfile.lastLoginAt?.toDateString();
      if (lastLogin !== today) {
        await prisma.providerProfile.update({
          where: { id: user.providerProfile.id },
          data: {
            lastLoginAt: new Date(),
            vipPoints: { increment: 1 },
          },
        });
        await prisma.vIPPointsLog.create({
          data: { providerId: user.providerProfile.id, points: 1, reason: 'DAILY_LOGIN' },
        });
      }
    }

    // Stitch this provider to any roster row a facility added (or updated
    // NPI on) since the last login. Idempotent + non-fatal — never block
    // login if it errors.
    if (user.providerProfile) {
      reverseLinkForProvider({
        id: user.providerProfile.id,
        userEmail: user.email,
        npiNumber: user.providerProfile.npiNumber || null,
      }).catch((e) => console.error('[auth] reverse-link on login failed:', e.message));
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, profileId: user.providerProfile?.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user: { id: user.id, email: user.email, profileId: user.providerProfile?.id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Facility registration — RETIRED (Task #12) ─────────────────────────────────
// Facility self-registration is replaced by the admin-initiated invite + claim
// flow (snap-applications/capa-pilot/facility-invite-spec.md). Self-register was
// the source of the orphan-User bug Ryan hit. SNAP Admin now creates the
// facility and invites the coordinator; this endpoint is disabled.
router.post('/facility/register', async (req, res) => {
  return res.status(410).json({
    error: 'Self-registration is no longer available. Facilities are set up by the SNAP team, who send an invite to set your password. Contact matt@snapmedical.app to get started.',
  });
});

// Legacy handler retained below the early-return for reference; never reached.
router.post('/_facility/register-legacy', async (req, res) => {
  try {
    const { email, password, facilityName, facilityType, address, zipCode, tier } = req.body;
    if (!email || !password || !facilityName) {
      return res.status(400).json({ error: 'Email, password, and facility name required' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'FACILITY_USER',
      },
    });

    const facility = await prisma.facility.create({
      data: {
        name: facilityName,
        facilityType,
        address,
        zipCode,
        state: 'MA',
        users: { create: { userId: user.id, facilityRole: 'ADMIN' } },
        subscription: { create: { tier: tier || 'BASIC' } },
      },
      include: { subscription: true },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'FACILITY_USER', facilityId: facility.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ token, user: { id: user.id, email: user.email }, facility: { id: facility.id, name: facility.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Facility login ────────────────────────────────────────────────────────────

router.post('/facility/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { facilityMemberships: { include: { facility: true } } },
    });
    if (!user || user.role !== 'FACILITY_USER') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const membership = user.facilityMemberships[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'FACILITY_USER', facilityId: membership?.facilityId },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email },
      facility: membership ? { id: membership.facility.id, name: membership.facility.name } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Admin login ───────────────────────────────────────────────────────────────

router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'ADMIN' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Forgot password — request a reset code ─────────────────────────────────────

const GENERIC_FORGOT_MESSAGE =
  "If an account exists for that email, we've sent a 6-digit reset code.";

function resetCodeEmailHtml(code) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #E2E8F0">
<tr><td style="background:#6366F1;padding:24px 32px;border-radius:16px 16px 0 0">
  <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.02em">SNAP Medical</span>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0F172A">Password reset code</h2>
  <div style="font-size:14px;color:#374151;line-height:1.6">
    <p>Use the code below to reset your SNAP password:</p>
    <div style="margin:24px 0;text-align:center">
      <span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:10px;color:#0F172A;background:#F1F5F9;border-radius:12px;padding:16px 28px">${code}</span>
    </div>
    <p>This code expires in <strong>15 minutes</strong>.</p>
    <p>If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
  </div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #F1F5F9;font-size:11px;color:#94A3B8">
    SNAP Medical Marketplace · Massachusetts
  </div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.json({ ok: true, message: GENERIC_FORGOT_MESSAGE });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Always respond generically — never reveal whether the account exists.
    if (!user) {
      return res.json({ ok: true, message: GENERIC_FORGOT_MESSAGE });
    }

    const now = new Date();

    // Rate-limit: if an active code was issued in the last 60s, don't issue
    // another one (but still respond with the generic success).
    const recent = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        used: false,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      return res.json({ ok: true, message: GENERIC_FORGOT_MESSAGE });
    }

    // Invalidate any prior unused codes for this user.
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        attempts: 0,
        used: false,
      },
    });

    await sendEmail(user.email, 'Your SNAP password reset code', resetCodeEmailHtml(code));

    return res.json({ ok: true, message: GENERIC_FORGOT_MESSAGE });
  } catch (err) {
    console.error('[auth] forgot-password failed:', err);
    return res.status(500).json({ error: 'Could not process request. Please try again.' });
  }
});

// ── Reset password — verify code + set new password ────────────────────────────

router.post('/reset-password', async (req, res) => {
  try {
    const { code, newPassword } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const reset = await prisma.passwordReset.findFirst({
      where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const attempts = reset.attempts + 1;

    // Too many attempts → burn the code and force a new request.
    if (attempts > 5) {
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts, used: true },
      });
      return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
    }

    const valid = await bcrypt.compare(String(code), reset.codeHash);
    if (!valid) {
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts },
      });
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const hashedPw = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashedPw } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts, used: true } }),
    ]);

    return res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error('[auth] reset-password failed:', err);
    return res.status(500).json({ error: 'Could not process request. Please try again.' });
  }
});

// ── Verify PIN ────────────────────────────────────────────────────────────────

router.post('/provider/verify-pin', auth, async (req, res) => {
  try {
    const { pin } = req.body;
    const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile?.pin) return res.status(400).json({ error: 'PIN not set' });
    const valid = await bcrypt.compare(String(pin), profile.pin);
    res.json({ valid });
  } catch (err) {
    res.status(500).json({ error: 'PIN verification failed' });
  }
});

module.exports = router;
