const mongoose = require('mongoose');

/**
 * A DEBIT bank SMS captured on-device and relayed by the APK. When the sender
 * is a verified transactional bank ("-T"), the payout verifier tries to match
 * it against a pending {@link OverlayCapture} to produce a verified payout.
 */
const debitSmsSchema = new mongoose.Schema({
  ngoId: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  sender: { type: String, default: '' },
  smsBody: { type: String, default: '' },
  last4Digits: { type: String, default: '' },
  amount: { type: String, default: '' },
  utr: { type: String, default: '' },
  receivedAt: { type: String, default: '' },
  isTransactionalSender: { type: Boolean, default: false },
  isVerifiedBank: { type: Boolean, default: false },
  matched: { type: Boolean, default: false },
  overlayId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('DebitSMS', debitSmsSchema);
