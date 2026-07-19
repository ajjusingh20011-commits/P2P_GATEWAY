const mongoose = require('mongoose');

/**
 * A verified outgoing payout: a DebitSMS matched to an OverlayCapture across
 * four verification layers (amount, last-4, time window, legit sender). Linked
 * into a hash chain (prevHash/hash) so the public payout log is tamper-evident.
 */
const payoutSchema = new mongoose.Schema({
  ngoId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  recipientUPI: { type: String, default: '' },
  recipientAccount: { type: String, default: '' },
  amount: { type: String, default: '' },
  purpose: { type: String, default: '' },
  utr: { type: String, default: '' },
  last4Digits: { type: String, default: '' },
  paymentApp: { type: String, default: '' },
  overlayId: { type: String, default: '' },
  debitSmsId: { type: String, default: '' },
  verificationLayers: {
    amountMatch: Boolean,
    last4Match: Boolean,
    timeMatch: Boolean,
    senderLegit: Boolean,
  },
  overallVerified: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: true },
  prevHash: { type: String, default: '' },
  hash: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Payout', payoutSchema);
