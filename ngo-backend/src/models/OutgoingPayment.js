const mongoose = require('mongoose');

/**
 * An OUTGOING payment auto-captured from a payment app's success screen by the
 * APK accessibility engine. The NGO does nothing — the bot reads amount /
 * recipient / UTR off screen and posts it here. A purpose can be attached later
 * via /api/apk/update-purpose.
 */
const outgoingPaymentSchema = new mongoose.Schema({
  ngoId: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  app: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  recipientLast4: { type: String, default: '' },
  amount: { type: String, default: '' },
  utr: { type: String, default: '', index: true },
  purpose: { type: String, default: '' },
  capturedAt: { type: String, default: '' },
  capturedFrom: { type: String, default: '' },
  autoCapture: { type: Boolean, default: false },
  matched: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('OutgoingPayment', outgoingPaymentSchema);
