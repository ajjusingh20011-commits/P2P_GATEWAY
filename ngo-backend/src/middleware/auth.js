const jwt = require('jsonwebtoken');

/**
 * Reads a Bearer token from the Authorization header, verifies it with
 * JWT_SECRET, and attaches the decoded payload to req.user.
 */
function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res
      .status(401)
      .json({ success: false, message: 'Missing or malformed Authorization header' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Restricts a route to the given roles. Must run after verifyToken.
 * @param {...string} roles allowed role names
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, message: 'Forbidden: insufficient role' });
    }
    return next();
  };
}

module.exports = { verifyToken, requireRole };
