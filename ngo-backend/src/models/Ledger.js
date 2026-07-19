const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
      index: true,
    },
    ngoName: { type: String, default: '' },
    donorName: { type: String, default: '' },
    donorEmail: { type: String, default: '' }, // optional
    amount: { type: String, required: true },
    purpose: { type: String, default: '' },
    utr: { type: String, default: '' },
    upiId: { type: String, default: '' },
    txnId: { type: String, default: '' },
    platform: { type: String, default: '' },
    verifiedAt: { type: Date, default: Date.now },
    // Hash chain links.
    prevHash: { type: String, default: '' },
    hash: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Webhook',
      default: null,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ledger', ledgerSchema);
