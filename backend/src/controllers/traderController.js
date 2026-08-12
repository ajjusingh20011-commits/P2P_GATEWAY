'use strict';

/**
 * traderController — endpoints for the authenticated trader panel + APK.
 * All handlers resolve the trader profile from req.user (role 'trader').
 */

const Joi = require('joi');
const { Op } = require('sequelize');
const axios = require('axios');

const db = require('../models');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const { emitToAdmin } = require('../websocket');
const logger = require('../utils/logger');
const balanceService = require('../services/balanceService');
const rateService = require('../services/rateService');
const { computeWindowUsage } = require('../services/usageWindows');
const { internalAuthHeaders } = require('../services/ngoServiceAuth');
const accountScore = require('../services/accountScore');

/** Load the Trader row for the current user, or 404. */
async function currentTrader(req, res) {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) {
    fail(res, 404, 'Trader profile not found');
    return null;
  }
  return trader;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Success rate measures how well a trader handles payments the CUSTOMER
 * claimed to have made. An order therefore only counts — as a success or as a
 * failure — if the customer actually pressed "I paid" at some point, whatever
 * settled it afterwards (trader confirm, or automatic APK/Web-Login matching).
 *
 * An order the system detected and settled on its own, with the customer never
 * claiming anything, is excluded from BOTH sides of the fraction: the money
 * moved, but nothing about it reflects the trader's claim handling, so it must
 * not move the stated rate in either direction.
 *
 * `customer_confirmed_at` is the right field and already exists — written in
 * exactly one place, orderController.claimPaid, i.e. the "I paid" click, and
 * described by its own migration as "when the customer clicked Continue /
 * confirmed paid".
 *
 * NOT `claimed_paid_at`, despite the name: smartMerge.mergePaymentData also
 * stamps that when a SYSTEM-detected payment lands below the auto-confirm
 * threshold, with no customer involvement at all. Using it would have counted
 * exactly the orders this rule is meant to exclude.
 */
const CUSTOMER_CLAIMED = { customer_confirmed_at: { [Op.ne]: null } };

/* ---------------------------- GET /dashboard ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const today = startOfToday();
  const [todayOrders, confirmedToday, closedToday, volume, ftdToday, stdToday] = await Promise.all([
    db.Order.count({ where: { trader_id: trader.id, created_at: { [Op.gte]: today } } }),
    // Both sides of success_rate are gated on CUSTOMER_CLAIMED — see above.
    db.Order.count({ where: { trader_id: trader.id, status: 'success', created_at: { [Op.gte]: today }, ...CUSTOMER_CLAIMED } }),
    db.Order.count({ where: { trader_id: trader.id, status: { [Op.in]: ['success', 'failed', 'rejected', 'disputed'] }, created_at: { [Op.gte]: today }, ...CUSTOMER_CLAIMED } }),
    db.Order.sum('amount_inr', { where: { trader_id: trader.id, status: 'success', created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { trader_id: trader.id, deposit_type: 'FTD', created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { trader_id: trader.id, deposit_type: 'STD', created_at: { [Op.gte]: today } } }),
  ]);

  const summary = await balanceService.traderBalanceSummary(trader.id);

  // Rate-margin info for the "My Rate" card: base + trader_margin% = trader_rate.
  const baseRate = await rateService.getBaseRate();
  const traderMargin = Number(trader.trader_margin);
  const traderRate = +(baseRate * (1 + traderMargin / 100)).toFixed(4);

  return ok(res, {
    balance_usdt: trader.balance_usdt,
    available_usdt: summary ? summary.available_usdt : trader.balance_usdt,
    locked_usdt: summary ? summary.locked_usdt : 0,
    commission_today_usdt: summary ? summary.commission_today_usdt : 0,
    commission_total_usdt: summary ? summary.commission_total_usdt : 0,
    // Rate-margin fields.
    base_rate: baseRate,
    trader_margin: traderMargin,
    trader_rate: traderRate,
    // "My Rate" — the trader's margin %, labelled per rate_label.
    my_rate: traderMargin,
    rate_label: trader.rate_label,
    commission_rate: Number(trader.commission_rate),
    today_trades: todayOrders,
    today_volume_inr: volume || 0,
    ftd_today: ftdToday,
    std_today: stdToday,
    // Same formula as the per-account score (accountScore.computeRate), so the
    // panel never shows two differently-derived rates. Scoping differs by
    // design: this one is today-wide for the trader, the per-account one is
    // scoped to that account's current live session.
    success_rate: accountScore.computeRate(confirmedToday, closedToday),
    is_online: trader.is_online,
    daily_limit: trader.daily_limit,
    current_daily_used: trader.current_daily_used,
  });
});

/* ------------------------------ GET /stats --------------------------------- */
// Real period support for the dashboard's Volume + Success Rate cards
// (previously today-only, hardcoded inside dashboard() above). A separate
// endpoint rather than a `period` param on /dashboard: /dashboard's other
// fields (balance, ftd/std counts, is_online, daily_limit...) are genuinely
// today/point-in-time concepts and shouldn't become ambiguous based on a
// volume-card period selector. period ∈ today | week | month | overall
// ('overall' = no lower bound, all-time). Mirrors commission()'s window
// logic/semantics above, just for orders instead of the rate-spread calc.
const stats = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const period = ['today', 'week', 'month', 'overall'].includes(req.query.period) ? req.query.period : 'today';
  let start = null;
  if (period === 'today') {
    start = startOfToday();
  } else if (period === 'week') {
    start = new Date();
    start.setDate(start.getDate() - 7);
  } else if (period === 'month') {
    start = new Date();
    start.setDate(start.getDate() - 30);
  } // 'overall' -> start stays null, no lower bound

  const where = (extra) => {
    const w = { trader_id: trader.id, ...extra };
    if (start) w.created_at = { [Op.gte]: start };
    return w;
  };

  const [totalOrders, confirmedOrders, closedOrders, volume] = await Promise.all([
    db.Order.count({ where: where({}) }),
    // success_rate only — gated on CUSTOMER_CLAIMED. `trades` and `volume_inr`
    // deliberately are NOT: those are real activity and real money, and an
    // auto-detected settlement is both.
    db.Order.count({ where: where({ status: 'success', ...CUSTOMER_CLAIMED }) }),
    db.Order.count({ where: where({ status: { [Op.in]: ['success', 'failed', 'rejected', 'disputed'] }, ...CUSTOMER_CLAIMED }) }),
    db.Order.sum('amount_inr', { where: where({ status: 'success' }) }),
  ]);

  return ok(res, {
    period,
    volume_inr: volume || 0,
    trades: totalOrders,
    success_rate: accountScore.computeRate(confirmedOrders, closedOrders),
  });
});

/* ---------------------------- GET /commission ----------------------------- */
// Commission a trader earns over a period = the rate spread they keep vs the
// base rate on each CONFIRMED order: (amount_inr / base_rate) − trader_deduction.
// The trader gives up amount_inr/trader_rate USDT but the INR is worth
// amount_inr/base_rate at base — the difference is their earning.
// period ∈ today | week | month. Returns the total in BOTH USDT and INR (the
// panel toggles between them) + the trade count + a delta% vs the previous
// equal-length window.
const commission = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'today';
  const now = new Date();
  const start = new Date(now);
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else if (period === 'week') start.setDate(now.getDate() - 7);
  else start.setDate(now.getDate() - 30);

  // Previous equal-length window, for the delta%.
  const windowMs = now.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - windowMs);

  const currentBase = await rateService.getBaseRate();

  // Sum the rate-spread earning over confirmed orders in [from, to).
  const sumWindow = async (from, to) => {
    const rows = await db.Order.findAll({
      where: {
        trader_id: trader.id,
        status: 'success',
        confirmed_at: { [Op.gte]: from, [Op.lt]: to },
      },
      attributes: ['amount_inr', 'exchange_rate', 'trader_rate', 'trader_deduction_usdt'],
    });
    let usdt = 0;
    let inr = 0;
    for (const o of rows) {
      const amt = Number(o.amount_inr) || 0;
      const base = Number(o.exchange_rate) || currentBase;
      const traderRate = Number(o.trader_rate) || null;
      // What the trader actually gave up (prefer the stored deduction).
      const gave = o.trader_deduction_usdt != null
        ? Number(o.trader_deduction_usdt)
        : (traderRate ? amt / traderRate : amt / base);
      const baseValue = base ? amt / base : 0;
      const keptUsdt = baseValue - gave;
      usdt += keptUsdt;
      inr += keptUsdt * base;
    }
    return { usdt, trades: rows.length, inr };
  };

  const cur = await sumWindow(start, now);
  const prev = await sumWindow(prevStart, start);

  const valueUsdt = cur.usdt < 0 ? 0 : +cur.usdt.toFixed(8);
  const valueInr = cur.inr < 0 ? 0 : +cur.inr.toFixed(2);
  let deltaPct = null;
  if (prev.usdt > 0) deltaPct = +(((cur.usdt - prev.usdt) / prev.usdt) * 100).toFixed(1);
  else if (cur.usdt > 0) deltaPct = 100;

  return ok(res, {
    period,
    value_usdt: valueUsdt,
    value_inr: valueInr,
    trades: cur.trades,
    delta_pct: deltaPct,
    base_rate: currentBase,
  });
});

/* --------------------------- GET /balance-logs ---------------------------- */
const balanceLogs = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const { page, limit, offset } = pagination(req.query);
  const { rows, count } = await db.BalanceLog.findAndCountAll({
    where: { trader_id: trader.id },
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  const summary = await balanceService.traderBalanceSummary(trader.id);
  return ok(res, { logs: rows, summary, pagination: { page, limit, total: count } });
});

/* ------------------------------ GET /orders ------------------------------- */
const orders = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const where = { trader_id: trader.id };
  if (req.query.status) where.status = req.query.status;
  else where.status = { [Op.in]: db.Order.ACTIVE_STATUSES }; // active by default

  const rows = await db.Order.findAll({
    where,
    include: [{ model: db.PaymentDetail, as: 'paymentDetail', attributes: ['id', 'upi_id', 'account_type', 'account_name'] }],
    order: [['created_at', 'DESC']],
  });
  return ok(res, { orders: rows });
});

/* ---------------------------- PUT /heartbeat ------------------------------ */
// APK pings every 30s → mark trader online, refresh last_heartbeat.
const heartbeat = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const wasOffline = !trader.is_online;
  await trader.update({ is_online: true, last_heartbeat: new Date() });
  if (wasOffline) emitToAdmin('trader:online', { trader_id: trader.id });

  return ok(res, { online: true, ts: new Date().toISOString() });
});

/* ------------------------- PUT /online-status ----------------------------- */
// Trader flips their Activity toggle in the panel sidebar. Updates
// traders.is_online so the routing engine includes/excludes them. Going online
// also refreshes last_heartbeat so they're immediately assignable.
const onlineStatusSchema = Joi.object({ is_online: Joi.boolean().required() });

const setOnlineStatus = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const { error, value } = onlineStatusSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  await trader.update({
    is_online: value.is_online,
    ...(value.is_online ? { last_heartbeat: new Date() } : {}),
  });
  emitToAdmin('trader:status', { trader_id: trader.id, is_online: value.is_online });

  return ok(res, { trader_id: trader.id, is_online: value.is_online });
});

/* -------------------------- GET /payment-details -------------------------- */
// Includes live limit-usage per detail: real hour/day/week/month COUNT +
// AMOUNT totals of CONFIRMED (`success`) orders — the same shared
// computeWindowUsage() routingEngine.pickEligibleAccount uses to enforce
// max_per_hour/day/week/month and hourly/daily/weekly/monthly_limit(_amount),
// so what's displayed here and what's enforced there can never drift apart.
const listPaymentDetails = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const details = await db.PaymentDetail.findAll({ where: { trader_id: trader.id }, order: [['id', 'ASC']] });

  const withUsage = await Promise.all(
    details.map(async (d) => {
      const [windowUsage, score] = await Promise.all([
        computeWindowUsage(d.id, d.monthly_start_date, { statusWhere: 'success' }),
        // Session-scoped score (services/accountScore.js): the account's
        // performance since it last entered the live pool, not a lifetime
        // record. Returns the spec's formula, including the 50/y branch when
        // there are no successes, and null when nothing is scored yet.
        accountScore.sessionScore(d),
      ]);
      return {
        ...d.toJSON(),
        usage: {
          used_this_hour: windowUsage.used_this_hour,
          used_today: windowUsage.used_today,
          used_this_week: windowUsage.used_this_week,
          used_this_month: windowUsage.used_this_month,
          hourly_amount_total: windowUsage.hourly_amount_total,
          daily_amount_total: windowUsage.daily_amount_total,
          weekly_amount_total: windowUsage.weekly_amount_total,
          monthly_amount_total: windowUsage.monthly_amount_total,
          // Success-rate figures for this account's CURRENT live session.
          orders_total: score.scored,
          orders_confirmed: score.successes,
          // The spec's rate, computed server-side so the panel cannot derive
          // a different number from the same counts (the 50/y branch is not
          // recoverable from confirmed/total alone).
          success_rate: score.rate,
          session_started_at: score.sessionStartedAt,
        },
      };
    })
  );

  // Convenience grouping by bank for the two-column "Details" panel. The flat
  // `payment_details` array is kept as the source of truth for other consumers.
  const grouped = withUsage.reduce((acc, d) => {
    const key = d.bank_name || d.organization_name || 'Other';
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});

  return ok(res, { payment_details: withUsage, grouped });
});

const paymentDetailSchema = Joi.object({
  account_name: Joi.string().min(2).max(191).required().messages({
    'string.min': 'Title / name must be at least 2 characters',
    'any.required': 'Title / name is required',
  }),
  upi_id: Joi.string()
    .max(191)
    .pattern(/^[^@\s]+@[^@\s]+$/)
    .required()
    .messages({
      'string.pattern.base': 'Enter a valid UPI ID (example: name@bank) — it must contain "@"',
      'any.required': 'UPI ID is required',
    }),
  bank_name: Joi.string().max(191).allow('', null),
  organization_name: Joi.string().max(255).allow('', null),
  account_type: Joi.string().valid('gpay', 'phonepe', 'paytm', 'bharat_pe', 'airtel').required(),
  daily_limit: Joi.number().min(0).default(0),
  smartphone_id: Joi.number().integer().allow(null),
  ngo_device_id: Joi.string().allow(null, ''),
  // Per-transaction bounds + count/amount window limits (all optional).
  min_amount: Joi.number().min(0).default(0),
  max_amount: Joi.number().min(0).default(500000),
  max_per_hour: Joi.number().integer().min(0).default(100),
  max_per_day: Joi.number().integer().min(0).default(1000),
  max_per_week: Joi.number().integer().min(0).default(5000),
  max_per_month: Joi.number().integer().min(0).default(20000),
  monthly_limit: Joi.number().min(0).allow(null),
  weekly_limit: Joi.number().min(0).allow(null),
  daily_limit_amount: Joi.number().min(0).allow(null),
  hourly_limit_amount: Joi.number().min(0).allow(null),
  monthly_start_date: Joi.date().allow(null),
  is_active_detail: Joi.boolean().default(true),
  is_active: Joi.boolean().default(true),
  // Trader takes on confirming this account's payments by hand. Defaults to
  // false so a newly added account never quietly enters the routing pool
  // without a real connection — see routingEngine.pickEligibleAccount.
  manually_confirmed: Joi.boolean().default(false),
});

const UPI_TAKEN_MESSAGE = 'This UPI ID is already registered on the platform';

/**
 * Throws a friendly error if `upiId` is already in use — locally in
 * `payment_details` (optionally excluding one row, for updates) and, best
 * effort, in ngo-backend's `Account` collection. A down/unreachable
 * ngo-backend must not block a trader from saving a payment detail, so the
 * cross-service check fails open (logs and continues) on any network error.
 */
// `excludeNgoAccountId` exists for the NGO-account → payment_details mirror
// bridge (syncNgoAccountToPaymentDetail in the trader frontend): when it
// creates/updates a payment_details row FOR an NGO account, that account
// already exists in ngo-backend's own DB with the same UPI, so the
// cross-service check would otherwise always find "itself" and reject the
// mirror as a false-positive duplicate. Excluding it here only weakens the
// specific check "does this UPI belong to a DIFFERENT NGO account" — the
// local `payment_details` uniqueness check just above is untouched, so a
// genuine duplicate on this side is still rejected regardless.
async function assertUpiAvailable(upiId, { excludeId, excludeNgoAccountId } = {}) {
  const where = { upi_id: upiId };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await db.PaymentDetail.findOne({ where });
  if (existing) {
    throw Object.assign(new Error(UPI_TAKEN_MESSAGE), { status: 422 });
  }

  try {
    const base = process.env.NGO_BACKEND_URL || 'http://localhost:3000';
    const params = { upi_id: upiId };
    if (excludeNgoAccountId) params.exclude_account_id = excludeNgoAccountId;
    const res = await axios.get(`${base}/api/internal/upi-check`, {
      params,
      timeout: 3000,
      headers: internalAuthHeaders(),
    });
    if (res.data?.exists) {
      throw Object.assign(new Error(UPI_TAKEN_MESSAGE), { status: 422 });
    }
  } catch (err) {
    if (err.status === 422) throw err;
    logger.warn(`assertUpiAvailable: ngo-backend cross-check unreachable, proceeding — ${err.message}`);
  }
}

/* -------------------------- POST /payment-details ------------------------- */
const addPaymentDetail = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  // Not a real payment_details column — pulled out before Joi validation so
  // it never reaches the schema/DB, only used to steer the UPI cross-check
  // below (see assertUpiAvailable's comment).
  const { ngo_account_id: excludeNgoAccountId, ...body } = req.body;
  const { error, value } = paymentDetailSchema.validate(body);
  if (error) return fail(res, 422, error.details[0].message);

  try {
    await assertUpiAvailable(value.upi_id, { excludeNgoAccountId });
  } catch (err) {
    if (err.status === 422) return fail(res, 422, err.message);
    throw err;
  }

  try {
    const detail = await db.PaymentDetail.create({ ...value, trader_id: trader.id });
    return created(res, { payment_detail: detail });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, 422, UPI_TAKEN_MESSAGE);
    }
    // Surface the exact failure (e.g. an "Unknown column" DB error) instead of
    // the generic 500 the global handler would emit.
    logger.error(`addPaymentDetail failed for trader ${trader.id}`, err);
    return res.status(500).json({
      success: false,
      error: err.message,
      message: err.message,
      code: err.parent?.code || err.original?.code,
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
    });
  }
});

/* ------------------------ PUT /payment-details/:id ------------------------ */
// Toggle active/inactive (or patch fields).
const updatePaymentDetail = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const detail = await db.PaymentDetail.findOne({ where: { id: req.params.id, trader_id: trader.id } });
  if (!detail) return fail(res, 404, 'Payment detail not found');

  // Patchable fields (only apply the ones supplied).
  const patch = {};
  const bools = ['is_active', 'is_active_detail', 'manually_confirmed'];
  const passthrough = [
    'account_name', 'upi_id', 'bank_name', 'organization_name', 'account_type', 'daily_limit', 'smartphone_id',
    'ngo_device_id',
    'min_amount', 'max_amount', 'max_per_hour', 'max_per_day', 'max_per_week', 'max_per_month',
    'monthly_limit', 'weekly_limit', 'daily_limit_amount', 'hourly_limit_amount', 'monthly_start_date',
  ];
  bools.forEach((k) => { if (typeof req.body[k] === 'boolean') patch[k] = req.body[k]; });
  passthrough.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });

  if (patch.upi_id && patch.upi_id !== detail.upi_id) {
    try {
      // Not a real column — `passthrough` above never copies it into `patch`.
      await assertUpiAvailable(patch.upi_id, { excludeId: detail.id, excludeNgoAccountId: req.body.ngo_account_id });
    } catch (err) {
      if (err.status === 422) return fail(res, 422, err.message);
      throw err;
    }
  }

  // Entering the live pool starts a FRESH scoring session: the previous
  // score is discarded. This is deliberate and is the only recovery path for
  // an account that fell below the routing threshold — it stops receiving
  // orders, so its score can never improve on its own. Only a genuine
  // off -> on transition counts; re-saving an already-on account must not
  // wipe the score it has accumulated this session.
  const enteringPool = patch.is_active_detail === true && detail.is_active_detail === false;

  try {
    await detail.update(patch);
    if (enteringPool) await accountScore.startSession(detail.id);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, 422, UPI_TAKEN_MESSAGE);
    }
    throw err;
  }

  return ok(res, { payment_detail: detail });
});

/* ----------------------- DELETE /payment-details/:id ---------------------- */
const deletePaymentDetail = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const detail = await db.PaymentDetail.findOne({ where: { id: req.params.id, trader_id: trader.id } });
  if (!detail) return fail(res, 404, 'Payment detail not found');

  await detail.destroy();
  return ok(res, { deleted: true, id: Number(req.params.id) });
});

/* --------------------------- GET /notifications --------------------------- */
const notifications = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const { page, limit, offset } = pagination(req.query);
  const { rows, count } = await db.NotificationLog.findAndCountAll({
    where: { trader_id: trader.id },
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return ok(res, { notifications: rows, pagination: { page, limit, total: count } });
});

/* ------------------------------ GET /payouts ------------------------------ */
const listPayouts = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const rows = await db.Payout.findAll({ where: { trader_id: trader.id }, order: [['created_at', 'DESC']] });
  return ok(res, { payouts: rows });
});

const payoutSchema = Joi.object({
  amount_usdt: Joi.number().positive().required(),
  payment_method: Joi.string().max(50).default('USDT (TRC20)'),
});

/* ----------------------------- POST /payouts ------------------------------ */
const requestPayout = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const { error, value } = payoutSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  if (Number(value.amount_usdt) > Number(trader.balance_usdt)) {
    return fail(res, 422, 'Requested amount exceeds available balance');
  }

  const rate = 89;
  const payout = await db.Payout.create({
    trader_id: trader.id,
    amount_usdt: value.amount_usdt,
    amount_inr: Math.round(value.amount_usdt * rate),
    payment_method: value.payment_method,
    status: 'awaiting',
  });
  emitToAdmin('payout:requested', { payout_id: payout.id, trader_id: trader.id, amount_usdt: value.amount_usdt });
  return created(res, { payout });
});

module.exports = {
  dashboard,
  stats,
  commission,
  balanceLogs,
  orders,
  heartbeat,
  setOnlineStatus,
  listPaymentDetails,
  addPaymentDetail,
  updatePaymentDetail,
  deletePaymentDetail,
  notifications,
  listPayouts,
  requestPayout,
};
