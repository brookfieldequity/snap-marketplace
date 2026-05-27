const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (payload.role !== 'FACILITY_USER') {
      return res.status(403).json({ error: 'Facility access required' });
    }
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
