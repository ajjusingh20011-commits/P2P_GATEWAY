'use strict';

/**
 * Internal service-to-service routes — mounted at /api/internal.
 * Unauthenticated, same trust model as ngo-backend's POST /api/checkout/verify
 * (called the other direction from orderController.js): both services run on
 * a private network in this deployment, and these endpoints only ever
 * disclose a boolean, never a record.
 */

const { Router } = require('express');
const db = require('../models');
const { asyncHandler } = require('../utils/http');
const matchingEngineV2 = require('../services/matchingEngineV2');

const router = Router();

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
// Body: { upi_ids: string[]|string, amount, utr?, event_time?, payer_name?, payer_upi?, source }
router.post('/match-settlement', asyncHandler(async (req, res) => {
  const { upi_ids, amount, utr, event_time, payer_name, payer_upi, source } = req.body || {};

  const result = await matchingEngineV2.matchAndSettle({
    upiIds: upi_ids,
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
