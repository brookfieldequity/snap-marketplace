const jwt = require('jsonwebtoken');
const { assertSession } = require('../services/authSessions');
const { audienceOf, sendSessionExpired } = require('./sessionUtil');

// Admin JWT verify + server-side session check (Security HIGH-1).
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
  if (payload.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    await assertSession(payload.jti);
  } catch {
    return sendSessionExpired(res, 'ADMIN');
  }
  req.user = payload;
  next();
};
