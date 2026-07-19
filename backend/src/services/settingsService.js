'use strict';

/**
 * settingsService — read/write the `settings` key/value table with a short
 * Redis cache. All values are stored as strings; helpers coerce as needed.
 */

const db = require('../models');
const logger = require('../utils/logger');
const { connection, isRedisAvailable } = require('../loaders/redis');

const CACHE_TTL_SEC = 60;
const CACHE_KEY = (key) => `setting:${key}`;

const DEFAULTS = {
  exchange_rate: '100',
  base_exchange_rate: '100',
  admin_default_margin: '5',
  trader_default_margin: '4',
  platform_revenue_usdt: '0',
  exchange_rate_mode: 'fixed',
  platform_name: 'PayGateway',
  order_expiry_minutes: '10',
  min_order_amount: '100',
  max_order_amount: '500000',
};

/** Get a raw string setting (cache → db → default). */
async function get(key) {
  if (isRedisAvailable()) {
    try {
      const cached = await connection.get(CACHE_KEY(key));
      if (cached != null) return cached;
    } catch (_) { /* fall through to db */ }
  }
  const row = await db.Setting.findOne({ where: { key } });
  const value = row ? row.value : DEFAULTS[key];
  if (value != null && isRedisAvailable()) {
    try { await connection.set(CACHE_KEY(key), String(value), 'EX', CACHE_TTL_SEC); } catch (_) { /* noop */ }
  }
  return value != null ? value : null;
}

async function getNumber(key, fallback = 0) {
  const v = await get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Upsert a setting and invalidate its cache. */
async function set(key, value) {
  const [row, created] = await db.Setting.findOrCreate({
    where: { key },
    defaults: { key, value: String(value) },
  });
  if (!created) await row.update({ value: String(value) });
  if (isRedisAvailable()) {
    try { await connection.del(CACHE_KEY(key)); } catch (_) { /* noop */ }
  }
  logger.info(`settings: ${key} = ${value}`);
  return row;
}

/** Return every setting as a plain object (defaults merged under stored rows). */
async function getAll() {
  const rows = await db.Setting.findAll({ order: [['key', 'ASC']] });
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Ensure default rows exist (idempotent) — safe to call on boot. */
async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    // eslint-disable-next-line no-await-in-loop
    await db.Setting.findOrCreate({ where: { key }, defaults: { key, value } });
  }
}

module.exports = { get, getNumber, set, getAll, ensureDefaults, DEFAULTS };
