'use strict';

/**
 * paymentController — payment-detection ingestion from the 4 APK engines.
 *
 *   POST /api/payment/sms          Engine 1 (device auth)   store + merge
 *   POST /api/payment/notification Engine 2 (device auth)   store + merge
 *   POST /api/payment/screen       Engine 3 (device auth)   store + merge (100%)
 *   POST /api/payment/manual       Engine 4 (trader auth)   override + confirm
 *
 * All signals flow through `ingest()` which stores a Transaction (and a
 * NotificationLog for Engine 2), tries to match an open order, and triggers
 * the Smart Merge engine.
 */

const { Op } = require('sequelize');

const db = require('../models');
const { ok, created, fail, asyncHandler } = require('../utils/http');
const smartMerge = require('../services/smartMerge');

const BASE_CONFIDENCE = { sms: 40, notification: 60, screen_scraper: 100, manual: 100 };

/**
 * Find the open order a detected payment most likely belongs to.
 * Matches on amount (+ target UPI / trader when known), newest first.
 */
async function matchOrder({ amount, upiId, traderId }) {
  const where = { status: { [Op.in]: db.Order.ACTIVE_STATUSES } };
  if (amount != null) where.amount_inr = amount;
  if (traderId) where.trader_id = traderId;

  const include = [];
  if (upiId) {
    include.push({ model: db.PaymentDetail, as: 'paymentDetail', where: { upi_id: upiId }, required: true });
  }
  return db.Order.findOne({ where, include, order: [['created_at', 'DESC']] });
}

/**
 * Core ingestion shared by every engine.
 * @param {'sms'|'notification'|'screen_scraper'} engine
 */
async function ingest(engine, { device, amount, utr, senderName, senderUpi, upiId, raw }) {
  const traderId = device?.trader_id || null;
  const order = await matchOrder({ amount, upiId, traderId });

  const txn = await db.Transaction.create({
    order_id: order ? order.id : null,
    smartphone_id: device ? device.id : null,
    engine_used: engine,
    raw_data: typeof raw === 'string' ? raw : JSON.stringify(raw || {}),
    amount_detected: amount ?? null,
    utr_number: utr || null,
    sender_name: senderName || null,
    sender_upi: senderUpi || null,
    confidence_score: BASE_CONFIDENCE[engine] || 0,
  });

  // Engine 2 (notification) additionally logs to notification_logs.
  if (engine === 'notification' && traderId) {
    await db.NotificationLog.create({
      trader_id: traderId,
      notification_id: `NTF-${txn.id}`,
      amount: amount ?? null,
      currency: 'INR',
      transaction_id: utr || null,
      payment_method: upiId || senderUpi || null,
      description: typeof raw === 'string' ? raw : JSON.stringify(raw || {}),
      received_at: new Date(),
    });
  }

  let merge = null;
  if (order) merge = await smartMerge.mergePaymentData(order.id);

  return { transaction_id: txn.id, matched_order: order ? order.uuid : null, merge };
}

/* ------------------------------ Engine 1: SMS ----------------------------- */
const sms = asyncHandler(async (req, res) => {
  const { amount, utr, sender_name, raw } = req.body || {};
  const result = await ingest('sms', {
    device: req.device,
    amount: amount != null ? Number(amount) : null,
    utr,
    senderName: sender_name,
    raw: raw || req.body,
  });
  return created(res, result);
});

/* -------------------------- Engine 2: Notification ------------------------ */
const notification = asyncHandler(async (req, res) => {
  const { amount, upi_ref, sender_upi, upi_id, raw } = req.body || {};
  const result = await ingest('notification', {
    device: req.device,
    amount: amount != null ? Number(amount) : null,
    utr: upi_ref,
    senderUpi: sender_upi,
    upiId: upi_id,
    raw: raw || req.body,
  });
  return created(res, result);
});

/* --------------------------- Engine 3: Screen ----------------------------- */
const screen = asyncHandler(async (req, res) => {
  const { amount, utr, sender_name, sender_upi, upi_id, raw } = req.body || {};
  const result = await ingest('screen_scraper', {
    device: req.device,
    amount: amount != null ? Number(amount) : null,
    utr,
    senderName: sender_name,
    senderUpi: sender_upi,
    upiId: upi_id,
    raw: raw || req.body,
  });
  return created(res, result);
});

/* --------------------------- Engine 4: Manual ----------------------------- */
// Trader confirms a payment from their panel. Requires order_id + trader auth.
const manual = asyncHandler(async (req, res) => {
  const { order_id, utr, sender_name } = req.body || {};
  if (!order_id) return fail(res, 422, 'order_id is required');

  const where = /^\d+$/.test(String(order_id)) ? { id: order_id } : { uuid: order_id };
  const order = await db.Order.findOne({ where });
  if (!order) return fail(res, 404, 'Order not found');
  if (['success', 'failed', 'rejected'].includes(order.status)) return fail(res, 409, `Order is ${order.status}`);

  await db.Transaction.create({
    order_id: order.id,
    engine_used: 'manual',
    amount_detected: order.amount_inr,
    utr_number: utr || order.upi_ref_id || null,
    sender_name: sender_name || null,
    confidence_score: 100,
  });
  await smartMerge.confirmOrder(order, { utrNumber: utr, engine: 'manual', senderName: sender_name });
  await order.reload();

  return ok(res, { order_id: order.uuid, status: order.status });
});

module.exports = { sms, notification, screen, manual, ingest };
