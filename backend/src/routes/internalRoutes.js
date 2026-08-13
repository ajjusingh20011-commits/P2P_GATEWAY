'use strict';

/**
 * Internal service-to-service routes — mounted at /api/internal.
 *
 * Every route here requires a signed X-Service-Token from ngo-backend (see
 * middleware/internalAuth.js). They used to be unauthenticated on the premise
 * that both services sit on a private network; with the API published at a
 * public hostname that premise was false, and both endpoints below were
 * answering unauthenticated requests from the internet. match-settlement in
 * particular settles orders and moves balances.
 */

const { Router } = require('express');
const db = require('../models');
const { asyncHandler } = require('../utils/http');
const matchingEngineV2 = require('../services/matchingEngineV2');
const { verifyInternalService } = require('../middleware/internalAuth');

const router = Router();

// Applied at the router, not per-route, so a future endpoint added to this
// file cannot accidentally ship unauthenticated.
router.use(verifyInternalService);

// GET /api/internal/upi-check?upi_id=X — used by ngo-backend before creating
// an Account, to enforce UPI uniqueness across both databases.
router.get('/upi-check', asyncHandler(async (req, res) => {
  const upiId = String(req.query.upi_id || '').trim();
  if (!upiId) return res.json({ exists: false });
  const existing = await db.PaymentDetail.findOne({ where: { upi_id: upiId }, attributes: ['id'] });
  return res.json({ exists: !!existing });
}));

// POST /api/internal/match-settlement — called by ngo-backend for every
// receiver-side payment event (APK notification, scraped transaction) to
// find and settle the matching open order. See services/matchingEngineV2.js.
// Body: { upi_ids?: string[]|string, device_id?, trader_id?, amount, utr?, event_time?, payer_name?, payer_upi?, source }
//
// One of upi_ids / device_id / trader_id is required. The APK path sends both
// device_id and trader_id: matchingEngineV2 scopes to the device's own UPI(s)
// first (device_id -> payment_details.ngo_device_id) and only falls back to
// the trader's full UPI set if the device isn't linked to any UPI. The scraper
// sends upi_ids (it knows the exact receiving account, strictly most precise).
// Historically the APK path sent trader_id and
// lets matchingEngineV2 resolve the UPI list from payment_details here — it
// used to send a list resolved from ngo-backend's Mongo Account collection,
// which only covers Web Login accounts and so never contained an APK-linked
// UPI (BUG-30). The scraper still sends upi_ids: it knows the exact receiving
// account, which is strictly more precise.
router.post('/match-settlement', asyncHandler(async (req, res) => {
  const { upi_ids, device_id, trader_id, amount, utr, event_time, payer_name, payer_upi, source } = req.body || {};

  const result = await matchingEngineV2.matchAndSettle({
    upiIds: upi_ids,
    deviceId: device_id,
    traderId: trader_id,
    amount,
    utr,
    eventTimestamp: event_time,
    payerName: payer_name,
    payerUpi: payer_upi,
    source,
  });

  if (!result.matched && result.reason === 'duplicate_utr') {
    return res.status(409).json({ success: false, message: 'This UTR has already settled a different order', ...result });
  }

  return res.json({ success: true, ...result });
}));

module.exports = router;
