'use strict';

/**
 * Mints short-lived signed tokens proving a request to ngo-backend genuinely
 * originated from this backend on behalf of an already-authenticated real
 * trader — replaces the old shared ngo_staff human login. ngo-backend
 * verifies the signature with the same SERVICE_AUTH_SECRET and trusts the
 * trader_id inside; it's never told an ngoId or any human credential.
 */

const jwt = require('jsonwebtoken');

const SERVICE_TOKEN_TTL = '5m';
// Service-to-service internal calls are immediate; they never need a long
// window, and a short one limits the value of a leaked token.
const INTERNAL_TOKEN_TTL = '2m';

// Fail loudly rather than signing/verifying with `undefined`, which jsonwebtoken
// would otherwise turn into a confusing downstream error — and which must never
// be allowed to degrade into "no authentication".
function secret() {
  const s = process.env.SERVICE_AUTH_SECRET;
  if (!s) throw new Error('SERVICE_AUTH_SECRET is not set — refusing to issue a service token');
  return s;
}

function mintNgoServiceToken(traderId) {
  return jwt.sign(
    { trader_id: traderId, type: 'service' },
    secret(),
    { expiresIn: SERVICE_TOKEN_TTL, issuer: 'p2p-backend', audience: 'ngo-backend' }
  );
}

/**
 * Token for ngo-backend's /api/internal/* routes. Distinct `type` from the
 * per-trader 'service' token above: these endpoints act for the platform, not
 * on behalf of any one trader, so there is no trader_id to carry and none
 * should be trusted from them.
 */
function mintInternalServiceToken() {
  return jwt.sign(
    { type: 'internal' },
    secret(),
    { expiresIn: INTERNAL_TOKEN_TTL, issuer: 'p2p-backend', audience: 'ngo-backend' }
  );
}

/** Header both token kinds travel in. */
const internalAuthHeaders = () => ({ 'X-Service-Token': mintInternalServiceToken() });

module.exports = { mintNgoServiceToken, mintInternalServiceToken, internalAuthHeaders };
