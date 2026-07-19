'use strict';

/**
 * payoutExpiryJob — moves in_processing payout requests whose transfer timer
 * elapsed into `dispute` (per spec: accepted but not transferred in time → the
 * admin must review). Runs in-process every 30s (works without Redis), like the
 * order-expiry sweep. Delegates the actual work to payoutService.checkExpired,
 * which is transactional and only touches still-in_processing rows.
 */

const payoutService = require('../services/payoutService');

async function checkExpiredPayouts() {
  return payoutService.checkExpired();
}

module.exports = { checkExpiredPayouts };
