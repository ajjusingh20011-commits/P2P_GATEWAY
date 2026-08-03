'use strict';

/**
 * Internal service-to-service routes — mounted at /api/internal.
 * Unauthenticated, same trust model as POST /api/checkout/verify: both
 * services run on a private network in this deployment, and this endpoint
 * only ever discloses a boolean, never a record.
 */

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');

const router = express.Router();

// GET /api/internal/upi-check?upi_id=X[&exclude_account_id=Y] — used by the
// P2P gateway backend before creating/updating a payment_details row, to
// enforce UPI uniqueness across both databases.
//
// `exclude_account_id` is for the payment_details mirror the trader
// frontend keeps for every NGO/web-login account (syncNgoAccountToPaymentDetail):
// that mirror's own source account already exists here with the same UPI,
// so without excluding it this check always found "itself" and rejected
// every new Web Login account's mirror sync as a false-positive duplicate.
router.get('/upi-check', async (req, res, next) => {
  try {
    const upiId = String(req.query.upi_id || '').trim();
    if (!upiId) return res.json({ exists: false });
    const query = { upiId };
    const excludeId = req.query.exclude_account_id;
    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      query._id = { $ne: excludeId };
    }
    const existing = await Account.findOne(query).select('_id');
    return res.json({ exists: !!existing });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
