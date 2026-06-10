const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const auth = require('../middleware/auth');
const { reverseLinkForProvider } = require('../services/rosterLink');

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
