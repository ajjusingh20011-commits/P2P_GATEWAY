/**
 * BullMQ worker entrypoint (run as a separate process: `npm run worker`).
 *
 * Processes:
 *   webhooks  queue -> deliver merchant webhooks (with BullMQ retries)
 *   scheduler queue -> repeatable maintenance jobs (order expiry, heartbeat, settlement)
 *
 * Needs a live DB connection because the job handlers use Sequelize models.
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const config = require('../config');
const { connection, connectRedis, isQueueUsable } = require('../loaders/redis');
const { connectDatabase } = require('../loaders/database');
const logger = require('../utils/logger');

const { deliverWebhook } = require('../services/webhookService');
const { checkExpiredOrders } = require('./orderExpiry');
const { checkHeartbeats } = require('./heartbeatCheck');
const { runSettlement } = require('./settlementJob');

const opts = { connection, prefix: config.queue.prefix, concurrency: config.queue.concurrency };

// Dispatch repeatable maintenance jobs by name.
const schedulerHandlers = {
  'order-expiry': checkExpiredOrders,
  'heartbeat-check': checkHeartbeats,
  settlement: runSettlement,
};

async function schedulerProcessor(job) {
  const handler = schedulerHandlers[job.name];
  if (!handler) {
    logger.warn(`scheduler: no handler for ${job.name}`);
    return;
  }
  return handler();
}

async function bootstrap() {
  // The worker is useless without Redis — exit cleanly (not a crash) so a
  // process manager doesn't hot-loop it.
  const redisOk = await connectRedis();
  if (!redisOk || !isQueueUsable()) {
    logger.warn('Worker: Redis unavailable or too old for BullMQ (needs >= 5.0.0) — nothing to process. Exiting.');
    process.exit(0);
  }

  await connectDatabase();
  // Register models against the live connection.
  require('../models');

  const workers = [
    new Worker('webhooks', deliverWebhook, opts),
    new Worker('scheduler', schedulerProcessor, opts),
  ];

  workers.forEach((w) => {
    w.on('completed', (job) => logger.debug(`Completed ${job.queueName}:${job.name}:${job.id}`));
    w.on('failed', (job, err) => logger.error(`Failed ${job?.queueName}:${job?.name}:${job?.id}`, err));
  });

  logger.info('BullMQ workers started (webhooks, scheduler)');
}

bootstrap().catch((err) => {
  logger.error('Worker boot error', err);
  process.exit(1);
});
