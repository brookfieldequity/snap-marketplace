const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
