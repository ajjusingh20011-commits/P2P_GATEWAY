'use strict';

/**
 * webhookRetrySweep — retries every merchant webhook that is due.
 *
 * This is what makes the retry guarantee real regardless of Redis. Delivery is
 * attempted inline at send time; anything that failed is left `pending` in
 * webhook_logs with a `next_attempt_at`, and this sweep picks it up. Same
 * in-process setInterval pattern as the order-expiry / stale-claim /
 * payout-expiry sweeps in server.js.
 */

const { processDueWebhooks } = require('../services/webhookService');

async function checkDueWebhooks() {
  return processDueWebhooks();
}

module.exports = { checkDueWebhooks };
