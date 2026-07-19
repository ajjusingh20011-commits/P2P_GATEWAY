'use strict';

/**
 * adminController — platform administration.
 * All routes are guarded by verifyToken + checkRole('admin').
 */

const Joi = require('joi');
const { Op } = require('sequelize');

const db = require('../models');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const authService = require('../services/authService');
const smartMerge = require('../services/smartMerge');
const routingEngine = require('../services/routingEngine');
const balanceService = require('../services/balanceService');
const settingsService = require('../services/settingsService');
const { apiKey: genApiKey, apiSecret: genApiSecret } = require('../utils/ids');
const { emitToTrader, emitToMerchant, emitToAdmin, emitToOrder } = require('../websocket');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ---------------------------- GET /dashboard ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const today = startOfToday();
  const [activeTraders, onlineTraders, activeMerchants, ordersToday, confirmedToday, volumeToday, openDisputes, platformRevenue] =
    await Promise.all([
      db.Trader.count({ include: [{ model: db.User, as: 'user', where: { status: 'active' }, attributes: [] }] }),
      db.Trader.count({ where: { is_online: true } }),
      db.Merchant.count({ where: { is_active: true } }),
      db.Order.count({ where: { created_at: { [Op.gte]: today } } }),
      db.Order.count({ where: { status: 'success', created_at: { [Op.gte]: today } } }),
      db.Order.sum('amount_inr', { where: { status: 'success', created_at: { [Op.gte]: today } } }),
      db.Dispute.count({ where: { status: { [Op.in]: ['open', 'reviewing'] } } }),
      settingsService.getNumber('platform_revenue_usdt', 0),
    ]);

  return ok(res, {
    volume_today_inr: volumeToday || 0,
    active_traders: activeTraders,
    online_traders: onlineTraders,
    active_merchants: activeMerchants,
    transactions_today: ordersToday,
    success_rate: ordersToday ? +((confirmedToday / ordersToday) * 100).toFixed(1) : 100,
    open_disputes: openDisputes,
    platform_revenue_usdt: platformRevenue || 0,
  });
});

/* ------------------------------- TRADERS ---------------------------------- */
const listTraders = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const { rows, count } = await db.Trader.findAndCountAll({
    include: [{ model: db.User, as: 'user', attributes: ['email', 'status'] }],
    order: [['id', 'ASC']],
    limit,
    offset,
  });
  return ok(res, { traders: rows, pagination: { page, limit, total: count } });
});

const createTraderSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  daily_limit: Joi.number().min(0).default(500000),
});

const createTrader = asyncHandler(async (req, res) => {
  const { error, value } = createTraderSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  const exists = await db.User.findOne({ where: { email: value.email } });
  if (exists) return fail(res, 409, 'Email already in use');

  const result = await db.sequelize.transaction(async (t) => {
    const user = await db.User.create(
      { email: value.email, password_hash: await authService.hashPassword(value.password), role: 'trader', status: 'active' },
      { transaction: t }
    );
    const trader = await db.Trader.create(
      { user_id: user.id, daily_limit: value.daily_limit, balance_usdt: 0 },
      { transaction: t }
    );
    return { user, trader };
  });

  return created(res, { trader: { id: result.trader.id, user_id: result.user.id, email: result.user.email } });
});

const updateTrader = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id, { include: [{ model: db.User, as: 'user' }] });
  if (!trader) return fail(res, 404, 'Trader not found');

  const patch = {};
  ['daily_limit', 'balance_usdt', 'commission_rate', 'payout_commission', 'rate_label', 'telegram_chat_id']
    .forEach((k) => { if (req.body[k] != null) patch[k] = req.body[k]; });
  // deposit_types: keep only valid FTD/STD; ignore empty (must accept ≥1 type).
  if (req.body.deposit_types != null) {
    let arr = req.body.deposit_types;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = [arr]; } }
    if (Array.isArray(arr)) {
      const valid = [...new Set(arr.filter((x) => ['FTD', 'STD'].includes(x)))];
      if (valid.length) patch.deposit_types = valid;
    }
  }
  if (Object.keys(patch).length) await trader.update(patch);
  if (req.body.status && trader.user) await trader.user.update({ status: req.body.status });

  return ok(res, { trader });
});

/* ------------------- POST /traders/create (full form) --------------------- */
const createTraderFullSchema = Joi.object({
  full_name: Joi.string().max(191).allow('', null),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  commission_rate: Joi.number().min(0).max(100).default(2.0),
  payout_commission: Joi.number().min(0).max(100).default(0.5),
  initial_balance_usdt: Joi.number().min(0).default(0),
  daily_limit: Joi.number().min(0).default(500000),
  telegram_chat_id: Joi.string().max(64).allow('', null),
  deposit_types: Joi.array().items(Joi.string().valid('FTD', 'STD')).min(1).default(['FTD', 'STD']),
});

const createTraderFull = asyncHandler(async (req, res) => {
  const { error, value } = createTraderFullSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  const exists = await db.User.findOne({ where: { email: value.email } });
  if (exists) return fail(res, 409, 'Email already in use');

  const result = await db.sequelize.transaction(async (t) => {
    const user = await db.User.create(
      { email: value.email, password_hash: await authService.hashPassword(value.password), role: 'trader', status: 'active' },
      { transaction: t }
    );
    const trader = await db.Trader.create(
      {
        user_id: user.id,
        daily_limit: value.daily_limit,
        balance_usdt: value.initial_balance_usdt || 0,
        commission_rate: value.commission_rate,
        payout_commission: value.payout_commission,
        telegram_chat_id: value.telegram_chat_id || null,
        deposit_types: value.deposit_types,
      },
      { transaction: t }
    );
    return { user, trader };
  });

  // Log the opening deposit (outside the create txn; balance already set).
  if (value.initial_balance_usdt > 0) {
    await db.BalanceLog.create({
      trader_id: result.trader.id,
      type: 'deposit',
      amount_usdt: value.initial_balance_usdt,
      balance_after: value.initial_balance_usdt,
      note: 'Initial deposit',
    });
  }

  emitToAdmin('trader:created', { trader_id: result.trader.id, email: value.email });
  // Return the plaintext password once so the admin can hand it over.
  return created(res, {
    trader: {
      id: result.trader.id,
      user_id: result.user.id,
      full_name: value.full_name || null,
      email: value.email,
      commission_rate: value.commission_rate,
      payout_commission: value.payout_commission,
      balance_usdt: value.initial_balance_usdt || 0,
    },
    credentials: { email: value.email, password: value.password },
  });
});

/* --------------------- PUT /traders/:id/balance --------------------------- */
const balanceSchema = Joi.object({
  action: Joi.string().valid('add', 'deduct').required(),
  amount_usdt: Joi.number().positive().required(),
  note: Joi.string().max(255).allow('', null),
});

const updateTraderBalance = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id);
  if (!trader) return fail(res, 404, 'Trader not found');

  const { error, value } = balanceSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  if (value.action === 'deduct' && Number(trader.balance_usdt) < value.amount_usdt) {
    return fail(res, 422, 'Deduction exceeds current balance');
  }

  const { balance_after, log } = await balanceService.adminAdjust(
    trader.id, value.action, value.amount_usdt, value.note
  );
  emitToTrader(trader.id, 'balance:updated', { balance_usdt: balance_after, change: value.action, amount_usdt: value.amount_usdt });
  emitToAdmin('trader:balance', { trader_id: trader.id, balance_usdt: balance_after });

  return ok(res, { trader_id: trader.id, balance_usdt: balance_after, log_id: log.id });
});

/* --------------------- PUT /traders/:id/commission ------------------------ */
// Set the trader's rate margins (and legacy commission fields). trader_margin is
// "My Rate" %, admin_margin is the admin profit %. commission_rate is kept in
// sync with trader_margin so older readers stay consistent.
const commissionSchema = Joi.object({
  trader_margin: Joi.number().min(0).max(100),
  admin_margin: Joi.number().min(0).max(100),
  commission_rate: Joi.number().min(0).max(100),
  payout_commission: Joi.number().min(0).max(100),
}).or('trader_margin', 'commission_rate');

const updateTraderCommission = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id);
  if (!trader) return fail(res, 404, 'Trader not found');

  const { error, value } = commissionSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  // trader_margin drives "My Rate"; keep commission_rate mirrored to it.
  const traderMargin = value.trader_margin ?? value.commission_rate ?? Number(trader.trader_margin);
  const adminMargin = value.admin_margin ?? Number(trader.admin_margin);

  // Rule: trader margin MUST be less than the admin/merchant margin, otherwise
  // the platform makes zero or negative revenue on the trader's orders.
  if (Number(traderMargin) >= Number(adminMargin)) {
    return fail(res, 422, `Trader margin (${traderMargin}%) must be less than the admin/merchant margin (${adminMargin}%)`);
  }

  const patch = {
    trader_margin: traderMargin,
    admin_margin: adminMargin,
    commission_rate: value.commission_rate ?? traderMargin,
  };
  if (value.payout_commission != null) patch.payout_commission = value.payout_commission;
  await trader.update(patch);

  emitToTrader(trader.id, 'commission:updated', {
    trader_margin: traderMargin,
    admin_margin: adminMargin,
    commission_rate: Number(trader.commission_rate),
  });
  return ok(res, {
    trader_id: trader.id,
    trader_margin: Number(trader.trader_margin),
    admin_margin: Number(trader.admin_margin),
    commission_rate: Number(trader.commission_rate),
    payout_commission: Number(trader.payout_commission),
  });
});

/* ------------------- PUT /traders/:id/online-status ----------------------- */
// Demo helper: manually flip a trader online/offline without the APK. Bringing
// a trader ONLINE also refreshes last_heartbeat so routing accepts them
// immediately.
const onlineStatusSchema = Joi.object({ is_online: Joi.boolean().required() });

const updateTraderOnlineStatus = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id);
  if (!trader) return fail(res, 404, 'Trader not found');

  const { error, value } = onlineStatusSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  await trader.update({
    is_online: value.is_online,
    ...(value.is_online ? { last_heartbeat: new Date() } : {}),
  });

  emitToTrader(trader.id, value.is_online ? 'trader:online' : 'trader:offline', { trader_id: trader.id });
  emitToAdmin('trader:status', { trader_id: trader.id, is_online: value.is_online });
  return ok(res, { trader_id: trader.id, is_online: value.is_online });
});

/* --------------------- PUT /traders/:id/suspend --------------------------- */
// Suspend / reactivate a trader. Suspending sets the user status to 'suspended'
// (blocks login) AND forces the trader offline so the routing engine — which
// only considers active + online traders — stops assigning them orders.
const suspendSchema = Joi.object({ suspended: Joi.boolean().required() });

const updateTraderSuspend = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id, { include: [{ model: db.User, as: 'user' }] });
  if (!trader) return fail(res, 404, 'Trader not found');

  const { error, value } = suspendSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  const nextStatus = value.suspended ? 'suspended' : 'active';
  if (trader.user) await trader.user.update({ status: nextStatus });
  // A suspended trader must not stay online (else they'd keep receiving orders).
  if (value.suspended) await trader.update({ is_online: false });

  if (value.suspended) emitToTrader(trader.id, 'trader:suspended', { trader_id: trader.id });
  emitToAdmin('trader:status', { trader_id: trader.id, status: nextStatus, ...(value.suspended ? { is_online: false } : {}) });
  return ok(res, { trader_id: trader.id, status: nextStatus, suspended: value.suspended });
});

/* --------------------- PUT /merchants/:id/fees ---------------------------- */
const feesSchema = Joi.object({
  payin_fee_percent: Joi.number().min(0).max(100).required(),
  payout_fee_percent: Joi.number().min(0).max(100).required(),
});

const updateMerchantFees = asyncHandler(async (req, res) => {
  const merchant = await db.Merchant.findByPk(req.params.id);
  if (!merchant) return fail(res, 404, 'Merchant not found');

  const { error, value } = feesSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  await merchant.update({ payin_fee_percent: value.payin_fee_percent, payout_fee_percent: value.payout_fee_percent });
  emitToMerchant(merchant.id, 'fees:updated', { payin_fee_percent: value.payin_fee_percent, payout_fee_percent: value.payout_fee_percent });
  return ok(res, {
    merchant_id: merchant.id,
    payin_fee_percent: Number(merchant.payin_fee_percent),
    payout_fee_percent: Number(merchant.payout_fee_percent),
  });
});

const deleteTrader = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findByPk(req.params.id);
  if (!trader) return fail(res, 404, 'Trader not found');
  // Soft-disable rather than hard-delete (preserves order history / FKs).
  await db.User.update({ status: 'inactive' }, { where: { id: trader.user_id } });
  await trader.update({ is_online: false });
  return ok(res, { deactivated: true, trader_id: trader.id });
});

/* ------------------------------ MERCHANTS --------------------------------- */
const listMerchants = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const { rows, count } = await db.Merchant.findAndCountAll({
    include: [{ model: db.User, as: 'user', attributes: ['email', 'status'] }],
    order: [['id', 'ASC']],
    limit,
    offset,
  });
  return ok(res, { merchants: rows, pagination: { page, limit, total: count } });
});

const createMerchantSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  business_name: Joi.string().max(191).required(),
  commission_rate: Joi.number().min(0).max(100).default(2.0),
});

const createMerchant = asyncHandler(async (req, res) => {
  const { error, value } = createMerchantSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  const exists = await db.User.findOne({ where: { email: value.email } });
  if (exists) return fail(res, 409, 'Email already in use');

  const api_key = genApiKey();
  const api_secret = genApiSecret();

  const result = await db.sequelize.transaction(async (t) => {
    const user = await db.User.create(
      { email: value.email, password_hash: await authService.hashPassword(value.password), role: 'merchant', status: 'active' },
      { transaction: t }
    );
    const merchant = await db.Merchant.create(
      { user_id: user.id, business_name: value.business_name, commission_rate: value.commission_rate, api_key, api_secret },
      { transaction: t }
    );
    return { user, merchant };
  });

  // Return the secret once at creation.
  return created(res, { merchant: { id: result.merchant.id, business_name: value.business_name, api_key, api_secret } });
});

const updateMerchant = asyncHandler(async (req, res) => {
  const merchant = await db.Merchant.findByPk(req.params.id, { include: [{ model: db.User, as: 'user' }] });
  if (!merchant) return fail(res, 404, 'Merchant not found');

  const patch = {};
  ['commission_rate', 'webhook_url', 'payin_fee_percent', 'payout_fee_percent', 'daily_limit_inr']
    .forEach((k) => { if (req.body[k] != null) patch[k] = req.body[k]; });
  if (typeof req.body.is_active === 'boolean') patch.is_active = req.body.is_active;
  await merchant.update(patch);
  if (req.body.status && merchant.user) await merchant.user.update({ status: req.body.status });

  return ok(res, { merchant });
});

/* ------------------ POST /merchants/create (full form) -------------------- */
const createMerchantFullSchema = Joi.object({
  business_name: Joi.string().max(191).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  payin_fee_percent: Joi.number().min(0).max(100).default(3.0),
  payout_fee_percent: Joi.number().min(0).max(100).default(1.0),
  webhook_url: Joi.string().uri().allow('', null),
  daily_limit_inr: Joi.number().min(0).default(1000000),
});

const createMerchantFull = asyncHandler(async (req, res) => {
  const { error, value } = createMerchantFullSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);

  const exists = await db.User.findOne({ where: { email: value.email } });
  if (exists) return fail(res, 409, 'Email already in use');

  const api_key = genApiKey();
  const api_secret = genApiSecret();

  const result = await db.sequelize.transaction(async (t) => {
    const user = await db.User.create(
      { email: value.email, password_hash: await authService.hashPassword(value.password), role: 'merchant', status: 'active' },
      { transaction: t }
    );
    const merchant = await db.Merchant.create(
      {
        user_id: user.id,
        business_name: value.business_name,
        api_key,
        api_secret,
        payin_fee_percent: value.payin_fee_percent,
        payout_fee_percent: value.payout_fee_percent,
        webhook_url: value.webhook_url || null,
        daily_limit_inr: value.daily_limit_inr,
      },
      { transaction: t }
    );
    return { user, merchant };
  });

  emitToAdmin('merchant:created', { merchant_id: result.merchant.id, business_name: value.business_name });
  return created(res, {
    merchant: {
      id: result.merchant.id,
      business_name: value.business_name,
      email: value.email,
      payin_fee_percent: value.payin_fee_percent,
      payout_fee_percent: value.payout_fee_percent,
    },
    credentials: { email: value.email, password: value.password },
    api_key,
    api_secret,
  });
});

/* ------------------------------ SETTINGS ---------------------------------- */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getAll();
  return ok(res, { settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const allowed = [
    'exchange_rate', 'base_exchange_rate', 'exchange_rate_mode', 'platform_name',
    'order_expiry_minutes', 'min_order_amount', 'max_order_amount',
    'admin_default_margin', 'trader_default_margin',
    // NOTE: platform_revenue_usdt is intentionally NOT editable — it is
    // accumulated automatically on each settled order.
  ];
  const updated = {};
  for (const key of allowed) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      // eslint-disable-next-line no-await-in-loop
      await settingsService.set(key, body[key]);
      updated[key] = String(body[key]);
    }
  }
  emitToAdmin('settings:updated', updated);
  const settings = await settingsService.getAll();
  return ok(res, { settings, updated });
});

/* ------------------------------- ORDERS ----------------------------------- */
const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;

  const { rows, count } = await db.Order.findAndCountAll({
    where,
    include: [
      { model: db.Merchant, as: 'merchant', attributes: ['id', 'business_name'] },
      { model: db.Trader, as: 'trader', attributes: ['id'] },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return ok(res, { orders: rows, pagination: { page, limit, total: count } });
});

/** Resolve an order by numeric id or uuid. */
async function findOrder(idOrUuid) {
  const where = /^\d+$/.test(String(idOrUuid)) ? { id: idOrUuid } : { uuid: idOrUuid };
  return db.Order.findOne({ where });
}

/* ---- v2 order review/settlement endpoints ---- */

// PUT /orders/:id/review — claimed_paid → under_review.
const reviewOrder = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (order.status !== 'claimed_paid') return fail(res, 400, 'Order must be claimed_paid to review');
  await order.update({ status: 'under_review', reviewed_at: new Date(), reviewed_by: req.user.id });
  emitToAdmin('order:updated', { order_id: order.uuid, status: 'under_review' });
  emitToOrder(order.uuid, 'order:updated', { order_id: order.uuid, status: 'under_review' });
  return ok(res, { success: true, status: 'under_review', order });
});

// PUT /orders/:id/confirm — claimed_paid|under_review → success (settle + credit).
// Reuses the tested settlement path (balanceService.settleOrder via smartMerge).
const confirmOrderV2 = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (!db.Order.REVIEWABLE_STATUSES.includes(order.status)) {
    return fail(res, 400, `Order must be claimed_paid or under_review (is ${order.status})`);
  }
  // Back the confirmation with a manual transaction (Engine 4 audit trail).
  await db.Transaction.create({
    order_id: order.id,
    engine_used: 'manual',
    amount_detected: order.amount_inr,
    utr_number: req.body?.utr || order.utr_number || order.upi_ref_id || null,
    sender_name: req.body?.sender_name || null,
    confidence_score: 100,
  });
  try {
    await smartMerge.confirmOrder(order, {
      utrNumber: req.body?.utr || order.utr_number || order.upi_ref_id,
      engine: 'admin_manual',
      senderName: req.body?.sender_name,
      reviewedBy: req.user.id,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
  await order.reload();
  return ok(res, { success: true, status: order.status, order });
});

// PUT /orders/:id/reject — claimed_paid|under_review → rejected (release trader).
const rejectOrderV2 = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (!db.Order.REVIEWABLE_STATUSES.includes(order.status)) {
    return fail(res, 400, `Order must be claimed_paid or under_review (is ${order.status})`);
  }
  const traderId = order.trader_id;
  await order.update({ status: 'rejected', rejected_at: new Date(), rejection_reason: req.body?.reason || 'Payment not received' });
  if (traderId) await routingEngine.releaseTrader(traderId, order.id);
  emitToMerchant(order.merchant_id, 'order:rejected', { order_id: order.uuid, gateway_order_id: order.gateway_order_id });
  if (traderId) emitToTrader(traderId, 'order:rejected', { order_id: order.uuid });
  emitToAdmin('order:rejected', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:rejected', { order_id: order.uuid, status: 'rejected' });
  return ok(res, { success: true, status: 'rejected', order });
});

// PUT /orders/:id/dispute — claimed_paid|under_review → disputed.
const disputeOrderV2 = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (!db.Order.REVIEWABLE_STATUSES.includes(order.status)) {
    return fail(res, 400, `Order must be claimed_paid or under_review (is ${order.status})`);
  }
  await order.update({ status: 'disputed', rejection_reason: req.body?.reason || 'Under investigation' });
  await db.Dispute.create({ order_id: order.id, raised_by: req.user.id, reason: req.body?.reason || 'Under investigation', status: 'open' });
  emitToAdmin('order:disputed', { order_id: order.uuid });
  emitToMerchant(order.merchant_id, 'order:disputed', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:disputed', { order_id: order.uuid, status: 'disputed' });
  return ok(res, { success: true, status: 'disputed', order });
});

/* --------------------------- PUT /orders/:id ------------------------------ */
// Generic override kept for backward compatibility. Maps common targets to the
// v2 endpoints' behaviour.
const updateOrder = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  const status = req.body?.status;
  if (!status) return fail(res, 422, 'A target status is required');

  if (status === 'success' || status === 'confirmed') {
    if (!db.Order.REVIEWABLE_STATUSES.includes(order.status) && order.status !== 'success') {
      return fail(res, 400, `Cannot confirm from ${order.status}`);
    }
    if (order.status !== 'success') {
      await db.Transaction.create({ order_id: order.id, engine_used: 'manual', amount_detected: order.amount_inr, utr_number: order.utr_number || order.upi_ref_id || null, confidence_score: 100 });
      await smartMerge.confirmOrder(order, { utrNumber: order.utr_number || order.upi_ref_id, engine: 'admin_manual', reviewedBy: req.user.id });
      await order.reload();
    }
    return ok(res, { order });
  }
  if (status === 'rejected' || status === 'cancelled' || status === 'failed') {
    const traderId = order.trader_id;
    const target = status === 'cancelled' ? 'failed' : status;
    if (!['success', 'failed', 'rejected'].includes(order.status)) {
      await order.update({ status: target, ...(target === 'rejected' ? { rejected_at: new Date(), rejection_reason: req.body?.reason || 'Rejected by admin' } : {}) });
      if (traderId) await routingEngine.releaseTrader(traderId, order.id);
    }
    emitToMerchant(order.merchant_id, 'order:rejected', { order_id: order.uuid });
    emitToAdmin('order:rejected', { order_id: order.uuid });
    emitToOrder(order.uuid, 'order:rejected', { order_id: order.uuid, status: target });
    return ok(res, { order });
  }
  await order.update({ status });
  emitToAdmin('order:updated', { order_id: order.uuid, status });
  emitToOrder(order.uuid, 'order:updated', { order_id: order.uuid, status });
  return ok(res, { order });
});

/* ------------------------------ DISPUTES ---------------------------------- */
const listDisputes = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  const rows = await db.Dispute.findAll({
    where,
    include: [{ model: db.Order, as: 'order', attributes: ['uuid', 'amount_inr', 'merchant_id'] }],
    order: [['created_at', 'DESC']],
  });
  return ok(res, { disputes: rows });
});

const resolveDispute = asyncHandler(async (req, res) => {
  const dispute = await db.Dispute.findByPk(req.params.id, { include: [{ model: db.Order, as: 'order' }] });
  if (!dispute) return fail(res, 404, 'Dispute not found');

  const resolution = req.body?.resolution || 'Resolved by admin';
  await dispute.update({ status: 'resolved', resolution });

  // Optionally set the underlying order's terminal status.
  if (dispute.order && req.body?.order_status) {
    await dispute.order.update({ status: req.body.order_status });
  }
  return ok(res, { dispute });
});

/* ----------------------------- SETTLEMENTS -------------------------------- */
const listSettlements = asyncHandler(async (req, res) => {
  const rows = await db.Settlement.findAll({
    include: [
      { model: db.Trader, as: 'trader', attributes: ['id'] },
      { model: db.Merchant, as: 'merchant', attributes: ['id', 'business_name'] },
    ],
    order: [['created_at', 'DESC']],
    limit: 200,
  });
  return ok(res, { settlements: rows });
});

const triggerSettlement = asyncHandler(async (req, res) => {
  const { runSettlement } = require('../jobs/settlementJob');
  const summary = await runSettlement();
  emitToAdmin('settlement:completed', summary);
  return ok(res, { triggered: true, ...summary });
});

/* ----------------------------- SMARTPHONES -------------------------------- */
const listSmartphones = asyncHandler(async (req, res) => {
  const rows = await db.Smartphone.findAll({
    include: [{ model: db.Trader, as: 'trader', attributes: ['id'], include: [{ model: db.User, as: 'user', attributes: ['email'] }] }],
    order: [['id', 'ASC']],
  });
  return ok(res, { smartphones: rows });
});

const disconnectSmartphone = asyncHandler(async (req, res) => {
  const phone = await db.Smartphone.findByPk(req.params.id);
  if (!phone) return fail(res, 404, 'Smartphone not found');
  await phone.update({ is_online: false });
  if (phone.trader_id) emitToTrader(phone.trader_id, 'device:disconnected', { device_id: phone.id });
  emitToAdmin('device:disconnected', { device_id: phone.id, trader_id: phone.trader_id });
  return ok(res, { disconnected: true, device_id: phone.id });
});

module.exports = {
  dashboard,
  listTraders,
  createTrader,
  createTraderFull,
  updateTrader,
  updateTraderBalance,
  updateTraderCommission,
  updateTraderOnlineStatus,
  updateTraderSuspend,
  deleteTrader,
  listMerchants,
  createMerchant,
  createMerchantFull,
  updateMerchant,
  updateMerchantFees,
  listOrders,
  updateOrder,
  reviewOrder,
  confirmOrderV2,
  rejectOrderV2,
  disputeOrderV2,
  getSettings,
  updateSettings,
  listDisputes,
  resolveDispute,
  listSettlements,
  triggerSettlement,
  listSmartphones,
  disconnectSmartphone,
};
