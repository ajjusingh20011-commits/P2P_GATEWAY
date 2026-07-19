const mongoose = require('mongoose');
const { TRANSACTION_STATUS } = require('../config/constants');

const transactionSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
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
