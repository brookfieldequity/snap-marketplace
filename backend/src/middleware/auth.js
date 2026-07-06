const jwt = require('jsonwebtoken');
const { assertSession } = require('../services/authSessions');
const { audienceOf, sendSessionExpired } = require('./sessionUtil');

// Generic JWT verify + server-side session check (Security HIGH-1). Tokens
// without a live AuthSession (including all pre-session jti-less tokens) are
// rejected — expiry and revocation are enforced in the database, not just
// inside the signed token.
module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return sendSessionExpired(res, audienceOf(jwt.decode(token)));
  }
  try {
    await assertSession(payload.jti);
  } catch {
    return sendSessionExpired(res, audienceOf(payload));
  }
  req.user = payload;
  next();
};
