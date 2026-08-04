'use strict';

/**
 * Forwards a real, already-authenticated trader's request through to
 * ngo-backend, minting a fresh short-lived service token per call instead of
 * the old shared ngo_staff login. Mounted (see traderRoutes.js) at
 * /api/trader/ngo-proxy/* under the same verifyToken+checkRole('trader')
 * guard every other trader route uses — req.user is always a real trader
 * here, never anything ngo-backend itself needs to authenticate.
 *
 * `/api/trader/ngo-proxy/<rest>` -> `${NGO_BACKEND_URL}/api/<rest>`,
 * verbatim method/query/body, plus an X-Service-Token header ngo-backend
 * verifies and pulls trader_id from — see ngo-backend/src/middleware/serviceAuth.js.
 */

const axios = require('axios');
const db = require('../models');
const { fail } = require('../utils/http');
const { mintNgoServiceToken } = require('../services/ngoServiceAuth');

// Short-lived token for the trader frontend's direct Socket.IO connection to
// ngo-backend (real-time device-pairing/payment-capture pushes) — verified
// server-side at handshake time so the room a trader lands in is never a
// client-supplied value (see ngo-backend/server.js's io.use()).
const socketToken = async (req, res) => {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) return fail(res, 404, 'Trader profile not found');
  return res.json({ success: true, data: { token: mintNgoServiceToken(trader.id) } });
};

const forward = async (req, res) => {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) return fail(res, 404, 'Trader profile not found');

  const base = process.env.NGO_BACKEND_URL || 'http://localhost:3000';
  const targetPath = req.originalUrl.replace(/^\/api\/trader\/ngo-proxy/, '/api');
  const serviceToken = mintNgoServiceToken(trader.id);

  try {
    const upstream = await axios({
      method: req.method,
      url: base + targetPath,
      data: req.body,
      headers: { 'X-Service-Token': serviceToken },
      validateStatus: () => true, // relay ngo-backend's own status/body verbatim
    });
    return res.status(upstream.status).json(upstream.data);
  } catch (err) {
    return fail(res, 502, 'ngo-backend unreachable: ' + err.message);
  }
};

module.exports = { forward, socketToken };
