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
 * Transition an order to SUCCESS (settled) and fire all side effects.
 * Idempotent and race-safe: the order row is re-fetched under a
 * SELECT...FOR UPDATE lock and its status re-verified BEFORE any money
 * moves, all inside one transaction — matching the lock-and-recheck
 * pattern already proven elsewhere in this codebase (routingEngine's
 * amount-lock, payoutService's accept()/checkExpired()/settleAndCredit()).
 *
 * This closes two real races the un-locked version had:
 *   - Two concurrent callers (e.g. an SMS capture and a notification
 *     capture for the same real payment arriving close together) could
 *     both pass a stale `order.status === 'success'` check and both call
 *     settleOrder, double-crediting the merchant and double-debiting the
 *     trader for one real payment. Now only one caller's transaction can
 *     hold the row lock at a time, and the loser's re-check under that
 *     lock sees the winner's already-committed 'success' status and
 *     returns without moving money a second time.
 *   - A late settlement attempt landing after the order was independently
 *     flipped to a terminal status (e.g. 'failed' by the expiry sweep,
 *     which now takes the same lock — see orderExpiry.js) could previously
 *     resurrect it straight back to 'success', even after its trader/
 *     account had already been released and possibly reassigned. The
 *     ACTIVE_STATUSES re-check below refuses that instead of guessing.
 *
 * Used by both high-confidence auto-confirmation and the admin manual
 * Confirm endpoint (reviewedBy set).
 */
async function confirmOrder(order, { utrNumber, engine, senderName, reviewedBy } = {}) {
  if (order.status === 'success') return order; // fast-path only — re-checked under lock below regardless.

  let fees;
  let freshOrder;
  let alreadySettled = false;

  try {
    await db.sequelize.transaction(async (transaction) => {
      freshOrder = await db.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!freshOrder) throw Object.assign(new Error('Order not found'), { status: 404 });

      if (freshOrder.status === 'success') {
        // A concurrent call already settled this order while we were
        // waiting on the lock — idempotent no-op, not an error.
        alreadySettled = true;
        return;
      }
      if (!db.Order.ACTIVE_STATUSES.includes(freshOrder.status)) {
        // Terminal (failed/rejected/disputed/cancelled) — refuse to
        // resurrect it. A late settlement landing here means something
        // else already concluded this order; that must win, not us.
        throw Object.assign(
          new Error(`Cannot settle order ${freshOrder.id} — status is terminal ('${freshOrder.status}')`),
          { status: 409, code: 'order_terminal' }
        );
      }

      // Settle FIRST, then mark success — both inside this same locked
      // transaction now, so a settlement failure (e.g. insufficient trader
      // balance) rolls back cleanly with nothing partially written, and a
      // successful settlement can never be observed by another transaction
      // without the status flip already having happened too.
      fees = await balanceService.settleOrder(freshOrder, transaction);

      await freshOrder.update(
        {
          status: 'success',
          confirmed_at: freshOrder.confirmed_at || new Date(),
          upi_ref_id: utrNumber || freshOrder.upi_ref_id,
          utr_number: utrNumber || freshOrder.utr_number,
          confirm_engine: engine || freshOrder.confirm_engine,
          ...(reviewedBy ? { reviewed_by: reviewedBy, reviewed_at: new Date() } : {}),
        },
        { transaction }
      );
    });
  } catch (err) {
    if (err.code === 'order_terminal') {
      logger.warn(`smartMerge: ${err.message} — refusing to settle (not an error, a correctly-lost race)`);
      throw err;
    }
    logger.error(`smartMerge: settlement failed for order ${order.id}: ${err.message} — not marking success`);
    emitToAdmin('order:settlement_failed', {
      order_id: order.uuid,
      gateway_order_id: order.gateway_order_id,
      trader_id: order.trader_id,
      amount_inr: order.amount_inr,
      reason: err.message,
    });
    throw Object.assign(err, { status: err.status || 422 });
  }

  if (alreadySettled) return freshOrder;

  // Mark this order's transactions merged.
  await db.Transaction.update({ is_merged: true }, { where: { order_id: freshOrder.id } });

  // Update daily-usage counters and release the trader.
  if (freshOrder.trader_id) {
    const amount = Number(freshOrder.amount_inr);
    if (freshOrder.payment_detail_id) {
      await db.PaymentDetail.increment({ today_used: amount }, { where: { id: freshOrder.payment_detail_id } });
    }
    await db.Trader.increment({ current_daily_used: amount }, { where: { id: freshOrder.trader_id } });
    await routingEngine.releaseTrader(freshOrder.trader_id, freshOrder.id);

    const trader = await db.Trader.findByPk(freshOrder.trader_id);
    // Trader gets an earnings-aware confirmation event (USDT deducted at their rate).
    emitToTrader(freshOrder.trader_id, 'order:confirmed', {
      order_id: freshOrder.uuid,
      amount_inr: freshOrder.amount_inr,
      deducted_usdt: fees ? fees.trader_deduction_usdt : undefined,
      trader_rate: fees ? fees.trader_rate : undefined,
      new_balance: trader ? Number(trader.balance_usdt) : undefined,
      utr: utrNumber,
      engine,
    });
    emitToTrader(freshOrder.trader_id, 'payment:detected', {
      order_id: freshOrder.id,
      amount_inr: freshOrder.amount_inr,
      utr: utrNumber,
      engine,
    });
    telegramService.sendPayInNotification(trader, freshOrder, freshOrder.amount_inr, senderName).catch(() => {});
  }

  // Emit both the legacy 'order:confirmed' (panels re-broadcast it as order:update)
  // and the v2 'order:success' event.
  for (const ev of ['order:confirmed', 'order:success']) {
    emitToMerchant(freshOrder.merchant_id, ev, {
      order_id: freshOrder.uuid,
      gateway_order_id: freshOrder.gateway_order_id,
      amount_inr: freshOrder.amount_inr,
      amount_usdt: fees ? fees.merchant_receives_usdt : undefined,
      utr: utrNumber,
    });
    emitToAdmin(ev, {
      order_id: freshOrder.uuid,
      gateway_order_id: freshOrder.gateway_order_id,
      trader_id: freshOrder.trader_id,
      platform_profit_usdt: fees ? fees.platform_profit_usdt : undefined,
    });
    emitToOrder(freshOrder.uuid, ev, { order_id: freshOrder.uuid, status: 'success', utr: utrNumber });
  }

  webhookService
    .sendWebhook(freshOrder.merchant_id, 'payment.success', {
      event: 'payment.success',
      gateway_order_id: freshOrder.gateway_order_id,
      merchant_order_id: freshOrder.merchant_order_id,
      order_id: freshOrder.uuid,
      amount_inr: freshOrder.amount_inr,
      // The real USDT the merchant is credited, at the admin rate. Distinct
      // from the order-creation response's `estimated_amount_usdt`, which is
      // computed at the TRADER rate — the two were both called `amount_usdt`
      // and meant different numbers, which no partner could be expected to
      // guess. This one is the settled, authoritative figure.
      amount_usdt: fees ? fees.merchant_receives_usdt : undefined,
      customer_ref: freshOrder.customer_ref,
      deposit_type: freshOrder.deposit_type,
      status: 'success',
      utr: utrNumber,
      timestamp: new Date().toISOString(),
    }, { order: freshOrder })
    .catch((err) => logger.error('webhook enqueue failed', err));

  logger.info(`smartMerge: order ${freshOrder.id} settled (success) via ${engine || 'merge'}`);
  return freshOrder;
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
    // confirmOrder re-verifies the order's status under a row lock before
    // moving any money — a concurrent settlement for this same order can
    // legitimately win that race instead of this call. That's correct, not
    // a crash: report it as the (already-true) settled outcome rather than
    // letting the exception surface as a 500 to this route's caller.
    try {
      await confirmOrder(order, {
        utrNumber: best.utr_number,
        engine: best.engine_used,
        senderName: best.sender_name,
      });
    } catch (err) {
      if (err.code === 'order_terminal') {
        logger.warn(`smartMerge: mergePaymentData lost the settlement race for order ${orderId} — ${err.message}`);
        return { confidence, status: 'success', confirmed: true };
      }
      throw err;
    }
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
