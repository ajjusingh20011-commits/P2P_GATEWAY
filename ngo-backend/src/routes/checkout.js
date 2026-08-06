const express = require('express');
const NGO = require('../models/NGO');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Verification = require('../models/Verification');

const router = express.Router();

const STALE_MS = 5 * 60 * 1000;
const MATCH_WINDOW_MS = 10 * 60 * 1000;

// POST /api/checkout/verify
// LEGACY / INERT as of the donation-ledger retirement (2026-08-06). This used
// to be the route orderController.js's claimPaid bridged into to seed the
// OLD donor-webhook + ledger matching flow: create a Verification + Webhook
// here, then nudge the scraper so a matching Transaction was more likely to
// already be in Mongo by the time the donor's status poll came in. Real P2P
// order settlement no longer goes through any of that — it's driven
// independently by matching engine v2, triggered straight off the
// receiver-side RawEvent/Transaction the instant a payment is detected (see
// matchingEngine.js's triggerOrderSettlementFromRawEvent/
// triggerOrderSettlementFromTransaction), with no donor-claim prerequisite.
// claimPaid no longer calls this route at all. Left mounted (not deleted, no
// 404) per the product decision to retire the donation-ledger subsystem
// without yet deleting its models/routes — see PRODUCTION_READINESS_AUDIT.md.
router.post('/verify', async (req, res) => {
  return res.json({
    success: true,
    message: 'Donation-ledger verification is retired; this endpoint no longer records anything.',
  });
});

// GET /api/checkout/status/:verifyId
router.get('/status/:verifyId', async (req, res, next) => {
  try {
    const verification = await Verification.findOne({ verifyId: req.params.verifyId });
    if (!verification) {
      return res.status(404).json({ success: false, message: 'Verification not found' });
    }

    const timeWindow = new Date(new Date(verification.donorClickedAt).getTime() - MATCH_WINDOW_MS);

    const transaction = await Transaction.findOne({
      ngoId: verification.ngoId,
      amount: parseFloat(verification.amount).toFixed(2),
      scrapedAt: { $gte: timeWindow },
      matched: { $ne: true },
    });

    if (transaction) {
      verification.status = 'matched';
      verification.transactionId = transaction._id.toString();
      await verification.save();

      transaction.matched = true;
      await transaction.save();

      return res.json({
        success: true,
        status: 'matched',
        transaction: {
          amount: transaction.amount,
          payerName: transaction.payerName,
          rrn: transaction.utr,
          upiId: transaction.payerUpiId,
          time: transaction.txnTime,
          status: transaction.status,
        },
      });
    }

    const isStale = Date.now() - new Date(verification.createdAt).getTime() > STALE_MS;
    if (isStale) {
      verification.status = 'failed';
      await verification.save();
      return res.json({ success: true, status: 'failed' });
    }

    return res.json({ success: true, status: 'pending' });
  } catch (err) {
    return next(err);
  }
});

// GET /api/ngo/public/:ngoId — donor-facing, unauthenticated NGO + live
// accounts lookup for the checkout page. Wired directly onto that exact path
// in server.js (not under /api/checkout) since ngo.js's router applies
// verifyToken/requireRole to everything mounted at /api/ngo; kept here
// because it shares this file's public, donor-facing purpose and models.
async function getPublicNgoInfo(req, res, next) {
  try {
    const ngo = await NGO.findById(req.params.ngoId);
    if (!ngo) {
      return res.status(404).json({ success: false, message: 'NGO not found' });
    }

    const accounts = await Account.find({
      ngoId: req.params.ngoId,
      status: 'live',
    }).select('platform upiId displayName connectionType');

    return res.json({
      success: true,
      data: {
        name: ngo.name,
        description: ngo.description,
        accounts,
      },
    });
  } catch (err) {
    return next(err);
  }
}

router.publicNgoHandler = getPublicNgoInfo;

module.exports = router;
