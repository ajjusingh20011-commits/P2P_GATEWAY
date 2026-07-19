/**
 * Redis connection loader (ioredis) — OPTIONAL dependency.
 *
 * The client connects lazily. `connectRedis()` attempts a connection and
 * resolves to a boolean (never throws). If Redis is unavailable the app keeps
 * running: `isRedisAvailable()` returns false and callers fall back to
 * in-memory behaviour (see services/routingEngine.js) or skip Redis-only work
 * (BullMQ jobs, refresh-token store, etc.).
 */

const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let available = false;
let queueUsable = false; // Redis reachable AND version >= 5 (required by BullMQ)

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  // BullMQ requires this to be null.
  maxRetriesPerRequest: null,
  // Fail commands fast instead of buffering forever when Redis is down.
  enableOfflineQueue: false,
  // Don't connect at require-time; server.js/worker.js call connectRedis().
  lazyConnect: true,
  // Give up reconnecting after a few tries so we don't spam logs when offline.
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 200, 1000);
  },
});

connection.on('ready', () => {
  if (!available) logger.info('Redis connected');
  available = true;
});
connection.on('end', () => {
  available = false;
});
// Must have an 'error' listener or ioredis throws and crashes the process.
connection.on('error', (err) => {
  if (available) logger.warn(`Redis error: ${err.message}`);
});

/**
 * Attempt to connect. Never throws — returns true on success, false otherwise.
 */
async function detectQueueSupport() {
  // BullMQ requires Redis >= 5.0.0. Detect the server version so we can gate
  // all queue usage (and never construct a queue against an incompatible
  // server, which would throw a detached, uncatchable rejection).
  try {
    const info = await connection.info('server');
    const m = info.match(/redis_version:(\d+)\.(\d+)\.(\d+)/);
    const major = m ? parseInt(m[1], 10) : 0;
    queueUsable = major >= 5;
    if (!queueUsable && m) {
      logger.warn(`Redis ${m[1]}.${m[2]}.${m[3]} is too old for background jobs (BullMQ needs >= 5.0.0). Jobs disabled — core features and locks still work.`);
    }
  } catch (err) {
    queueUsable = false;
  }
}

async function connectRedis() {
  try {
    if (connection.status !== 'ready') await connection.connect();
    available = true;
    logger.info('Redis connected');
    await detectQueueSupport();
    return true;
  } catch (err) {
    available = false;
    queueUsable = false;
    logger.warn(`Redis unavailable (${err.message}) — continuing without it. Background jobs and distributed locks are disabled.`);
    return false;
  }
}

function isRedisAvailable() {
  return available;
}

// True only when Redis is reachable AND new enough for BullMQ.
function isQueueUsable() {
  return available && queueUsable;
}

module.exports = { connection, connectRedis, isRedisAvailable, isQueueUsable };
