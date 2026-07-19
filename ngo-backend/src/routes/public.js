const express = require('express');
const Payout = require('../models/Payout');

const router = express.Router();

/**
 * Public, unauthenticated transparency API. Exposes an NGO's verified payouts
 * with NO sensitive fields (no account numbers, no UPI ids, no screenshots).
 */

/**
 * GET /api/public/payouts/:ngoId — verified public payouts for an NGO.
 */
router.get('/payouts/:ngoId', async (req, res, next) => {
  try {
    const payouts = await Payout.find({
      ngoId: req.params.ngoId,
      overallVerified: true,
      isPublic: true,
    })
      .sort({ createdAt: -1 })
      .select(
        'recipientName amount purpose paymentApp overallVerified verificationLayers createdAt hash -_id'
      )
      .lean();

    return res.json({ success: true, payouts });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
