const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { assertSession } = require('../services/authSessions');
const { audienceOf, sendSessionExpired } = require('./sessionUtil');

// Facility JWT verify + server-side session check (Security HIGH-1), then the
// existing membership load (req.facility / req.facilityRole).
module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = header.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return sendSessionExpired(res, audienceOf(jwt.decode(token)));
  }
  if (payload.role !== 'FACILITY_USER') {
    return res.status(403).json({ error: 'Facility access required' });
  }
  try {
    await assertSession(payload.jti);
  } catch {
    return sendSessionExpired(res, 'FACILITY');
  }
  try {
    const membership = await prisma.facilityUser.findFirst({
      where: { userId: payload.userId },
      include: { facility: { include: { subscription: true } } },
    });
    if (!membership) {
      return res.status(403).json({ error: 'No facility associated' });
    }
    req.user = payload;
    req.facility = membership.facility;
    req.facilityRole = membership.facilityRole;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
