'use strict';

/**
 * Authentication & authorization middleware.
 *
 *   verifyToken       -> validates the Bearer access token (and blacklist)
 *   checkRole(...r)   -> restricts a route to the given role(s)
 */

const authService = require('../services/authService');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function verifyToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Missing access token' });
    }

    let decoded;
    try {
      decoded = authService.verifyAccessToken(token);
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        message: expired ? 'Access token expired' : 'Invalid access token',
        code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });
    }

    if (decoded.jti && (await authService.isAccessBlacklisted(decoded.jti))) {
      return res.status(401).json({ success: false, message: 'Token has been revoked' });
    }

    req.user = { id: decoded.sub, role: decoded.role, jti: decoded.jti, exp: decoded.exp };
    return next();
  } catch (err) {
    return next(err);
  }
}

function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = { verifyToken, checkRole };
