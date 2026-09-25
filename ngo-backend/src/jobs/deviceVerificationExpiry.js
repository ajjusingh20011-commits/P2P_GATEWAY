'use strict';

/**
 * deviceVerificationExpiry job — Feature 2 (APK Device Verification via
 * Random Test Payment). Same in-process setInterval pattern as this
 * project's other sweeps (the gateway backend's orderExpiry/staleClaimSweep/
 * connectionLiveness/underReviewReminder/payoutExpiryJob, all registered in
 * backend/src/server.js) — this one just lives on the ngo-backend side,
 * since DeviceVerification is a Mongo collection.
 *
 * Does NOT touch payment_details.device_verified_at or anything on the
 * gateway backend — an expired verification simply never got there in the
 * first place (mark-device-verified is only ever called on a real match).
 * A trader retrying after expiry gets a brand new DeviceVerification row
 * from a fresh POST /api/trader/payment-details/:id/verify/start call; this
 * job only flips the stale 'pending' row so [Check] and the frontend poll
 * report the true state instead of a pending window that's already closed.
 */

const DeviceVerification = require('../models/DeviceVerification');

const SWEEP_INTERVAL_MS = 30 * 1000;

async function checkExpiredVerifications() {
  const result = await DeviceVerification.updateMany(
    { status: 'pending', expiresAt: { $lte: new Date() } },
    { status: 'expired' }
  );
  const modified = result.modifiedCount ?? result.nModified ?? 0;
  if (modified) {
    console.log(`deviceVerificationExpiry: expired ${modified} pending verification(s)`);
  }
  return { expired: modified };
}

function startDeviceVerificationExpirySweep() {
  const tick = () => {
    checkExpiredVerifications().catch((err) => {
      console.warn(`deviceVerificationExpiry: sweep error (ignored): ${err.message}`);
    });
  };
  tick();
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log(`deviceVerificationExpiry: sweeping every ${SWEEP_INTERVAL_MS / 1000}s`);
  return timer;
}

module.exports = { startDeviceVerificationExpirySweep, checkExpiredVerifications, SWEEP_INTERVAL_MS };
