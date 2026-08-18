const mongoose = require('mongoose');

/**
 * FEATURE 2 — Payout evidence, first-submission-wins lock. One document per
 * orderId, created atomically by whichever device's evidence submission
 * reaches the server first. This is NOT a flag-for-review model — the
 * unique index on orderId IS the lock: a second device's create() throws a
 * real Mongo E11000 duplicate-key error, which POST /payout-evidence turns
 * into a 409 for that device. Same race-safe pattern already used for
 * device registration (Device.deviceId's unique index — see routes/apk.js
 * POST /register-device and its E11000 handling).
 */
const payoutLockSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, required: true },
  traderId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PayoutLock', payoutLockSchema);
