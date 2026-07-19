'use strict';

/**
 * balanceService — trader USDT balance mutations + the per-order fee/commission
 * settlement. Every change writes an append-only row to balance_logs.
 *
 * Three-way settlement model (amounts in USDT), computed in rateService:
 *   admin_rate           = base × (1 + merchant_payin%/100)
 *   merchant_settlement  = amount_inr / admin_rate       → credited to merchant
 *   trader_rate          = base × (1 + trader_margin%/100)
 *   trader_deduction     = amount_inr / trader_rate      → deducted from trader
 *   platform_revenue     = trader_deduction - merchant_settlement → platform wallet
 *
 * Balance effects on confirmation:
 *   trader.balance_usdt   -= trader_deduction
 *   merchant.balance_usdt += merchant_settlement
 *   settings.platform_revenue_usdt += platform_revenue
 */

const db = require('../models');
const logger = require('../utils/logger');
const rateService = require('./rateService');
const settingsService = require('./settingsService');

const round8 = (n) => +Number(n).toFixed(8);

/**
 * Apply a signed balance change to a trader and log it.
 * @param {number} traderId
 * @param {{type:'deposit'|'deduction'|'commission', amountUsdt:number, orderId?:number|null, note?:string}} change
 * @param {object} [opts] sequelize options (e.g. { transaction })
 */
async function adjustBalance(traderId, { type, amountUsdt, orderId = null, note = null }, opts = {}) {
  const magnitude = Math.abs(Number(amountUsdt));
  const signed = type === 'deduction' ? -magnitude : magnitude;

  const trader = await db.Trader.findByPk(traderId, opts);
  if (!trader) throw Object.assign(new Error('Trader not found'), { status: 404 });

  const balanceAfter = round8(Number(trader.balance_usdt) + signed);
  await trader.update({ balance_usdt: balanceAfter }, opts);

  const log = await db.BalanceLog.create(
    { trader_id: traderId, type, amount_usdt: magnitude, balance_after: balanceAfter, order_id: orderId, note },
    opts
  );

  return { trader, balance_after: balanceAfter, log };
}

/**
 * Admin add/deduct helper.
 * @param {number} traderId
 * @param {'add'|'deduct'} action
 * @param {number} amountUsdt
 * @param {string} [note]
 */
async function adminAdjust(traderId, action, amountUsdt, note) {
  const type = action === 'deduct' ? 'deduction' : 'deposit';
  return db.sequelize.transaction((transaction) =>
    adjustBalance(traderId, { type, amountUsdt, note: note || `Admin ${action}` }, { transaction })
  );
}

/**
 * Compute the rate-margin breakdown for an order without mutating anything.
 *   trader_rate = base × (1 + trader_margin/100)   admin_rate = base × (1 + admin_margin/100)
 *   trader_deduction = amount_inr / trader_rate     admin_receives = amount_inr / admin_rate
 *   platform_profit  = trader_deduction − admin_receives
 *   merchant_fee     = admin_receives × merchant_payin%   merchant_receives = admin_receives − merchant_fee
 */
async function computeFees(order) {
  const s = await rateService.calculateSettlement(order.amount_inr, order.trader_id, order.merchant_id);
  const amountUsdtBase = round8(Number(order.amount_inr) / s.base_rate);

  return {
    base_rate: s.base_rate,
    trader_rate: s.trader_rate,
    admin_rate: s.admin_rate,
    trader_margin: s.trader_margin_percent,
    merchant_payin_percent: s.merchant_payin_percent,
    // Merchant is credited the full amount_inr / admin_rate (fee baked into rate).
    merchant_settlement_usdt: s.merchant_settlement_usdt,
    merchant_receives_usdt: s.merchant_settlement_usdt,
    admin_receives_usdt: s.merchant_settlement_usdt,
    // Effective payin fee vs the base rate (for reporting only).
    merchant_fee_usdt: round8(amountUsdtBase - s.merchant_settlement_usdt),
    trader_deduction_usdt: s.trader_deduction_usdt,
    platform_profit_usdt: s.platform_revenue_usdt,
  };
}

/**
 * Settle a confirmed order under the rate-margin model. Deducts
 * trader_deduction_usdt from the trader, credits merchant_receives_usdt to the
 * merchant, and persists the full breakdown on the order. Idempotent per order
 * (the caller only settles once, on the confirm transition).
 * @returns the fee breakdown.
 */
async function settleOrder(order) {
  const trader = order.trader_id ? await db.Trader.findByPk(order.trader_id) : null;
  const merchant = order.merchant_id ? await db.Merchant.findByPk(order.merchant_id) : null;
  const fees = await computeFees(order);

  // Deduction ALWAYS uses the trader rate; merchant settlement uses the admin rate.
  console.log('Settlement calculation:', {
    amount_inr: Number(order.amount_inr),
    trader_rate: fees.trader_rate,
    admin_rate: fees.admin_rate,
    trader_deduction_usdt: fees.trader_deduction_usdt,
    merchant_settlement_usdt: fees.merchant_settlement_usdt,
    platform_revenue_usdt: fees.platform_profit_usdt,
  });

  if (trader && Number(trader.balance_usdt) < fees.trader_deduction_usdt) {
    throw Object.assign(
      new Error(`Trader insufficient balance. Has: ${trader.balance_usdt} USDT, needs: ${fees.trader_deduction_usdt} USDT`),
      { status: 422 }
    );
  }

  await db.sequelize.transaction(async (transaction) => {
    if (trader) {
      // Trader gives USDT (amount_inr / trader_rate). No commission credit —
      // the trader's margin is already baked into their (higher) rate.
      await adjustBalance(
        order.trader_id,
        {
          type: 'deduction',
          amountUsdt: fees.trader_deduction_usdt,
          orderId: order.id,
          note: `Order confirmed - ${order.amount_inr} INR @ rate ${fees.trader_rate}`,
        },
        { transaction }
      );
    }
    if (merchant) {
      // Merchant is credited amount_inr / admin_rate (fee baked into the rate).
      const newMerchantBal = round8(Number(merchant.balance_usdt) + fees.merchant_settlement_usdt);
      await merchant.update({ balance_usdt: newMerchantBal }, { transaction });
    }

    await order.update(
      {
        exchange_rate: fees.base_rate,
        trader_rate: fees.trader_rate,
        admin_rate: fees.admin_rate,
        amount_usdt: fees.merchant_settlement_usdt,
        trader_deduction_usdt: fees.trader_deduction_usdt,
        admin_receives_usdt: fees.merchant_settlement_usdt,
        merchant_fee_usdt: fees.merchant_fee_usdt,
        merchant_receives_usdt: fees.merchant_settlement_usdt,
        platform_profit_usdt: fees.platform_profit_usdt,
        confirmed_at: new Date(),
      },
      { transaction }
    );
  });

  // Accumulate the platform revenue wallet (settings table). Done outside the
  // transaction since settings live in their own table + cache.
  try {
    const current = await settingsService.getNumber('platform_revenue_usdt', 0);
    await settingsService.set('platform_revenue_usdt', round8(current + fees.platform_profit_usdt));
  } catch (err) {
    logger.warn(`balance: could not accumulate platform revenue: ${err.message}`);
  }

  logger.info(
    `balance: settled order ${order.id} — traderRate=${fees.trader_rate} adminRate=${fees.admin_rate} ` +
    `traderDeduction=${fees.trader_deduction_usdt} merchantSettlement=${fees.merchant_settlement_usdt} ` +
    `platformRevenue=${fees.platform_profit_usdt}`
  );
  return fees;
}

/**
 * Trader balance summary for the panel: total, locked (in active orders),
 * available, and commission earned today / all-time.
 */
async function traderBalanceSummary(traderId) {
  const { Op } = require('sequelize');
  const trader = await db.Trader.findByPk(traderId);
  if (!trader) return null;

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  // USDT locked in active (assigned/paid) orders, valued at the current rate.
  const activeInr = (await db.Order.sum('amount_inr', {
    where: { trader_id: traderId, status: { [Op.in]: db.Order.ACTIVE_STATUSES } },
  })) || 0;
  const { amountUsdt: lockedUsdt } = await rateService.inrToUsdt(activeInr);

  const [commissionToday, commissionTotal] = await Promise.all([
    db.BalanceLog.sum('amount_usdt', { where: { trader_id: traderId, type: 'commission', created_at: { [Op.gte]: startToday } } }),
    db.BalanceLog.sum('amount_usdt', { where: { trader_id: traderId, type: 'commission' } }),
  ]);

  const total = Number(trader.balance_usdt);
  const available = round8(total - lockedUsdt);

  return {
    balance_usdt: total,
    locked_usdt: round8(lockedUsdt),
    available_usdt: available < 0 ? 0 : available,
    commission_today_usdt: round8(commissionToday || 0),
    commission_total_usdt: round8(commissionTotal || 0),
    commission_rate: Number(trader.commission_rate),
    rate_label: trader.rate_label,
  };
}

module.exports = { adjustBalance, adminAdjust, computeFees, settleOrder, traderBalanceSummary };
