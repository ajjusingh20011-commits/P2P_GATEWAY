const mongoose = require('mongoose');

/**
 * FEATURE 2 — Payout evidence capture. One row per upload the APK sends for
 * a given orderId — the initial bundle and any SMS-follow-up are each their
 * own row (EventQueue on the APK side has no concept of a mutable
 * server-side record to PATCH — see PayoutState.uploadBundle). Detection/
 * capture/packaging/upload only: no matching/scoring/approval fields here —
 * that's entirely a downstream admin/backend concern reading these rows.
 */
const payoutEvidenceSchema = new mongoose.Schema({
  deviceId: { type: String, default: '' },
  traderId: { type: Number, default: null, index: true },
  orderId: { type: String, required: true, index: true },
  reason: { type: String, default: '' }, // trader_click | sms_followup | expiry
  recordedInput: { type: mongoose.Schema.Types.Mixed, default: null },
  recordTimestamp: { type: String, default: '' },
  screenshotBase64: { type: String, default: '' },
  screenshotTimestamp: { type: String, default: '' },
  linkedSmsRaw: { type: String, default: '' },
  smsTimestamp: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PayoutEvidence', payoutEvidenceSchema);
