'use strict';

/**
 * payoutExpiryJob — the payout lifecycle sweep. Two stages, both transactional
 * and each only touching rows still in the expected status:
 *   1. in_processing whose transfer timer elapsed  -> dispute
 *      (accepted but not transferred in time; the admin must review).
 *   2. dispute that has sat past payout_dispute_hours -> back to the global
 *      pool (awaiting_processing) for another trader to pick up.
 * Runs in-process every 30s (works without Redis), like the order-expiry sweep.
 */

const payoutService = require('../services/payoutService');

async function checkExpiredPayouts() {
  const expired = await payoutService.checkExpired();
  const returned = await payoutService.returnDisputesToPool();
  return { ...expired, ...returned };
}

module.exports = { checkExpiredPayouts };
