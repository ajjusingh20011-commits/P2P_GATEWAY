/**
 * BullMQ queue registry + repeatable-job scheduler.
 *
 * Queues:
 *   webhooks   - merchant webhook delivery (3 attempts, exponential backoff)
 *   scheduler  - repeatable maintenance jobs (order expiry, heartbeat, settlement)
 *   payments / notifications / payouts - reserved for future async processing
 *
 * Processors live in src/jobs/worker.js (run via `npm run worker`).
 */

const { Queue } = require('bullmq');
const config = require('../config');
const { connection, isQueueUsable } = require('../loaders/redis');
const logger = require('../utils/logger');

const defaultOpts = { connection, prefix: config.queue.prefix };

// A Queue emits 'error' asynchronously (e.g. incompatible Redis version, or
// Redis going away). Without a listener Node treats it as fatal and crashes —
// so every queue gets a listener that logs at most once and never throws.
function makeQueue(name) {
  const q = new Queue(name, defaultOpts);
  let logged = false;
  q.on('error', (err) => {
    if (!logged) {
      logger.warn(`Queue "${name}" unavailable: ${err.message}. Jobs on this queue are disabled.`);
      logged = true;
    }
  });
  return q;
}

const queues = {
  webhooks: makeQueue('webhooks'),
  scheduler: makeQueue('scheduler'),
  payments: makeQueue('payments'),
  notifications: makeQueue('notifications'),
  payouts: makeQueue('payouts'),
};

/**
 * Register the repeatable maintenance jobs. Idempotent — BullMQ dedupes
 * repeatables by name + pattern, so calling this on every boot is safe.
 */
async function scheduleRepeatableJobs() {
  if (!isQueueUsable()) {
    logger.warn('Skipping repeatable jobs — Redis not available or too old for BullMQ.');
    return false;
  }
  try {
    await queues.scheduler.add('order-expiry', {}, { repeat: { every: 30_000 }, removeOnComplete: true, removeOnFail: true });
    await queues.scheduler.add('heartbeat-check', {}, { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true });
    // Daily settlement at midnight (server time).
    await queues.scheduler.add('settlement', {}, { repeat: { pattern: '0 0 * * *' }, removeOnComplete: true, removeOnFail: true });
    return true;
  } catch (err) {
    // e.g. Redis too old for BullMQ (needs >= 5.0.0).
    logger.warn(`Repeatable jobs disabled: ${err.message}`);
    return false;
  }
}

module.exports = { queues, scheduleRepeatableJobs };
