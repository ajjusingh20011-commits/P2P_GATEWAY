'use strict';

/**
 * traderController — endpoints for the authenticated trader panel + APK.
 * All handlers resolve the trader profile from req.user (role 'trader').
 */

const Joi = require('joi');
const { Op } = require('sequelize');

const db = require('../models');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const { emitToAdmin } = require('../websocket');
const logger = require('../utils/logger');
const balanceService = require('../services/balanceService');
const rateService = require('../services/rateService');

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

/* ---------------------------- GET /dashboard ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const today = startOfToday();
  const [todayOrders, confirmedToday, closedToday, volume, ftdToday, stdToday] = await Promise.all([
    db.Order.count({ where: { trader_id: trader.id, created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { trader_id: trader.id, status: 'success', created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { trader_id: trader.id, status: { [Op.in]: ['success', 'failed', 'rejected', 'disputed'] }, created_at: { [Op.gte]: today } } }),
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
    admin_margin: Number(trader.admin_margin),
    // "My Rate" — the trader's margin %, labelled per rate_label.
    my_rate: traderMargin,
    rate_label: trader.rate_label,
    commission_rate: Number(trader.commission_rate),
    today_trades: todayOrders,
    today_volume_inr: volume || 0,
    ftd_today: ftdToday,
    std_today: stdToday,
    success_rate: closedToday ? +((confirmedToday / closedToday) * 100).toFixed(1) : 100,
    is_online: trader.is_online,
    daily_limit: trader.daily_limit,
    current_daily_used: trader.current_daily_used,
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
// Includes live limit-usage per detail: transactions today / this hour, and
// today's confirmed amount total.
const listPaymentDetails = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const details = await db.PaymentDetail.findAll({ where: { trader_id: trader.id }, order: [['id', 'ASC']] });
  const startToday = startOfToday();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const withUsage = await Promise.all(
    details.map(async (d) => {
      const [usedToday, usedThisHour, amountToday, ordersTotal, ordersConfirmed] = await Promise.all([
        db.Order.count({ where: { payment_detail_id: d.id, status: 'success', created_at: { [Op.gte]: startToday } } }),
        db.Order.count({ where: { payment_detail_id: d.id, status: 'success', created_at: { [Op.gte]: hourAgo } } }),
        db.Order.sum('amount_inr', { where: { payment_detail_id: d.id, status: 'success', created_at: { [Op.gte]: startToday } } }),
        // Success-rate counts (all-time, COUNTS not amounts): confirmed / total.
        db.Order.count({ where: { payment_detail_id: d.id } }),
        db.Order.count({ where: { payment_detail_id: d.id, status: 'success' } }),
      ]);
      return {
        ...d.toJSON(),
        usage: {
          used_today: usedToday,
          used_this_hour: usedThisHour,
          daily_amount_total: amountToday || 0,
          orders_total: ordersTotal,
          orders_confirmed: ordersConfirmed,
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
});

/* -------------------------- POST /payment-details ------------------------- */
const addPaymentDetail = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;

  const { error, value } = paymentDetailSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  try {
    const detail = await db.PaymentDetail.create({ ...value, trader_id: trader.id });
    return created(res, { payment_detail: detail });
  } catch (err) {
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
  const bools = ['is_active', 'is_active_detail'];
  const passthrough = [
    'account_name', 'upi_id', 'bank_name', 'organization_name', 'account_type', 'daily_limit', 'smartphone_id',
    'min_amount', 'max_amount', 'max_per_hour', 'max_per_day', 'max_per_week', 'max_per_month',
    'monthly_limit', 'weekly_limit', 'daily_limit_amount', 'hourly_limit_amount', 'monthly_start_date',
  ];
  bools.forEach((k) => { if (typeof req.body[k] === 'boolean') patch[k] = req.body[k]; });
  passthrough.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  await detail.update(patch);

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
