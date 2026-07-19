'use strict';

/**
 * Smart Merge Engine — combines detection signals from the 4 APK engines for
 * an order, scores confidence, and auto-confirms when confident enough.
 *
 * Confidence model (highest signal wins):
 *   screen_scraper (Engine 3)      -> 100  (auto confirm)
 *   notification + sms (2 + 1)     ->  85  (auto confirm)
 *   notification only (Engine 2)   ->  60  (wait / manual)
 *   sms only (Engine 1)            ->  40  (wait for more)
 *   manual (Engine 4)              -> 100  (trader override)
 *
 * Guards:
 *   - duplicate UTR is never confirmed twice,
 *   - detected amount must match the order amount (±1 INR tolerance).
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const routingEngine = require('./routingEngine');
const webhookService = require('./webhookService');
const telegramService = require('./telegramService');
const balanceService = require('./balanceService');
const { emitToTrader, emitToMerchant, emitToAdmin, emitToOrder } = require('../websocket');

const AUTO_CONFIRM_THRESHOLD = 85;
const AMOUNT_TOLERANCE = 1;

const ENGINE_SCORE = { screen_scraper: 100, manual: 100, notification: 60, sms: 40 };

/** Score a set of engine names that have reported for one order. */
function computeConfidence(engines) {
  const set = new Set(engines);
  if (set.has('screen_scraper')) return 100;
  if (set.has('manual')) return 100;
  if (set.has('notification') && set.has('sms')) return 85;
  if (set.has('notification')) return 60;
  if (set.has('sms')) return 40;
  return 0;
}

/** True if this UTR was already merged onto a different order. */
async function isDuplicateUtr(utr, excludeOrderId) {
  if (!utr) return false;
  const existing = await db.Transaction.findOne({
    where: {
      utr_number: utr,
      is_merged: true,
      ...(excludeOrderId ? { order_id: { [Op.ne]: excludeOrderId } } : {}),
    },
  });
  return !!existing;
}

function amountMatches(detected, expected) {
  if (detected == null) return false;
  return Math.abs(Number(detected) - Number(expected)) <= AMOUNT_TOLERANCE;
}

/**
 * Transition an order to SUCCESS (settled) and fire all side effects. Idempotent:
 * a no-op if the order is already success. Used by both high-confidence
 * auto-confirmation and the admin manual Confirm endpoint (reviewedBy set).
 */
async function confirmOrder(order, { utrNumber, engine, senderName, reviewedBy } = {}) {
  if (order.status === 'success') return order;

  await order.update({
    status: 'success',
    confirmed_at: new Date(),
    upi_ref_id: utrNumber || order.upi_ref_id,
    utr_number: utrNumber || order.utr_number,
    ...(reviewedBy ? { reviewed_by: reviewedBy, reviewed_at: new Date() } : {}),
  });

  // Mark this order's transactions merged.
  await db.Transaction.update({ is_merged: true }, { where: { order_id: order.id } });

  // Fee / commission settlement — moves trader + merchant USDT balances and
  // writes balance_logs. Non-fatal if it fails (order stays confirmed).
  let fees = null;
  try {
    fees = await balanceService.settleOrder(order);
  } catch (err) {
    logger.error(`smartMerge: settlement failed for order ${order.id}: ${err.message}`);
  }

  // Update daily-usage counters and release the trader.
  if (order.trader_id) {
    const amount = Number(order.amount_inr);
    if (order.payment_detail_id) {
      await db.PaymentDetail.increment({ today_used: amount }, { where: { id: order.payment_detail_id } });
    }
    await db.Trader.increment({ current_daily_used: amount }, { where: { id: order.trader_id } });
    await routingEngine.releaseTrader(order.trader_id, order.id);

    const trader = await db.Trader.findByPk(order.trader_id);
    // Trader gets an earnings-aware confirmation event (USDT deducted at their rate).
    emitToTrader(order.trader_id, 'order:confirmed', {
      order_id: order.uuid,
      amount_inr: order.amount_inr,
      deducted_usdt: fees ? fees.trader_deduction_usdt : undefined,
      trader_rate: fees ? fees.trader_rate : undefined,
      new_balance: trader ? Number(trader.balance_usdt) : undefined,
      utr: utrNumber,
      engine,
    });
    emitToTrader(order.trader_id, 'payment:detected', {
      order_id: order.id,
      amount_inr: order.amount_inr,
      utr: utrNumber,
      engine,
    });
    telegramService.sendPayInNotification(trader, order, order.amount_inr, senderName).catch(() => {});
  }

  // Emit both the legacy 'order:confirmed' (panels re-broadcast it as order:update)
  // and the v2 'order:success' event.
  for (const ev of ['order:confirmed', 'order:success']) {
    emitToMerchant(order.merchant_id, ev, {
      order_id: order.uuid,
      gateway_order_id: order.gateway_order_id,
      amount_inr: order.amount_inr,
      amount_usdt: fees ? fees.merchant_receives_usdt : undefined,
      utr: utrNumber,
    });
    emitToAdmin(ev, {
      order_id: order.uuid,
      gateway_order_id: order.gateway_order_id,
      trader_id: order.trader_id,
      platform_profit_usdt: fees ? fees.platform_profit_usdt : undefined,
    });
    emitToOrder(order.uuid, ev, { order_id: order.uuid, status: 'success', utr: utrNumber });
  }

  webhookService
    .sendWebhook(order.merchant_id, 'payment.success', {
      event: 'payment.success',
      gateway_order_id: order.gateway_order_id,
      merchant_order_id: order.merchant_order_id,
      order_id: order.uuid,
      amount_inr: order.amount_inr,
      amount_usdt: fees ? fees.merchant_receives_usdt : undefined,
      customer_ref: order.customer_ref,
      deposit_type: order.deposit_type,
      status: 'success',
      utr: utrNumber,
      timestamp: new Date().toISOString(),
    })
    .catch((err) => logger.error('webhook enqueue failed', err));

  logger.info(`smartMerge: order ${order.id} settled (success) via ${engine || 'merge'}`);
  return order;
}

/**
 * Collect all signals for an order, score them, and confirm or flag.
 * @returns {Promise<{confidence, status, confirmed}>}
 */
async function mergePaymentData(orderId) {
  const order = await db.Order.findByPk(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'success') return { confidence: 100, status: 'success', confirmed: true };

  const txns = await db.Transaction.findAll({ where: { order_id: orderId } });
  if (!txns.length) return { confidence: 0, status: order.status, confirmed: false };

  const confidence = computeConfidence(txns.map((t) => t.engine_used));

  // Pick the richest signal for UTR / sender / amount.
  const best = txns
    .slice()
    .sort((a, b) => (ENGINE_SCORE[b.engine_used] || 0) - (ENGINE_SCORE[a.engine_used] || 0))[0];

  // Persist the computed confidence on the contributing transactions.
  await db.Transaction.update({ confidence_score: confidence }, { where: { order_id: orderId } });

  // Guard: duplicate UTR.
  if (best.utr_number && (await isDuplicateUtr(best.utr_number, orderId))) {
    logger.warn(`smartMerge: duplicate UTR ${best.utr_number} on order ${orderId} — flagged`);
    emitToAdmin('order:flagged', { order_id: orderId, reason: 'duplicate_utr', utr: best.utr_number });
    return { confidence, status: 'flagged', confirmed: false, reason: 'duplicate_utr' };
  }

  // Guard: amount mismatch.
  if (best.amount_detected != null && !amountMatches(best.amount_detected, order.amount_inr)) {
    logger.warn(`smartMerge: amount mismatch on order ${orderId} (got ${best.amount_detected}, want ${order.amount_inr})`);
    emitToAdmin('order:flagged', { order_id: orderId, reason: 'amount_mismatch' });
    return { confidence, status: 'flagged', confirmed: false, reason: 'amount_mismatch' };
  }

  if (confidence >= AUTO_CONFIRM_THRESHOLD) {
    await confirmOrder(order, {
      utrNumber: best.utr_number,
      engine: best.engine_used,
      senderName: best.sender_name,
    });
    return { confidence, status: 'success', confirmed: true };
  }

  // Not confident enough — move to claimed_paid so an ADMIN reviews it (v2 does
  // not auto-settle below the threshold). Attach the detected UTR/proof.
  if (['pending', 'checkout_open'].includes(order.status)) {
    await order.update({
      status: 'claimed_paid',
      claimed_paid_at: new Date(),
      utr_number: best.utr_number || order.utr_number,
      confirmation_type: best.utr_number ? 'utr' : 'no_proof',
    });
    emitToAdmin('order:claimed_paid', { order_id: order.uuid, gateway_order_id: order.gateway_order_id, amount_inr: order.amount_inr, deposit_type: order.deposit_type });
  }
  emitToTrader(order.trader_id, 'payment:detected', {
    order_id: order.id,
    amount_inr: order.amount_inr,
    confidence,
    needs_review: true,
  });
  return { confidence, status: 'under_review', confirmed: false };
}

module.exports = { mergePaymentData, confirmOrder, computeConfidence, isDuplicateUtr };
