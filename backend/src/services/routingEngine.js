'use strict';

/**
 * Routing Engine (v2) — assigns orders to an eligible trader + payment account.
 *
 * A trader is eligible when: online, active user, positive USDT balance, and
 * they accept the order's deposit_type (FTD/STD). An account is eligible when:
 * active, the amount is within its min/max, it is NOT already holding an active
 * order for the SAME amount (same-amount lock), and it is under its hourly/daily
 * count limits.
 *
 * Same-amount lock: an account may run many concurrent orders for DIFFERENT
 * amounts, but only ONE active order per exact amount (so two customers paying
 * the same UPI the same amount can't collide). A short amount-lock closes the
 * check→create race; the DB row is the source of truth thereafter.
 */

const { Op } = require('sequelize');

const config = require('../config');
const db = require('../models');
const logger = require('../utils/logger');
const { connection, isRedisAvailable } = require('../loaders/redis');
const { emitToTrader, emitToAdmin, emitToMerchant, emitToOrder, broadcast } = require('../websocket');
const upiService = require('./upiService');

const ACTIVE = db.Order.ACTIVE_STATUSES; // pending, checkout_open, claimed_paid, under_review
const LOCK_TTL_SEC = config.platform.orderExpiryMinutes * 60 + 60;
const ORDER_QUEUE_KEY = 'queue:orders';

const traderLockKey = (id) => `lock:trader:${id}`;
const amountLockKey = (detailId, amount) => `lock:amt:${detailId}:${Number(amount).toFixed(2)}`;

/* ------------------------------ locking ----------------------------------- */
// Trader locks (used by reassign) + amount locks (race guard on create). Redis
// when available, else an in-memory Map (single-process fallback).
const memoryLocks = new Map();

function memPurge() {
  const now = Date.now();
  for (const [k, v] of memoryLocks) if (v.expiresAt <= now) memoryLocks.delete(k);
}

async function acquireLock(key, value, ttlSec = LOCK_TTL_SEC) {
  if (isRedisAvailable()) {
    const res = await connection.set(key, String(value), 'NX', 'EX', ttlSec);
    return res === 'OK';
  }
  memPurge();
  if (memoryLocks.has(key)) return false;
  memoryLocks.set(key, { value: String(value), expiresAt: Date.now() + ttlSec * 1000 });
  return true;
}

async function releaseLock(key, expectedValue) {
  if (isRedisAvailable()) {
    const current = await connection.get(key);
    if (current == null || expectedValue == null || String(current) === String(expectedValue)) {
      await connection.del(key);
    }
    return;
  }
  const current = memoryLocks.get(key);
  if (!current || expectedValue == null || String(current.value) === String(expectedValue)) memoryLocks.delete(key);
}

const acquireTraderLock = (traderId, orderId) => acquireLock(traderLockKey(traderId), orderId);
const isTraderLocked = async (traderId) => {
  if (isRedisAvailable()) return (await connection.exists(traderLockKey(traderId))) === 1;
  memPurge();
  return memoryLocks.has(traderLockKey(traderId));
};
async function releaseTrader(traderId, orderId) {
  await releaseLock(traderLockKey(traderId), orderId);
  logger.info(`routing: released trader ${traderId} (order ${orderId})`);
}

// Amount lock — held briefly around create to prevent two same-amount orders
// racing onto one account. Auto-expires; the DB same-amount check is the durable guard.
const acquireAmountLock = (detailId, amount, orderKey) => acquireLock(amountLockKey(detailId, amount), orderKey, 30);
const releaseAmountLock = (detailId, amount) => releaseLock(amountLockKey(detailId, amount));

/* ------------------------------ eligibility ------------------------------- */

function traderAcceptsType(trader, depositType) {
  let types = trader.deposit_types;
  if (typeof types === 'string') {
    try { types = JSON.parse(types); } catch (e) { types = ['FTD', 'STD']; }
  }
  if (!Array.isArray(types) || types.length === 0) types = ['FTD', 'STD'];
  return types.includes(depositType);
}

/** True if this account already holds an ACTIVE order for the exact amount. */
async function hasSameAmountActiveOrder(paymentDetailId, amount) {
  const n = await db.Order.count({
    where: { payment_detail_id: paymentDetailId, amount_inr: Number(amount), status: { [Op.in]: ACTIVE } },
  });
  return n > 0;
}

/** First eligible account under a trader for `amount`, or null. */
async function pickEligibleAccount(trader, amount) {
  const accounts = trader.paymentDetails || [];
  const now = Date.now();
  const hourAgo = new Date(now - 3600000);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  for (const account of accounts) {
    if (!account.is_active) continue;
    if (Number(account.min_amount) > 0 && Number(amount) < Number(account.min_amount)) continue;
    if (Number(account.max_amount) > 0 && Number(amount) > Number(account.max_amount)) continue;

    // Same-amount lock.
    // eslint-disable-next-line no-await-in-loop
    if (await hasSameAmountActiveOrder(account.id, amount)) {
      logger.info(`routing: account ${account.upi_id} busy with active ₹${amount} order — skipping (same amount)`);
      continue;
    }

    // Hourly / daily COUNT limits (exclude failed/rejected).
    if (account.max_per_hour) {
      // eslint-disable-next-line no-await-in-loop
      const hourlyCount = await db.Order.count({
        where: { payment_detail_id: account.id, status: { [Op.notIn]: ['failed', 'rejected'] }, created_at: { [Op.gte]: hourAgo } },
      });
      if (hourlyCount >= account.max_per_hour) continue;
    }
    if (account.max_per_day) {
      // eslint-disable-next-line no-await-in-loop
      const dailyCount = await db.Order.count({
        where: { payment_detail_id: account.id, status: { [Op.notIn]: ['failed', 'rejected'] }, created_at: { [Op.gte]: dayStart } },
      });
      if (dailyCount >= account.max_per_day) continue;
    }

    return account;
  }
  return null;
}

/** Online, active, funded traders that accept `depositType`, with their accounts. */
async function eligibleTraders(depositType) {
  const traders = await db.Trader.findAll({
    where: { is_online: true, balance_usdt: { [Op.gt]: 0 } },
    include: [
      { model: db.User, as: 'user', where: { status: 'active' }, attributes: ['id'] },
      { model: db.PaymentDetail, as: 'paymentDetails', where: { is_active: true }, required: true },
    ],
    order: [['id', 'ASC']],
  });
  return traders.filter((t) => traderAcceptsType(t, depositType));
}

/**
 * Read-only availability check (before creating an order).
 * @returns {Promise<{trader, paymentDetail}|null>}
 */
async function findAvailableTrader(amountInr, depositType = 'STD') {
  const amount = Number(amountInr);
  const traders = await eligibleTraders(depositType);
  logger.info(`routing: findAvailableTrader(₹${amount}, ${depositType}) — ${traders.length} eligible trader(s)`);

  for (const trader of traders) {
    if (Number(trader.daily_limit) > 0 && Number(trader.current_daily_used) + amount > Number(trader.daily_limit)) continue;
    // eslint-disable-next-line no-await-in-loop
    const account = await pickEligibleAccount(trader, amount);
    if (account) {
      logger.info(`routing: selected trader ${trader.id}, account ${account.upi_id}`);
      return { trader, paymentDetail: account };
    }
  }
  logger.warn(`routing: no eligible trader/account for ₹${amount} ${depositType}`);
  return null;
}

/* --------------------------- assignment (reassign) ------------------------ */
/**
 * Assign/re-assign an existing order to an eligible trader+account. Used by the
 * "get new UPI" reassign and the retry sweep. Sets trader_id/payment_detail_id
 * and status → pending.
 * @returns {Promise<{trader, paymentDetail}|null>}
 */
async function assignTraderToOrder(order, { excludeTraderId } = {}) {
  const amount = Number(order.amount_inr);
  const depositType = order.deposit_type || 'STD';
  const traders = (await eligibleTraders(depositType)).filter((t) => t.id !== excludeTraderId);

  for (const trader of traders) {
    if (Number(trader.daily_limit) > 0 && Number(trader.current_daily_used) + amount > Number(trader.daily_limit)) continue;
    // eslint-disable-next-line no-await-in-loop
    const account = await pickEligibleAccount(trader, amount);
    if (!account) continue;

    // eslint-disable-next-line no-await-in-loop
    await order.update({ trader_id: trader.id, payment_detail_id: account.id, status: 'pending', expires_at: new Date(Date.now() + config.platform.orderExpiryMinutes * 60 * 1000) });
    const payload = upiService.paymentPayload(order, account);
    emitToTrader(trader.id, 'order:assigned', { order_id: order.id, uuid: order.uuid, amount_inr: order.amount_inr, ...payload });
    emitToAdmin('order:assigned', { order_id: order.id, trader_id: trader.id });
    logger.info(`routing: order ${order.id} -> trader ${trader.id} (account ${account.id})`);
    return { trader, paymentDetail: account };
  }

  await queueOrder(order);
  return null;
}

async function queueOrder(order) {
  if (isRedisAvailable()) {
    try { await connection.rpush(ORDER_QUEUE_KEY, String(order.id)); } catch (err) { /* noop */ }
  }
  broadcast('order:new', { order_id: order.id, uuid: order.uuid, amount_inr: order.amount_inr });
  logger.warn(`routing: no trader available, queued order ${order.id}`);
}

/** Reassign an order to a DIFFERENT trader (customer clicked "Get new UPI"). */
async function getNewUpiId(orderId) {
  const order = await db.Order.findByPk(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (['success', 'failed', 'rejected'].includes(order.status)) {
    throw Object.assign(new Error(`Order is ${order.status}`), { status: 409 });
  }
  const previousTraderId = order.trader_id;
  if (previousTraderId) await releaseTrader(previousTraderId, order.id);
  await order.update({ trader_id: null, payment_detail_id: null, status: 'pending' });

  const result = await assignTraderToOrder(order, { excludeTraderId: previousTraderId });
  if (!result) return null;
  const fresh = await db.Order.findByPk(orderId, { include: [{ model: db.PaymentDetail, as: 'paymentDetail' }] });
  return { order: fresh, paymentDetail: result.paymentDetail };
}

/** Retry pass — assign any still-unassigned pending orders. */
async function retryQueuedOrders() {
  const now = new Date();
  const pending = await db.Order.findAll({
    where: { status: 'pending', trader_id: null, [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: now } }] },
    order: [['created_at', 'ASC']],
    limit: 50,
  });
  if (!pending.length) return 0;
  let assigned = 0;
  for (const order of pending) {
    // eslint-disable-next-line no-await-in-loop
    const result = await assignTraderToOrder(order);
    if (result) {
      assigned += 1;
      // eslint-disable-next-line no-await-in-loop
      await order.reload();
      emitToOrder(order.uuid, 'order:assigned', { order_id: order.uuid, status: order.status });
      emitToMerchant(order.merchant_id, 'order:assigned', { order_id: order.uuid, status: order.status });
    }
  }
  if (assigned) logger.info(`routing: retry pass assigned ${assigned}/${pending.length} order(s)`);
  return assigned;
}

module.exports = {
  findAvailableTrader,
  assignTraderToOrder,
  releaseTrader,
  getNewUpiId,
  retryQueuedOrders,
  acquireTraderLock,
  isTraderLocked,
  acquireAmountLock,
  releaseAmountLock,
  hasSameAmountActiveOrder,
  ORDER_QUEUE_KEY,
};
