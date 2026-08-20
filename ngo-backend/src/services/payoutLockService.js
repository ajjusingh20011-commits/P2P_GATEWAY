const Device = require('../models/Device');
const PayoutLock = require('../models/PayoutLock');

/**
 * FEATURE 2 — Payout evidence device-ownership check + first-submission-wins
 * lock. Extracted out of routes/apk.js so this race-sensitive logic (it
 * relies on PayoutLock's unique index on orderId being atomic under
 * concurrent submissions from a trader's several linked devices) is
 * directly unit-testable without spinning up Express/HTTP — same boundary
 * this project already draws for weightedRotation.js/paymentDetector.js.
 */

/**
 * A device may submit evidence for orderId if either:
 *  - it's CURRENTLY armed for it (Device.activePayout.orderId matches), or
 *  - a PayoutLock already exists for this orderId under the SAME traderId —
 *    proof this trader's devices were legitimately armed for it at some
 *    point, even though the winning device's first submission has since
 *    cleared every other device's activePayout for this order (see
 *    clearOtherDevices below). Without this fallback, a second device's
 *    now-correctly-rejected (409) submission attempt would 403 instead,
 *    the wrong error for "already submitted elsewhere."
 */
async function isDeviceArmedForOrder(device, orderId) {
  if (!device) return false;
  // Phase 1a — activePayouts is a LIST; armed means an entry for THIS order is
  // present (any of the up-to-3), not that a single slot happens to match.
  const currentlyArmed = Array.isArray(device.activePayouts)
    && device.activePayouts.some((p) => p && String(p.orderId) === String(orderId));
  if (currentlyArmed) return true;
  if (device.traderId == null) return false;
  const existingLock = await PayoutLock.findOne({ orderId, traderId: device.traderId });
  return !!existingLock;
}

/**
 * Attempts the atomic first-submission-wins lock. The unique index on
 * PayoutLock.orderId IS the lock — this is a real atomic insert, not a
 * find-then-create race.
 * @returns {{ allowed: boolean, isFirstSubmission: boolean, lockedByDeviceId: string|null }}
 */
async function attemptSubmissionLock(orderId, deviceId, traderId) {
  try {
    await PayoutLock.create({ orderId, deviceId: deviceId || '', traderId });
    return { allowed: true, isFirstSubmission: true, lockedByDeviceId: deviceId || '' };
  } catch (e) {
    if (e && e.code === 11000) {
      const existingLock = await PayoutLock.findOne({ orderId });
      const lockedByDeviceId = existingLock ? existingLock.deviceId : null;
      // Same device that already won the lock: a legitimate follow-up
      // (e.g. a late-arriving linked SMS row) — accept, unchanged from
      // today's behavior. A DIFFERENT device: reject.
      return { allowed: lockedByDeviceId === deviceId, isFirstSubmission: false, lockedByDeviceId };
    }
    throw e;
  }
}

/** Prunes THIS order from activePayouts on every OTHER device the trader owns,
 *  once one device has won the submission — the overlay stops showing this
 *  payout as active elsewhere. Phase 1a: $pull only this order, leaving any
 *  other in-processing payouts on those devices untouched (the old code wiped
 *  the entire single slot, which with a list would drop unrelated payouts). */
async function clearOtherDevices(traderId, submittingDeviceId, orderId) {
  if (traderId == null) return;
  await Device.updateMany(
    { traderId, deviceId: { $ne: submittingDeviceId }, 'activePayouts.orderId': String(orderId) },
    { $pull: { activePayouts: { orderId: String(orderId) } } }
  );
}

module.exports = { isDeviceArmedForOrder, attemptSubmissionLock, clearOtherDevices };
