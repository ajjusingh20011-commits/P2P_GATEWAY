'use strict';

/**
 * Auth for this service's /api/internal/* routes, plus the minting side for
 * the calls this service makes to the P2P backend's own /api/internal/*.
 *
 * These routes were previously unauthenticated on the stated assumption that
 * both services "run on a private network". With the APIs published at public
 * hostnames that assumption did not hold. Even where a route only returns a
 * boolean, /api/internal/upi-check is an oracle that confirms whether a given
 * UPI ID is registered on the platform, and /connection-liveness enumerates
 * real UPI IDs and device identifiers — neither belongs on the open internet.
 *
 * Same scheme as the trader-facing service token (middleware/serviceAuth.js):
 * an HS256 JWT over the shared SERVICE_AUTH_SECRET in X-Service-Token. The
 * issuer/audience pair encodes direction, so a token minted for one leg cannot
 * be replayed on the other.
 */

const jwt = require('jsonwebtoken');

const INTERNAL_TOKEN_TTL = '2m';

function secret() {
  const s = process.env.SERVICE_AUTH_SECRET;
  if (!s) throw new Error('SERVICE_AUTH_SECRET is not set — refusing to issue a service token');
  return s;
}

/** Token for calls THIS service makes to the P2P backend's internal routes. */
function mintInternalServiceToken() {
  return jwt.sign(
    { type: 'internal' },
    secret(),
    { expiresIn: INTERNAL_TOKEN_TTL, issuer: 'ngo-backend', audience: 'p2p-backend' }
  );
}

const internalAuthHeaders = () => ({ 'X-Service-Token': mintInternalServiceToken() });

/** Guard for calls the P2P backend makes to THIS service's internal routes. */
function verifyInternalService(req, res, next) {
  const s = process.env.SERVICE_AUTH_SECRET;
  if (!s) {
    // Fail closed — a missing secret must never mean "let everyone in".
    console.error('internalAuth: SERVICE_AUTH_SECRET is not set — rejecting internal call');
    return res.status(503).json({ success: false, message: 'Internal service auth is not configured' });
  }

  const token = req.headers['x-service-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Missing service token' });

  try {
    const decoded = jwt.verify(token, s, { issuer: 'p2p-backend', audience: 'ngo-backend' });
    if (decoded.type !== 'internal') {
      // A per-trader 'service' token is deliberately rejected: these routes
      // answer platform-wide questions and must not be reachable with a token
      // minted for one trader's panel session.
      return res.status(401).json({ success: false, message: 'Wrong token type for an internal call' });
    }
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired service token' });
  }
}

module.exports = { verifyInternalService, mintInternalServiceToken, internalAuthHeaders };
