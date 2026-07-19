const mongoose = require('mongoose');

/**
 * A payout screen captured by the on-device overlay (recipient + amount read
 * off the payment app UI at the moment a transfer is made). Pairs with a
 * {@link DebitSMS} to confirm the money actually left the account.
 */
const overlayCaptureSchema = new mongoose.Schema({
  ngoId: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  recipientAccount: { type: String, default: '' },
  last4Digits: { type: String, default: '' },
  recipientUPI: { type: String, default: '' },
  ifsc: { type: String, default: '' },
  amount: { type: String, default: '' },
  paymentApp: { type: String, default: '' },
  screenshotBase64: { type: String, default: '' },
  capturedAt: { type: String, default: '' },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'pending',
  },
  debitSmsId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('OverlayCapture', overlayCaptureSchema);
