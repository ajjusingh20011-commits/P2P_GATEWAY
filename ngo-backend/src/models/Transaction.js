const mongoose = require('mongoose');
const { TRANSACTION_STATUS } = require('../config/constants');

const transactionSchema = new mongoose.Schema(
  {
    // No longer required — a scraper Transaction is genuinely trader-owned
    // now (see traderId below), same reasoning as Account.ngoId/Device.ngoId.
    // Kept nullable rather than removed: still read by the (not-yet-deleted)
    // donation-ledger matching path (matchingEngine.checkMatch/matchWebhook)
    // and checkout.js's GET /status/:verifyId lookup.
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      default: null,
      index: true,
    },
    // Denormalized from Account.traderId at write time (the scraper creates
    // these per-Account, not per-request) so listing a trader's own
    // transactions doesn't need a join on every read.
    traderId: {
      type: Number,
      default: null,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    platform: { type: String, default: '' },
    amount: { type: String, required: true },
    payerName: { type: String, default: '' },
    payerUpiId: { type: String, default: '' },
    utr: { type: String, default: '', index: true },
    txnId: { type: String, default: '' },
    bankName: { type: String, default: '' },
    paymentMode: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(TRANSACTION_STATUS),
      default: TRANSACTION_STATUS.PENDING,
    },
    // Set once matchingEngineV2.matchAndSettle (backend/, MySQL side) has
    // genuinely settled a P2P order off this transaction — see
    // p2pOrderId below and matchingEngine.js's
    // triggerOrderSettlementFromRawEvent/triggerOrderSettlementFromTransaction,
    // which award the call sites (routes/apk.js, services/webScraper.js) the
    // backend's real match result to apply here. NOT the old checkout
    // /verify-based donation-ledger flow (routes/checkout.js) — that was
    // retired 2026-08-06 and never runs for new data anymore, so it must
    // never be the thing that sets this field again.
    matched: { type: Boolean, default: false },
    // Cross-service link to backend's (MySQL) Order.id — not a Mongoose
    // ref, since Order lives in a different database/service entirely.
    // Only meaningful when matched is true.
    p2pOrderId: { type: Number, default: null },
    txnTime: { type: String, default: '' },
    scrapedAt: { type: Date, default: Date.now },
    rawEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RawEvent',
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
