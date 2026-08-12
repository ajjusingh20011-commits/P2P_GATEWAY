const mongoose = require('mongoose');
const { RAW_EVENT_TYPE, CATEGORY } = require('../config/constants');

const rawEventSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      default: null,
      index: true,
    },
    // The real trader (MySQL trader.id) who owns the device this event came
    // from — mirrors Device.traderId/Account.traderId. This is what
    // matchingEngineV2's triggerOrderSettlementFromRawEvent actually keys
    // off now; ngoId above is kept only for the (retired) donation-ledger
    // matching path, which still gates on it.
    traderId: {
      type: Number,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(RAW_EVENT_TYPE),
      required: true,
    },
    sender: { type: String, default: '' },
    body: { type: String, default: '' },
    category: {
      type: String,
      enum: Object.values(CATEGORY),
      default: CATEGORY.OTHER,
    },
    amount: { type: String, default: '' },
    // UPI ref/UTR the device already extracted from the SMS/notification
    // text (see SMSReceiver.java / NotificationService.java's UTR_PATTERNS).
    // Used by matchingEngineV2's Tier 0/1/2 logic — see routes/apk.js.
    utr: { type: String, default: '' },
    // Optional capture-source tag. Empty for SMS/notification captures;
    // "web_login_paytm" etc. for on-device WebView Web Login captures, which
    // carry authoritative structured data and bypass the text classifier.
    source: { type: String, default: '' },
    utcTimestamp: { type: String, default: '' },
    processed: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RawEvent', rawEventSchema);
