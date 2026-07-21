const express = require('express');
const NGO = require('../models/NGO');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Verification = require('../models/Verification');
const Webhook = require('../models/Webhook');
const SessionStore = require('../services/SessionStore');
const { fetchAndSaveTransactions } = require('../services/webScraper');

const router = express.Router();

const STALE_MS = 5 * 60 * 1000;
const MATCH_WINDOW_MS = 10 * 60 * 1000;

// POST /api/checkout/verify
// Donor clicked "I've paid" on the checkout page. Records the claim and
// immediately (fire-and-forget) nudges the web scraper for this NGO's live
// web account, so a matching transaction is more likely to already be in
// Mongo by the time the donor's status poll comes in.
router.post('/verify', async (req, res, next) => {
  try {
    const { ngoId, amount, purpose, donorClickedAt, orderId, donorName, donorEmail } = req.body;

    const verifyId = Date.now().toString();

    await Verification.create({
      verifyId,
      ngoId,
      orderId: orderId || '',
      amount,
      purpose,
      donorClickedAt,
      status: 'pending',
      createdAt: new Date(),
    });

    // Also create the donor-intent webhook the matching engine pairs against
    // scraped transactions. Tagging it with orderId lets matchingEngine call
    // back into the P2P backend (POST /api/orders/verify-payment) once a
    // matching transaction is found — see notifyP2PBackend().
    await Webhook.create({
      ngoId,
      orderId: orderId || '',
      amount,
      donorName: donorName || 'Unknown',
      donorEmail: donorEmail || '',
      purpose: purpose || 'Donation',
      status: 'pending',
      createdAt: new Date(),
    });

    const account = await Account.findOne({
      ngoId,
      connectionType: 'web',
      status: 'live',
    });

    if (account) {
      const session = SessionStore.getSession(account._id.toString());
      if (session && session.page) {
        // Don't await — the donor's UI is already polling /status, this just
        // shortens how long that polling has to wait.
        fetchAndSaveTransactions(account, session.page, null).catch((err) =>
          console.log('Scraper error:', err.message)
        );
      }
    }

    return res.json({
      success: true,
      verifyId,
      message: 'Verification started',
    });
  } catch (err) {
    return next(err);
  }
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
