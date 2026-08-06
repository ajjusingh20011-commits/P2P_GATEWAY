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
    // Set once a checkout /verify claim has been matched to this
    // transaction, so it isn't matched to a second claim.
    matched: { type: Boolean, default: false },
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
