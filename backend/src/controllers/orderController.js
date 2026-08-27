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
const { Op } = require('sequelize');

const db = require('../models');
const config = require('../config');
const { ok, created, fail, asyncHandler, pagination } = require('../utils/http');
const routingEngine = require('../services/routingEngine');
const webhookService = require('../services/webhookService');
const telegramService = require('../services/telegramService');
const upiService = require('../services/upiService');
const orderService = require('../services/orderService');
const rateService = require('../services/rateService');
const smartMerge = require('../services/smartMerge');
const { isJunkUtr } = require('../utils/utrValidation');
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
    // Persisted-at-confirm trader rate/deduction and settlement timestamp —
    // real columns on the model that were never actually serialized here, so
    // every trader-facing consumer reading them (Trades.jsx's My Rate/Closed
    // columns) always fell back to today's live rate / "—" even for orders
    // that genuinely have a persisted value. Purely additive.
    trader_rate: order.trader_rate,
    trader_deduction_usdt: order.trader_deduction_usdt,
    confirmed_at: order.confirmed_at,
    updated_at: order.updated_at,
    status: order.status,
    deposit_type: order.deposit_type,
    customer_ref: order.customer_ref,
    upi_ref_id: order.upi_ref_id,
    utr_number: order.utr_number,
    donor_submitted_utr: order.donor_submitted_utr,
    match_tier: order.match_tier,
    confirm_engine: order.confirm_engine,
    confirmation_type: order.confirmation_type,
    // When the customer pressed "I paid". Real column, never serialized
    // before, so the trader panel could not distinguish "claimed with a UTR"
    // from "claimed with no proof at all" — both rendered as an empty cell.
    claimed_paid_at: order.claimed_paid_at,
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
      // Named `estimated_` deliberately. This is amount_inr / trader_rate — an
      // indicative figure at the assigned trader's rate, at creation time. It
      // is NOT what the merchant is credited on settlement: that is the
      // `amount_usdt` in the payment.success webhook, computed at the admin
      // rate. Both used to be called `amount_usdt` while meaning different
      // numbers, which is a trap for anyone integrating against both.
      estimated_amount_usdt: Number(Number(r.amountUsdt).toFixed(8)),
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

/* --------------------- GET /status  (API key, H2H) ------------------------ */
/**
 * The authenticated order-status lookup for server-to-server merchants.
 *
 * Until this existed, the ONLY way a merchant could check an order was the
 * public `GET /:id` below — no authentication, and `findOrder` resolves a bare
 * integer as a primary key, so any order in the system was readable by counting
 * upwards. That is not something a partner's security review can be asked to
 * accept, and it exposed the assigned trader's real UPI id, account name and
 * bank to anyone who could reach the host.
 *
 * This route:
 *   - requires the same X-API-Key / X-API-Secret pair as order creation;
 *   - looks up by the merchant's OWN reference (`merchant_order_id`), or by our
 *     `order_id` uuid / `gateway_order_id`. Numeric primary keys are not
 *     accepted at all, so there is nothing to enumerate;
 *   - is scoped to `merchant_id = req.merchant.id`, so one merchant can never
 *     read another's order — a foreign order is reported as not found rather
 *     than 403, which would confirm it exists.
 *
 * Query: ?merchant_order_id=... | ?order_id=<uuid> | ?gateway_order_id=...
 */
const apiStatus = asyncHandler(async (req, res) => {
  const merchantOrderId = String(req.query.merchant_order_id || '').trim();
  const orderUuid = String(req.query.order_id || req.query.uuid || '').trim();
  const gatewayOrderId = String(req.query.gateway_order_id || '').trim();

  if (!merchantOrderId && !orderUuid && !gatewayOrderId) {
    return res.status(400).json({
      success: false,
      error: 'missing_identifier',
      message: 'Provide one of: merchant_order_id, order_id (uuid) or gateway_order_id',
    });
  }

  const where = { merchant_id: req.merchant.id };
  if (merchantOrderId) where.merchant_order_id = merchantOrderId;
  else if (orderUuid) where.uuid = orderUuid;
  else where.gateway_order_id = gatewayOrderId;

  const order = await db.Order.findOne({
    where,
    include: [{ model: db.PaymentDetail, as: 'paymentDetail' }],
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'order_not_found', message: 'Order not found' });
  }

  const pd = order.paymentDetail;
  const pay = pd ? upiService.paymentPayload(order, pd) : {};

  return ok(res, {
    gateway_order_id: order.gateway_order_id,
    merchant_order_id: order.merchant_order_id,
    order_id: order.uuid,
    customer_ref: order.customer_ref,
    amount_inr: Number(order.amount_inr),
    deposit_type: order.deposit_type,
    status: order.status,
    // Present only once the order has actually settled, so a partner never has
    // to guess whether a figure is indicative or final.
    settled_amount_usdt: order.status === 'success' && order.amount_usdt != null
      ? Number(order.amount_usdt)
      : null,
    utr: order.utr_number || null,
    // What the customer submitted, when they submitted it, and how.
    customer_submitted_utr: order.donor_submitted_utr || null,
    confirmation_type: order.confirmation_type || null,
    claimed_paid_at: order.claimed_paid_at,
    confirmed_at: order.confirmed_at,
    expires_at: order.expires_at,
    created_at: order.created_at,
    checkout_url: `${config.frontend.checkout}/?order=${order.uuid}`,
    // The payment instructions for this order, so an H2H partner rendering its
    // own payment screen does not have to fall back to the public route.
    payment: pd
      ? {
        upi_id: pay.assigned_upi_id,
        payee_name: pay.payee_name,
        qr_data: pay.qr_data,
        upi_link: pay.upi_link,
      }
      : null,
  });
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

  // Server-side re-validation — never trust the client-side check alone.
  if (utrNumber && isJunkUtr(utrNumber)) {
    return fail(res, 422, "That doesn't look like a valid reference number, please check");
  }

  await order.update({
    status: 'claimed_paid',
    claimed_paid_at: new Date(),
    utr_number: utrNumber || order.utr_number,
    // Donor-entered UTR, compared against the receiver-side UTR by
    // matchingEngineV2's Tier 0/1 logic (services/matchingEngineV2.js).
    donor_submitted_utr: utrNumber || order.donor_submitted_utr,
    confirmation_type: confirmationType,
    customer_confirmed_at: new Date(),
    screenshot_path: req.body?.screenshot_path || order.screenshot_path,
  });

  // Donation-ledger subsystem retired (2026-08-06): this used to bridge into
  // ngo-backend's POST /api/checkout/verify to seed a donor-intent Webhook/
  // Verification and nudge the scraper for the OLD webhook+ledger matching
  // flow (ngo-backend's matchingEngine.checkMatch -> notifyP2PBackend ->
  // POST /api/orders/verify-payment). Real settlement no longer depends on
  // any of that — it's driven independently by matching engine v2 straight
  // off the receiver-side RawEvent/Transaction (see matchingEngineV2.js),
  // with no donor-claim prerequisite. Removed rather than left as a dead
  // call: it was also sending order.merchant_id as a synthetic "ngoId",
  // which stopped meaning anything once the receiving end had no real NGO
  // concept for a P2P order.

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

  // Ownership. This route is role-gated to trader|admin but never checked
  // WHICH trader, so any authenticated trader could cancel any order in the
  // system — including another trader's in-flight one. Admins keep the
  // cross-trader reach the route was built for; a trader is now confined to
  // their own orders, matching traderConfirm/reopenForReview. Added here
  // because the trader panel's Reject action calls this endpoint.
  if (req.user.role === 'trader') {
    const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
    if (!trader) return fail(res, 404, 'Trader profile not found');
    if (order.trader_id !== trader.id) return fail(res, 403, 'This order does not belong to you');
  }

  if (['success', 'failed', 'rejected'].includes(order.status)) return ok(res, { order: orderView(order) });

  const traderId = order.trader_id;
  await order.update({ status: 'failed' });
  if (traderId) await routingEngine.releaseTrader(traderId, order.id);

  emitToMerchant(order.merchant_id, 'order:cancelled', { order_id: order.uuid });
  if (traderId) emitToTrader(traderId, 'order:cancelled', { order_id: order.uuid });
  emitToAdmin('order:cancelled', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:cancelled', { order_id: order.uuid, status: 'failed' });
  webhookService.sendWebhook(order.merchant_id, 'order.cancelled', { order_id: order.uuid }, { order }).catch(() => {});

  return ok(res, { order: orderView(order) });
});

/* ----------------------- POST /:id/cancel-checkout ------------------------- */
// Public (checkout page): the customer's own "Cancel" button. Only allowed
// before they've claimed payment — once claimed_paid, only a trader/admin
// can act (see the authenticated POST /:id/cancel above), so a donor can't
// cancel out from under a payment they already asserted they made.
const cancelCheckout = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (!['pending', 'checkout_open'].includes(order.status)) {
    return fail(res, 409, `Order can no longer be cancelled (status: ${order.status})`);
  }

  const traderId = order.trader_id;
  await order.update({ status: 'cancelled' });
  if (traderId) await routingEngine.releaseTrader(traderId, order.id);

  emitToMerchant(order.merchant_id, 'order:cancelled', { order_id: order.uuid });
  if (traderId) emitToTrader(traderId, 'order:cancelled', { order_id: order.uuid });
  emitToAdmin('order:cancelled', { order_id: order.uuid });
  emitToOrder(order.uuid, 'order:cancelled', { order_id: order.uuid, status: 'cancelled' });
  webhookService.sendWebhook(order.merchant_id, 'order.cancelled', { order_id: order.uuid }, { order }).catch(() => {});

  return ok(res, { success: true, status: 'cancelled', order: orderView(order) });
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
  webhookService.sendWebhook(order.merchant_id, 'order.expired', { order_id: order.uuid }, { order }).catch(() => {});

  return ok(res, { order: orderView(order) });
});

/* ------------------------ POST /:id/trader-confirm ------------------------ */
// The trader has manually checked their own bank/UPI app outside the system
// and confirms an order sitting in under_review. Bare click, no UTR input —
// distinguishable from auto-matched Tier 0/1/2 settlements via engine:
// 'trader_manual' (see smartMerge.confirmOrder's `engine` tag).
const traderConfirm = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) return fail(res, 404, 'Trader profile not found');

  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (order.trader_id !== trader.id) return fail(res, 403, 'This order does not belong to you');
  // Hard guard — not just a UI assumption. smartMerge.confirmOrder's own
  // idempotency check only catches "already success"; it does not care what
  // status an order was in before that, so the allowed set has to be
  // enforced here.
  //
  // Both REVIEWABLE_STATUSES are accepted: the customer has asserted payment
  // in either case, and the difference between them is only whether automated
  // matching has picked the order up yet. Restricting this to under_review
  // meant a trader looking at a claimed_paid order — who could see the
  // customer's UTR and had checked it against their own account — had no way
  // to settle it and could only wait on the matching engine.
  if (!db.Order.REVIEWABLE_STATUSES.includes(order.status)) {
    return fail(res, 409, `Order must be claimed_paid or under_review to confirm (current status: ${order.status})`);
  }

  await smartMerge.confirmOrder(order, { engine: 'trader_manual' });
  await order.reload();

  return ok(res, { success: true, status: order.status, order: orderView(order) });
});

/* --------------------- POST /:id/reopen-for-review ------------------------- */
// Trader-supplied recovery path for their OWN cancelled/failed order. Unlike
// trader-confirm above (bare click — the order is already sitting in
// under_review with an existing claim/matching trail), a cancelled/failed
// order has no such trail, so this requires the trader to supply real
// evidence: a UTR they actually found. Stored in donor_submitted_utr (added
// earlier for the donor-checkout flow, never wired to any UI until now) —
// deliberately not utr_number, which is reserved for the UTR a real
// settlement (smartMerge.confirmOrder) confirms against.
//
// The status transition itself goes through the ordinary Sequelize .update()
// path, so it's subject to the same active_amount_lock_key unique index
// (backend/src/migrations/20260722000001-add-active-amount-lock-index.js)
// that guards every other pending/checkout_open/claimed_paid/under_review
// order — a MySQL VIRTUAL generated column keyed on
// CONCAT(payment_detail_id, ':', amount_inr), recomputed automatically the
// instant `status` changes back into that active set. No code here computes
// or sets it; catching the resulting SequelizeUniqueConstraintError is the
// only thing needed to turn a real DB-level collision into a clean 409.
//
// Once reopened, no new settlement logic is needed — the order sits in
// under_review exactly like any other, and the existing, already-verified
// trader-confirm flow above takes over unchanged.
const REOPENABLE_STATUSES = ['cancelled', 'failed'];

const reopenForReview = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) return fail(res, 404, 'Trader profile not found');

  const order = await findOrder(req.params.id);
  if (!order) return fail(res, 404, 'Order not found');
  if (order.trader_id !== trader.id) return fail(res, 403, 'This order does not belong to you');
  if (!REOPENABLE_STATUSES.includes(order.status)) {
    return fail(res, 409, `Order must be cancelled or failed to reopen (current status: ${order.status})`);
  }

  const utr = String(req.body.utr || '').trim();
  if (!utr) return fail(res, 422, 'Enter the UTR you found for this payment before reopening it');

  try {
    await order.update({ status: 'under_review', donor_submitted_utr: utr });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, 409, 'This amount is currently assigned to another order and cannot be reopened');
    }
    throw err;
  }

  await order.reload();
  return ok(res, { success: true, status: order.status, order: orderView(order) });
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
//
// Search params (`id`, `amount`, `bank`) exist because Trades.jsx used to run
// its whole filter bar client-side over ONE page of results. Combined with the
// default limit=25 that made every order older than a trader's 25 most recent
// unreachable from the panel — including a cancelled order they needed to
// recover via reopen-for-review. Pushing the filters into the query is what
// lets real server-side pagination and "search my whole history" coexist:
// filter first, then page the filtered set.
//
// Substring (LIKE) semantics are deliberate — they reproduce exactly what the
// old client-side `String(x).includes(q)` checks did, so moving the work to the
// server doesn't silently change which rows match.
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

  const q = (key) => String(req.query[key] || '').trim();
  const like = (v) => ({ [Op.like]: `%${v}%` });
  const and = [];

  // Trade ID — the panel shows order.uuid, but a trader may paste any of the
  // identifiers they've seen, so match all of them.
  const idQ = q('id');
  if (idQ) {
    and.push({
      [Op.or]: [
        { uuid: like(idQ) },
        { gateway_order_id: like(idQ) },
        { merchant_order_id: like(idQ) },
        // Only a fully-numeric query can be a primary key; `LIKE` on an integer
        // column would otherwise force a full-table cast for no benefit.
        ...(/^\d+$/.test(idQ) ? [{ id: Number(idQ) }] : []),
      ],
    });
  }

  // `q` is the single free-text box in the panel header (HeaderSearch.jsx),
  // which used to pull one page of orders and grep it in the browser — so it
  // could only ever find something among the newest 25. The column list here
  // mirrors exactly what that local filter tested, so moving it server-side
  // widens the reach without changing what counts as a hit.
  const freeQ = q('q');
  if (freeQ) {
    and.push({
      [Op.or]: [
        { uuid: like(freeQ) },
        { gateway_order_id: like(freeQ) },
        { merchant_order_id: like(freeQ) },
        { customer_ref: like(freeQ) },
        { upi_ref_id: like(freeQ) },
        { amount_inr: like(freeQ) },
        { status: like(freeQ) },
        { '$paymentDetail.upi_id$': like(freeQ) },
        ...(/^\d+$/.test(freeQ) ? [{ id: Number(freeQ) }] : []),
      ],
    });
  }

  if (and.length) where[Op.and] = and;

  // amount_inr is DECIMAL(15,2); MySQL casts it to '137.00' for LIKE, which is
  // the same string the old client-side filter tested against.
  const amountQ = q('amount');
  if (amountQ) where.amount_inr = like(amountQ);

  // "My bank details" spans the joined payment detail's UPI id and account
  // name. `required` flips to an INNER JOIN only when this filter is active —
  // leaving it always-on would silently hide orders whose payment_detail_id is
  // null (order 3 in this dataset is exactly that).
  const bankQ = q('bank');
  const paymentDetailInclude = {
    model: db.PaymentDetail,
    as: 'paymentDetail',
    attributes: ['id', 'upi_id', 'account_type', 'account_name'],
    required: !!bankQ,
    ...(bankQ ? { where: { [Op.or]: [{ upi_id: like(bankQ) }, { account_name: like(bankQ) }] } } : {}),
  };

  const { rows, count } = await db.Order.findAndCountAll({
    where,
    include: [paymentDetailInclude],
    // `id` breaks ties. created_at is second-granular, so a burst of orders
    // shares a timestamp; with no tiebreaker MySQL may order those rows
    // differently per query, which under real pagination lets a row appear on
    // two pages (or none) as the trader clicks through.
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
    // Without this, a row-multiplying join makes `count` disagree with the
    // number of orders, and the panel renders phantom pages.
    distinct: true,
    // `q` references a joined column ($paymentDetail.upi_id$) from the
    // top-level WHERE. Sequelize's default LIMIT strategy wraps the base table
    // in a subquery that hasn't joined paymentDetail yet, so that condition
    // would reference a missing table. Safe to disable here specifically
    // because Order->PaymentDetail is belongsTo (1:1) — there are no duplicate
    // rows for LIMIT to slice incorrectly.
    ...(freeQ ? { subQuery: false } : {}),
  });

  return ok(res, { orders: rows.map(orderView), pagination: { page, limit, total: count } });
});

module.exports = { create, apiStatus, getOne, checkout, checkoutOpened, claimPaid, confirm, expire, dispute, list, newUpi, markPaid, cancel, cancelCheckout, verifyPayment, traderConfirm, reopenForReview };
