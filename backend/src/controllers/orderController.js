'use strict';

/**
 * orderController — order lifecycle (create / get / confirm / expire / dispute / list).
 *
 *   POST /api/orders/create      (merchant API key)   create + route an order
 *   GET  /api/orders/:id         (public/auth)         order details
 *   POST /api/orders/:id/confirm (public)              customer confirms → paid
 *   POST /api/orders/:id/paid    (public)              customer confirms → paid
 *   POST /api/orders/:id/expire  (auth/internal)       expire + release trader
 *   POST /api/orders/:id/dispute (auth)                raise dispute
 *   GET  /api/orders             (auth)                filtered list (role-scoped)
 */

const Joi = require('joi');
const axios = require('axios');

const db = require('../models');
const config = require('../config');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const routingEngine = require('../services/routingEngine');
const webhookService = require('../services/webhookService');
const telegramService = require('../services/telegramService');
const upiService = require('../services/upiService');
const orderService = require('../services/orderService');
const rateService = require('../services/rateService');
const { emitToTrader, emitToMerchant, emitToAdmin, emitToOrder } = require('../websocket');

/** Resolve an order by numeric id or uuid. */
async function findOrder(idOrUuid, opts = {}) {
  const where = /^\d+$/.test(String(idOrUuid)) ? { id: idOrUuid } : { uuid: idOrUuid };
  return db.Order.findOne({ where, ...opts });
}

function orderView(order) {
  return {
    id: order.id,
    order_id: order.uuid,
    gateway_order_id: order.gateway_order_id,
    merchant_order_id: order.merchant_order_id,
    merchant_id: order.merchant_id,
    trader_id: order.trader_id,
    amount_inr: order.amount_inr,
    amount_usdt: order.amount_usdt,
    exchange_rate: order.exchange_rate,
    status: order.status,
    deposit_type: order.deposit_type,
    customer_ref: order.customer_ref,
    upi_ref_id: order.upi_ref_id,
    utr_number: order.utr_number,
    confirmation_type: order.confirmation_type,
    redirect_url: order.redirect_url,
    expires_at: order.expires_at,
    created_at: order.created_at,
    paymentDetail: order.paymentDetail
      ? { id: order.paymentDetail.id, upi_id: order.paymentDetail.upi_id, account_name: order.paymentDetail.account_name, account_type: order.paymentDetail.account_type }
      : undefined,
  };
}

/* ----------------------------- POST /create ------------------------------- */
// v2 create (API-key merchant). Delegates to orderService for the shared
// validate → detect FTD/STD → route → gateway_order_id → create flow.
const create = asyncHandler(async (req, res) => {
  try {
    const r = await orderService.createOrder(req.merchant, req.body);
    return created(res, {
      success: true,
      gateway_order_id: r.gatewayOrderId,
      merchant_order_id: r.order.merchant_order_id,
      order_id: r.order.uuid,
      customer_ref: r.order.customer_ref,
      amount: Number(r.order.amount_inr),
      amount_inr: Number(r.order.amount_inr),
      amount_usdt: Number(Number(r.amountUsdt).toFixed(8)),
      deposit_type: r.actualDepositType,
      status: 'pending',
      checkout_url: r.checkoutUrl,
      expires_at: r.order.expires_at,
      created_at: r.order.created_at,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.error || 'server_error', message: err.message, ...(err.extra || {}) });
  }
});

/* ------------------------------ GET /:id ---------------------------------- */
const getOne = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id, {
    include: [
      { model: db.PaymentDetail, as: 'paymentDetail' },
      { model: db.Merchant, as: 'merchant', attributes: ['id', 'business_name'] },
    ],
  });
  if (!order) return fail(res, 404, 'Order not found');

  const view = orderView(order);
  if (order.paymentDetail) Object.assign(view, upiService.paymentPayload(order, order.paymentDetail));
  view.merchant_name = order.merchant?.business_name;
  return ok(res, { order: view });
});

/* --------------------------- GET /:id/checkout ---------------------------- */
// Flat, checkout-page-friendly shape (real UPI id, name, bank, QR, expiry).
const checkout = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id, {
    include: [
      // NOTE: associations use lowercase aliases (paymentDetail/merchant/trader).
      // Including the bare model (e.g. `db.PaymentDetail`) without `as` throws.
      { model: db.PaymentDetail, as: 'paymentDetail' },
      { model: db.Merchant, as: 'merchant', attributes: ['id', 'business_name'] },
      { model: db.Trader, as: 'trader', attributes: ['id', 'is_online', 'trader_margin'] },
    ],
  });

  if (!order) return fail(res, 404, 'Order not found');

  const pd = order.paymentDetail;
  const payload = pd ? upiService.paymentPayload(order, pd) : {};
  // Trader rate = base × (1 + trader_margin/100). Prefer the persisted rate on a
  // confirmed order, else compute from the trader's current margin.
  const baseRate = await rateService.getBaseRate();
  const traderRate = order.trader_rate != null
    ? Number(order.trader_rate)
    : (order.trader ? +(baseRate * (1 + Number(order.trader.trader_margin) / 100)).toFixed(4) : null);
  return ok(res, {
    order_id: order.uuid,
    order_id_short: String(order.uuid).split('-')[0].toUpperCase(),
    short_id: String(order.uuid).split('-')[0].toUpperCase(),
    merchant_name: order.merchant?.business_name || 'Merchant',
    amount_inr: order.amount_inr,
    amount_usdt: order.amount_usdt,
    base_rate: baseRate,
    trader_rate: traderRate,
    payment_detail_id: order.payment_detail_id || null,
    // Full UPI id — never masked on checkout (the customer needs to pay it).
    upi_id: pd?.upi_id || payload.assigned_upi_id || null,
    upi_name: pd?.account_name || payload.payee_name || null,
    bank_name: pd?.bank_name || pd?.organization_name || null,
    account_type: pd?.account_type || null,
    qr_data: payload.qr_data || null,
    upi_link: payload.upi_link || null,
    trader_online: order.trader ? !!order.trader.is_online : false,
    utr_number: order.utr_number || null,
    status: order.status,
    expires_at: order.expires_at,
    // v2 fields the checkout page displays / uses.
    gateway_order_id: order.gateway_order_id || null,
    deposit_type: order.deposit_type || null,
    confirmation_type: order.confirmation_type || null,
    rejection_reason: order.rejection_reason || null,
    redirect_url: order.redirect_url || null,
  });
});

/* --------------------- PUT /:id/checkout-opened --------------------------- */
// Customer opened the checkout page (public). pending → checkout_open.
const checkoutOpened = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (order.status === 'pending') {
    await order.update({ status: 'checkout_open' });
    emitToOrder(order.uuid, 'order:checkout_open', { order_id: order.uuid, status: 'checkout_open' });
  }
  return ok(res, { success: true, status: order.status });
});

/* ------------------------ POST /:id/claim-paid ---------------------------- */
// Customer asserts they paid (public). Moves pending/checkout_open →
// claimed_paid with their proof, and notifies admin + trader. NO settlement
// here — an admin must review/confirm.
const claimPaid = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id, {
    include: [{ model: db.PaymentDetail, as: 'paymentDetail' }],
  });
  if (!order) return fail(res, 404, 'Order not found');
  if (!['pending', 'checkout_open'].includes(order.status)) {
    return ok(res, { success: true, status: order.status, order: orderView(order) });
  }

  const utrNumber = typeof req.body?.utr_number === 'string' ? req.body.utr_number.trim() : null;
  const allowedProof = ['utr', 'screenshot', 'no_proof'];
  let confirmationType = req.body?.confirmation_type;
  if (!allowedProof.includes(confirmationType)) confirmationType = utrNumber ? 'utr' : 'no_proof';

  await order.update({
    status: 'claimed_paid',
    claimed_paid_at: new Date(),
    utr_number: utrNumber || order.utr_number,
    confirmation_type: confirmationType,
    customer_confirmed_at: new Date(),
    screenshot_path: req.body?.screenshot_path || order.screenshot_path,
  });

  // Notify NGO backend to start verification. Best-effort — the customer's
  // claim is already saved above; a down NGO backend must not block checkout.
  try {
    await axios.post(
      (process.env.NGO_BACKEND_URL || 'http://localhost:3000') + '/api/checkout/verify',
      {
        orderId: order.uuid,
        amount: order.amount_inr.toString(),
        ngoId: order.merchant_id.toString(),
        traderUPI: order.paymentDetail?.upi_id || '',
        donorClickedAt: new Date().toISOString(),
        utr: utrNumber || '',
        confirmationType,
      },
      { timeout: 5000 }
    );
    console.log('NGO verify triggered for order:', order.uuid);
  } catch (e) {
    console.log('NGO notify failed:', e.message);
    // Don't block - continue even if NGO fails.
  }

  emitToAdmin('order:claimed_paid', { order_id: order.uuid, gateway_order_id: order.gateway_order_id, amount_inr: order.amount_inr, deposit_type: order.deposit_type });
  if (order.trader_id) emitToTrader(order.trader_id, 'order:claimed_paid', { order_id: order.uuid, gateway_order_id: order.gateway_order_id, amount_inr: order.amount_inr });
  emitToMerchant(order.merchant_id, 'order:claimed_paid', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:claimed_paid', { order_id: order.uuid, status: 'claimed_paid' });

  return ok(res, { success: true, status: 'claimed_paid', order: orderView(order) });
});

// Backward-compatible aliases: old /paid, /confirm, /customer-confirm routes.
const markPaid = claimPaid;
const confirm = claimPaid;

/* --------------------------- POST /:id/cancel ----------------------------- */
const cancel = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (['success', 'failed', 'rejected'].includes(order.status)) return ok(res, { order: orderView(order) });

  const traderId = order.trader_id;
  await order.update({ status: 'failed' });
  if (traderId) await routingEngine.releaseTrader(traderId, order.id);

  emitToMerchant(order.merchant_id, 'order:cancelled', { order_id: order.uuid });
  if (traderId) emitToTrader(traderId, 'order:cancelled', { order_id: order.uuid });
  emitToAdmin('order:cancelled', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:cancelled', { order_id: order.uuid, status: 'failed' });
  webhookService.sendWebhook(order.merchant_id, 'order.cancelled', { order_id: order.uuid }).catch(() => {});

  return ok(res, { order: orderView(order) });
});

/* --------------------------- POST /:id/expire ----------------------------- */
const expire = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (['success', 'failed', 'rejected'].includes(order.status)) {
    return ok(res, { order: orderView(order) });
  }

  const traderId = order.trader_id;
  await order.update({ status: 'failed' });
  if (traderId) await routingEngine.releaseTrader(traderId, order.id);

  if (traderId) emitToTrader(traderId, 'order:expired', { order_id: order.uuid });
  emitToMerchant(order.merchant_id, 'order:expired', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:expired', { order_id: order.uuid, status: 'failed' });
  webhookService.sendWebhook(order.merchant_id, 'order.expired', { order_id: order.uuid }).catch(() => {});

  return ok(res, { order: orderView(order) });
});

/* --------------------------- POST /:id/dispute ---------------------------- */
const dispute = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');

  const reason = req.body?.reason || 'Unspecified dispute';
  const record = await db.Dispute.create({
    order_id: order.id,
    raised_by: req.user?.id || null,
    reason,
    evidence_url: req.body?.evidence_url || null,
    status: 'open',
  });
  await order.update({ status: 'disputed' });

  emitToAdmin('order:disputed', { order_id: order.uuid, dispute_id: record.id, reason });
  emitToMerchant(order.merchant_id, 'order:disputed', { order_id: order.uuid, reason });
  emitToOrder(order.uuid, 'order:disputed', { order_id: order.uuid, status: 'disputed' });
  telegramService.sendAlertToAdmin(`Dispute raised on order ${order.uuid}: ${reason}`).catch(() => {});

  return created(res, { dispute: { id: record.id, order_id: order.uuid, status: record.status, reason } });
});

/* -------------------------- POST /:id/new-upi ----------------------------- */
// Customer clicked "Get new UPI ID" — reassign to a different trader.
const newUpi = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');

  const result = await routingEngine.getNewUpiId(order.id);
  if (!result) return fail(res, 503, 'No trader available right now, please try again shortly');

  const view = orderView(result.order);
  Object.assign(view, upiService.paymentPayload(result.order, result.paymentDetail));
  return ok(res, { order: view });
});

/* --------------------- POST /verify-payment (internal) -------------------- */
// Server-to-server callback FROM the NGO backend once it has independently
// matched a scraped bank/UPI transaction to the donor intent created in
// claimPaid above (see matchingEngine.js notifyP2PBackend). Auto-settles the
// order without an admin review step.
const verifyPayment = asyncHandler(async (req, res) => {
  try {
    const { orderId, utr, payerName, payerUPI, verified, verifiedAt } = req.body;

    if (!verified) {
      return res.json({ success: false, message: 'Payment not verified' });
    }

    const order = await findOrder(orderId);
    if (!order) {
      return res.json({ success: false, message: 'Order not found' });
    }

    // Only update if order is pending or claimed.
    if (!['pending', 'checkout_open', 'claimed_paid'].includes(order.status)) {
      return res.json({ success: true, message: 'Order already processed', status: order.status });
    }

    // Update order to completed. NOTE: 'completed' is not a valid Order.status
    // value (see models/order.model.js STATUSES) — using 'success', the
    // existing terminal "paid & settled" status.
    await order.update({
      status: 'success',
      utr_number: utr || order.utr_number,
      payer_name: payerName || '',
      payer_upi: payerUPI || '',
      confirmed_at: verifiedAt || new Date(),
      auto_verified: true,
    });

    // Emit socket notifications.
    emitToAdmin('order:completed', {
      order_id: order.uuid,
      gateway_order_id: order.gateway_order_id,
      amount_inr: order.amount_inr,
      utr,
      payer_name: payerName,
      auto_verified: true,
    });

    if (order.trader_id) {
      emitToTrader(order.trader_id, 'order:completed', {
        order_id: order.uuid,
        amount_inr: order.amount_inr,
        utr,
        payer_name: payerName,
      });
    }

    emitToMerchant(order.merchant_id, 'order:completed', {
      order_id: order.uuid,
      amount_inr: order.amount_inr,
    });

    emitToOrder(order.uuid, 'order:completed', {
      order_id: order.uuid,
      status: 'success',
      utr,
      payer_name: payerName,
    });

    console.log('Order auto-verified:', orderId, 'UTR:', utr);

    return res.json({
      success: true,
      message: 'Order verified and closed!',
      orderId: order.uuid,
      status: 'success',
    });
  } catch (err) {
    console.error('verifyPayment error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ------------------------------- GET / ------------------------------------ */
// Role-scoped listing: admin=all, merchant=own, trader=assigned.
const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;

  if (req.user.role === 'merchant') {
    const merchant = await db.Merchant.findOne({ where: { user_id: req.user.id } });
    where.merchant_id = merchant ? merchant.id : -1;
  } else if (req.user.role === 'trader') {
    const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
    where.trader_id = trader ? trader.id : -1;
  }

  const { rows, count } = await db.Order.findAndCountAll({
    where,
    include: [{ model: db.PaymentDetail, as: 'paymentDetail', attributes: ['id', 'upi_id', 'account_type'] }],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return ok(res, { orders: rows.map(orderView), pagination: { page, limit, total: count } });
});

module.exports = { create, getOne, checkout, checkoutOpened, claimPaid, confirm, expire, dispute, list, newUpi, markPaid, cancel, verifyPayment };
