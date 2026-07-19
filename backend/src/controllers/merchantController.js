'use strict';

/**
 * merchantController — endpoints for the authenticated merchant dashboard.
 * Resolves the merchant profile from req.user (role 'merchant').
 */

const Joi = require('joi');
const { Op } = require('sequelize');

const db = require('../models');
const config = require('../config');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const { apiKey: genApiKey, apiSecret: genApiSecret, mask } = require('../utils/ids');
const routingEngine = require('../services/routingEngine');
const rateService = require('../services/rateService');
const upiService = require('../services/upiService');
const orderService = require('../services/orderService');

async function currentMerchant(req, res, { withSecret = false } = {}) {
  const scope = withSecret ? 'withSecret' : null;
  const model = scope ? db.Merchant.scope(scope) : db.Merchant;
  const merchant = await model.findOne({ where: { user_id: req.user.id } });
  if (!merchant) {
    fail(res, 404, 'Merchant profile not found');
    return null;
  }
  return merchant;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ---------------------------- GET /dashboard ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  const today = startOfToday();
  const [ordersToday, confirmedToday, pending, todayVolume] = await Promise.all([
    db.Order.count({ where: { merchant_id: merchant.id, created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { merchant_id: merchant.id, status: 'success', created_at: { [Op.gte]: today } } }),
    db.Order.count({ where: { merchant_id: merchant.id, status: { [Op.in]: db.Order.ACTIVE_STATUSES } } }),
    db.Order.sum('amount_inr', { where: { merchant_id: merchant.id, status: 'success', created_at: { [Op.gte]: today } } }),
  ]);

  return ok(res, {
    today_collections_inr: todayVolume || 0,
    total_orders_today: ordersToday,
    confirmed_today: confirmedToday,
    pending_orders: pending,
    success_rate: ordersToday ? +((confirmedToday / ordersToday) * 100).toFixed(1) : 100,
    balance: merchant.balance,
    balance_usdt: merchant.balance_usdt,
    commission_rate: merchant.commission_rate,
    payin_fee_percent: merchant.payin_fee_percent,
    payout_fee_percent: merchant.payout_fee_percent,
  });
});

/* ------------------------------ GET /orders ------------------------------- */
const orders = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  const { page, limit, offset } = pagination(req.query);
  const where = { merchant_id: merchant.id };
  if (req.query.status) where.status = req.query.status;

  const { rows, count } = await db.Order.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return ok(res, { orders: rows, pagination: { page, limit, total: count } });
});

/* ------------------------------ POST /orders ------------------------------ */
// Create an order from the merchant dashboard (JWT-authenticated convenience
// endpoint; server-to-server integrations use POST /api/orders/create with an
// API key instead).
const createOrderSchema = Joi.object({
  // Accept either `amount` or `amount_inr`.
  amount: Joi.number().positive(),
  amount_inr: Joi.number().positive(),
  customer_ref: Joi.string().max(191).allow('', null),
  customer_name: Joi.string().max(191).allow('', null),
}).or('amount', 'amount_inr');

// v2 create from the merchant dashboard — same shared logic as the API-key path.
const createOrder = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  try {
    const r = await orderService.createOrder(merchant, req.body);
    return created(res, {
      success: true,
      gateway_order_id: r.gatewayOrderId,
      merchant_order_id: r.order.merchant_order_id,
      order_id: r.order.uuid,
      customer_ref: r.order.customer_ref,
      amount_inr: Number(r.order.amount_inr),
      amount_usdt: Number(Number(r.amountUsdt).toFixed(8)),
      deposit_type: r.actualDepositType,
      status: 'pending',
      checkout_url: r.checkoutUrl,
      expires_at: r.order.expires_at,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.error || 'server_error', message: err.message, ...(err.extra || {}) });
  }
});

/* --------------------------- GET /transactions ---------------------------- */
const transactions = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  const { page, limit, offset } = pagination(req.query);
  const { rows, count } = await db.Transaction.findAndCountAll({
    include: [{ model: db.Order, as: 'order', where: { merchant_id: merchant.id }, attributes: ['uuid', 'amount_inr', 'status'], required: true }],
    where: { is_merged: true },
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return ok(res, { transactions: rows, pagination: { page, limit, total: count } });
});

/* ------------------------------ GET /balance ------------------------------ */
const balance = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  const pending = await db.Order.sum('amount_inr', {
    where: { merchant_id: merchant.id, status: { [Op.in]: db.Order.ACTIVE_STATUSES } },
  });
  return ok(res, {
    balance: merchant.balance,
    balance_usdt: merchant.balance_usdt,
    pending_inr: pending || 0,
    payin_fee_percent: merchant.payin_fee_percent,
  });
});

/* ------------------------------ POST /webhook ----------------------------- */
const setWebhook = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;

  const url = req.body?.webhook_url;
  if (!url || !/^https?:\/\//.test(url)) return fail(res, 422, 'A valid webhook_url (http/https) is required');

  await merchant.update({ webhook_url: url });
  return ok(res, { webhook_url: merchant.webhook_url });
});

/* -------------------------- GET /api-credentials -------------------------- */
const getApiCredentials = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;
  return ok(res, { api_key: merchant.api_key, api_key_masked: mask(merchant.api_key) });
});

/* ------------------ POST /api-credentials/regenerate ---------------------- */
const regenerateApiCredentials = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res, { withSecret: true });
  if (!merchant) return undefined;

  const api_key = genApiKey();
  const api_secret = genApiSecret();
  await merchant.update({ api_key, api_secret });

  // Return the secret ONCE on regeneration so the merchant can store it.
  return ok(res, { api_key, api_secret });
});

module.exports = {
  dashboard,
  orders,
  createOrder,
  transactions,
  balance,
  setWebhook,
  getApiCredentials,
  regenerateApiCredentials,
};
