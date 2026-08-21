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
const payoutService = require('../services/payoutService');
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
  const { upi_ids, device_id, trader_id, amount, utr, event_time, payer_name, payer_upi, source, receiving_platform, receiving_bank_code } = req.body || {};

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
    // BUG-58 — which sibling account the capture landed on, when one device
    // backs several. A notification names the app (receiving_platform); an SMS
    // names the bank (receiving_bank_code, matched against the declared
    // bank_name). Both null → the gateway holds rather than guess.
    receivingPlatform: receiving_platform || null,
    receivingBankCode: receiving_bank_code || null,
  });

  if (!result.matched && result.reason === 'duplicate_utr') {
    return res.status(409).json({ success: false, message: 'This UTR has already settled a different order', ...result });
  }

  return res.json({ success: true, ...result });
}));

// POST /api/internal/order-upis — called by ngo-backend when it lists a
// trader's captured transactions, to say which of the trader's own UPIs each
// settled order landed in. That mapping only exists here (orders and
// payment_details are this service's tables), and resolving it at read time
// rather than storing it on the capture means rows settled before this
// existed resolve too.
// Body: { order_ids: number[] }
//   ->  { upis:  { "<order id>": "<upi id>" },
//        uuids: { "<order id>": "<order uuid>" } }
//
// `uuids` exists because the trader panel shows an order's UUID as its
// "Transaction ID" everywhere else (Trades reads orderView's `order_id`, which
// is order.uuid — see orderController.js), while a capture only ever carries
// the numeric id matchingEngineV2 returns. The two pages therefore labelled the
// same order with two different-looking identifiers and looked like unrelated
// records. Returned as a separate map rather than folded into `upis` so an
// older ngo-backend keeps working through a staggered deploy.
router.post('/order-upis', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.order_ids)
    ? req.body.order_ids.map(Number).filter(Number.isFinite).slice(0, 500)
    : [];
  if (!ids.length) return res.json({ success: true, upis: {}, uuids: {} });

  const orders = await db.Order.findAll({
    where: { id: ids },
    attributes: ['id', 'uuid'],
    include: [{ model: db.PaymentDetail, as: 'paymentDetail', attributes: ['upi_id'] }],
  });

  const upis = {};
  const uuids = {};
  orders.forEach((o) => {
    if (o.paymentDetail && o.paymentDetail.upi_id) upis[o.id] = o.paymentDetail.upi_id;
    if (o.uuid) uuids[o.id] = o.uuid;
  });
  return res.json({ success: true, upis, uuids });
}));

// POST /api/internal/match-payout-evidence — REDESIGN: the device captures a
// success screen and (via ngo) sends the raw extracted fields here. The gateway
// is the authority: it matches them against this trader's REAL in_processing
// payouts and enforces the global receipt (UTR) single-use lock, so the phone's
// local state can never gate or mis-route a capture. See payoutService.
// Body: { traderId, extractedFields }
//   ->  { matched:false, reason, message } | { matched:true, ambiguous, orderId, orderUuids, message }
router.post('/match-payout-evidence', asyncHandler(async (req, res) => {
  const { traderId, extractedFields } = req.body || {};
  if (traderId == null || !Number.isFinite(Number(traderId))) {
    return res.status(400).json({ success: false, message: 'traderId is required' });
  }
  const result = await payoutService.matchCapturedEvidence(Number(traderId), extractedFields);
  return res.json({ success: true, ...result });
}));

module.exports = router;
