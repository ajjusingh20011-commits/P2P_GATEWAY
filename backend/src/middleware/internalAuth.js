'use strict';

/**
 * Auth for this service's /api/internal/* routes.
 *
 * These were previously unauthenticated on the stated assumption that both
 * services "run on a private network". That assumption did not hold: with the
 * API published at a public hostname, /api/internal/upi-check and
 * /api/internal/match-settlement were both reachable and answering from the
 * open internet. match-settlement is not a read — it settles orders and moves
 * balances — so an unauthenticated caller could drive real settlements.
 *
 * Rather than depend on correct reverse-proxy configuration (which lives
 * outside this repo and fails open if it is ever wrong), this reuses the
 * signing scheme already established for cross-service calls: an HS256 JWT
 * over the shared SERVICE_AUTH_SECRET, carried in X-Service-Token. Here the
 * peer is ngo-backend, so issuer/audience are the reverse of the trader-facing
 * direction (see services/ngoServiceAuth.js).
 *
 * Nginx-level IP restriction remains worth adding as defence in depth, but it
 * is not what makes this safe.
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function verifyInternalService(req, res, next) {
  const secret = process.env.SERVICE_AUTH_SECRET;
  if (!secret) {
    // Fail closed. A missing secret must never mean "let everyone in".
    logger.error('internalAuth: SERVICE_AUTH_SECRET is not set — rejecting internal call');
    return res.status(503).json({ success: false, message: 'Internal service auth is not configured' });
  }

  const token = req.headers['x-service-token'];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing service token' });
  }

  try {
    const decoded = jwt.verify(token, secret, { issuer: 'ngo-backend', audience: 'p2p-backend' });
    if (decoded.type !== 'internal') {
      // A trader-scoped 'service' token is deliberately not accepted here:
      // these endpoints act platform-wide and must not be reachable with a
      // token minted for one trader's session.
      return res.status(401).json({ success: false, message: 'Wrong token type for an internal call' });
    }
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired service token' });
  }
}

module.exports = { verifyInternalService };
