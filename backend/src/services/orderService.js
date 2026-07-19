'use strict';

/**
 * orderService — v2 order creation shared by the API-key create endpoint and the
 * merchant-dashboard create endpoint, so both behave identically:
 *   validate → detect FTD/STD → route (same-amount lock + type filter) →
 *   generate gateway_order_id → snapshot rate → create (status 'pending') → notify.
 */

const crypto = require('crypto');

const db = require('../models');
const config = require('../config');
const logger = require('../utils/logger');
const rateService = require('./rateService');
const routingEngine = require('./routingEngine');
const { generateGatewayOrderId } = require('./orderIdGenerator');
const { validateDepositType } = require('./depositTypeChecker');
const { emitToTrader, emitToMerchant } = require('../websocket');

const CHECKOUT_BASE = process.env.FRONTEND_CHECKOUT_URL || 'http://localhost:5176';

function typedErr(status, error, message, extra) {
  return Object.assign(new Error(message), { status, error, extra: extra || {} });
}

async function createOrder(merchant, body = {}) {
  const amount = Number(body.amount_inr ?? body.amount);
  const depositTypeIn = String(body.deposit_type || 'STD').toUpperCase();
  const customerRef = body.customer_ref;

  // ---- validate ----
  if (!amount || amount <= 0) throw typedErr(400, 'invalid_amount', 'Amount must be positive');
  if (!customerRef) throw typedErr(400, 'missing_customer_ref', 'customer_ref is required');
  if (!['FTD', 'STD'].includes(depositTypeIn)) throw typedErr(400, 'invalid_deposit_type', 'deposit_type must be FTD or STD');
  if (!merchant || merchant.is_active === false) throw typedErr(403, 'merchant_inactive', 'Merchant account is not active');

  // ---- duplicate merchant_order_id (per merchant) ----
  if (body.merchant_order_id) {
    const dup = await db.Order.findOne({ where: { merchant_id: merchant.id, merchant_order_id: body.merchant_order_id } });
    if (dup) throw typedErr(409, 'duplicate_order', `merchant_order_id ${body.merchant_order_id} already exists`);
  }

  // ---- auto-detect FTD vs STD (server is the source of truth) ----
  const typeCheck = await validateDepositType(merchant.id, customerRef, depositTypeIn);
  const actualDepositType = typeCheck.detected;
  if (!typeCheck.match) logger.info(`order: deposit-type auto-correct — ${typeCheck.message}`);

  // ---- route ----
  const assignment = await routingEngine.findAvailableTrader(amount, actualDepositType);
  if (!assignment) {
    throw typedErr(503, 'no_provider_available', `No ${actualDepositType} payment provider available right now`, { deposit_type: actualDepositType });
  }

  // ---- amount-lock race guard around the create ----
  const orderKey = crypto.randomUUID();
  const locked = await routingEngine.acquireAmountLock(assignment.paymentDetail.id, amount, orderKey);
  if (!locked) throw typedErr(503, 'no_provider_available', 'Provider momentarily busy — please retry', { deposit_type: actualDepositType });

  try {
    if (await routingEngine.hasSameAmountActiveOrder(assignment.paymentDetail.id, amount)) {
      throw typedErr(503, 'no_provider_available', 'Provider just took a same-amount order — please retry', { deposit_type: actualDepositType });
    }

    const gatewayOrderId = await generateGatewayOrderId();
    const baseRate = await rateService.getBaseRate();
    const traderMargin = Number(assignment.trader.trader_margin || 4);
    const traderRate = +(baseRate * (1 + traderMargin / 100)).toFixed(4);
    const amountUsdt = +(amount / traderRate).toFixed(8);

    const order = await db.Order.create({
      uuid: crypto.randomUUID(),
      gateway_order_id: gatewayOrderId,
      merchant_order_id: body.merchant_order_id || null,
      merchant_id: merchant.id,
      trader_id: assignment.trader.id,
      payment_detail_id: assignment.paymentDetail.id,
      customer_ref: customerRef,
      amount_inr: amount,
      amount_usdt: amountUsdt,
      exchange_rate: baseRate,
      trader_rate: traderRate,
      deposit_type: actualDepositType,
      status: 'pending',
      callback_url: body.callback_url || null,
      redirect_url: body.redirect_url || null,
      expires_at: new Date(Date.now() + config.platform.orderExpiryMinutes * 60 * 1000),
    });

    emitToTrader(assignment.trader.id, 'order:new', {
      order_id: order.uuid, gateway_order_id: gatewayOrderId, amount_inr: amount, deposit_type: actualDepositType,
    });
    emitToMerchant(merchant.id, 'order:created', { order_id: order.uuid, gateway_order_id: gatewayOrderId, status: 'pending' });
    logger.info(`order created: ${gatewayOrderId} | ${actualDepositType} | ₹${amount} | trader#${assignment.trader.id} | ${assignment.paymentDetail.upi_id}`);

    return { order, assignment, gatewayOrderId, amountUsdt, actualDepositType, checkoutUrl: `${CHECKOUT_BASE}/?order=${order.uuid}` };
  } finally {
    await routingEngine.releaseAmountLock(assignment.paymentDetail.id, amount);
  }
}

module.exports = { createOrder };
