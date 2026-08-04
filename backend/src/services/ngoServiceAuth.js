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

function mintNgoServiceToken(traderId) {
  return jwt.sign(
    { trader_id: traderId, type: 'service' },
    process.env.SERVICE_AUTH_SECRET,
    { expiresIn: SERVICE_TOKEN_TTL, issuer: 'p2p-backend', audience: 'ngo-backend' }
  );
}

module.exports = { mintNgoServiceToken };
