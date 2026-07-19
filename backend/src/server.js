/**
 * server.js
 * HTTP + WebSocket entrypoint.
 *
 * Boot policy:
 *   - MySQL is required; a failure is logged loudly but the HTTP server still
 *     starts so /api/health stays reachable and reports the outage.
 *   - Redis is OPTIONAL. If it can't connect we log a warning and continue;
 *     background jobs are skipped and services fall back to in-memory behaviour.
 */

require('dotenv').config();

const http = require('http');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { initWebsocket } = require('./websocket');
const { connectDatabase } = require('./loaders/database');
const { connectRedis, isQueueUsable } = require('./loaders/redis');

// Safety net: never let a stray async rejection (e.g. a background Redis/BullMQ
// hiccup) take the whole server down.
process.on('unhandledRejection', (reason) => {
  logger.warn(`Unhandled rejection (ignored): ${reason?.message || reason}`);
});

async function bootstrap() {
  // ---- MySQL (required, but non-crashing) ----
  try {
    await connectDatabase();
    require('./models');
  } catch (err) {
    logger.error(`MySQL connection failed: ${err.message}. Is MySQL running and is DB "${config.db.name}" created? The API will start but DB-backed routes will error.`);
  }

  // ---- Redis (optional) ----
  const redisOk = await connectRedis();
  if (!redisOk) {
    logger.warn('Running WITHOUT Redis: background jobs disabled, locks use in-memory fallback.');
  }

  // ---- HTTP + WebSocket ----
  const server = http.createServer(app);
  initWebsocket(server);

  // ---- Repeatable jobs (only if Redis is present AND new enough for BullMQ) ----
  if (isQueueUsable()) {
    try {
      const { scheduleRepeatableJobs } = require('./jobs');
      await scheduleRepeatableJobs();
      logger.info('Repeatable jobs scheduled');
    } catch (err) {
      logger.warn(`Could not schedule repeatable jobs: ${err.message}`);
    }
  } else {
    logger.warn('Background jobs are disabled. Run `npm run worker` with Redis >= 5 to enable them.');
  }

  // ---- In-process order sweep (works with or without Redis) ----
  // Runs every 30s and does two things, in order:
  //   1. EXPIRE stale orders (new/assigned/paid past expires_at) → 'expired' and
  //      release the trader/UPI back to the pool. Without Redis the BullMQ worker
  //      never runs, so this MUST run in-process — otherwise an expired order
  //      keeps holding its UPI forever and new checkouts see "no provider
  //      available" even though the trader is online.
  //   2. RETRY-ASSIGN any still-'new' order to a trader who is now available.
  //      This lets a checkout move from "searching…" to real UPI details, and
  //      re-uses UPIs freed by step 1 on the same tick.
  try {
    const routingEngine = require('./services/routingEngine');
    const { checkExpiredOrders } = require('./jobs/orderExpiry');
    setInterval(() => {
      checkExpiredOrders()
        .catch((err) => logger.warn(`Order-expiry sweep error (ignored): ${err.message}`))
        .finally(() => {
          routingEngine.retryQueuedOrders().catch((err) => {
            logger.warn(`Order-retry sweep error (ignored): ${err.message}`);
          });
        });
    }, 30_000).unref();
    logger.info('Order expiry + retry sweep running every 30s');
  } catch (err) {
    logger.warn(`Could not start order sweep: ${err.message}`);
  }

  // ---- In-process payout-request expiry sweep (works with or without Redis) ----
  // Moves accepted-but-not-transferred payout requests to `dispute` once their
  // timer elapses. Isolated from the order sweep above.
  try {
    const { checkExpiredPayouts } = require('./jobs/payoutExpiryJob');
    setInterval(() => {
      checkExpiredPayouts().catch((err) => {
        logger.warn(`Payout-expiry sweep error (ignored): ${err.message}`);
      });
    }, 30_000).unref();
    logger.info('Payout-expiry sweep running every 30s');
  } catch (err) {
    logger.warn(`Could not start payout-expiry sweep: ${err.message}`);
  }

  server.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port} [${config.env}]`);
    logger.info(`Health check: http://localhost:${config.port}/api/health`);
  });
}

bootstrap().catch((err) => {
  logger.error('Fatal boot error', err);
  process.exit(1);
});
