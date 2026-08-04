const jwt = require('jsonwebtoken');
const { ROLES } = require('../config/constants');

/**
 * Auth for the trader-facing NGO-side routes (accounts, devices,
 * transactions, generate-license) — replaces the old shared ngo_staff human
 * login. Two ways in:
 *
 *   1. X-Service-Token — a short-lived token backend/ mints per-request for
 *      a real, already-authenticated trader (see backend/src/services/
 *      ngoServiceAuth.js). Verified here with the same SERVICE_AUTH_SECRET.
 *      Sets req.traderId (Number) — never req.user.
 *   2. A real admin's own ngo-backend JWT (Authorization: Bearer …), for the
 *      cross-trader oversight path. Sets req.user as verifyToken always did.
 *
 * A stale ngo_staff human token is deliberately rejected here — that shared
 * login no longer has any path into trader-owned data.
 */
function verifyServiceOrAdmin(req, res, next) {
  const serviceToken = req.headers['x-service-token'];
  if (serviceToken) {
    try {
      const decoded = jwt.verify(serviceToken, process.env.SERVICE_AUTH_SECRET, {
        issuer: 'p2p-backend',
        audience: 'ngo-backend',
      });
      if (decoded.type !== 'service' || !Number.isFinite(decoded.trader_id)) {
        return res.status(401).json({ success: false, message: 'Malformed service token' });
      }
      req.traderId = decoded.trader_id;
      return next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired service token' });
    }
  }

  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Missing service token or Authorization header' });
  }
  try {
    const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
    if (decoded.role !== ROLES.ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: admin only' });
    }
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Query filter for the models below — never returns an unfiltered `{}`
 * unless the caller is a verified admin. A trader-service call always gets
 * exactly `{ traderId: <their own id> }`; an admin may pass ?traderId= to
 * inspect one trader, or omit it to see everyone.
 */
function resolveTraderFilter(req) {
  if (req.traderId != null) return { traderId: req.traderId };
  if (req.user?.role === ROLES.ADMIN) {
    return req.query.traderId ? { traderId: Number(req.query.traderId) } : {};
  }
  return null;
}

/** The trader_id to WRITE onto a newly-created record — admin creates are out of scope (nothing in this app lets an admin create an account/device on a trader's behalf), so this is only ever a real service call. */
function requireTraderId(req, res) {
  if (req.traderId == null) {
    res.status(403).json({ success: false, message: 'Only a trader-authenticated request may do this' });
    return null;
  }
  return req.traderId;
}

module.exports = { verifyServiceOrAdmin, resolveTraderFilter, requireTraderId };
