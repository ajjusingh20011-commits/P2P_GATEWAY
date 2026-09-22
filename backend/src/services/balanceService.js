'use strict';

/**
 * balanceService — trader USDT balance mutations + the per-order fee/commission
 * settlement. Every change writes an append-only row to balance_logs.
 *
 * Three-way settlement model (amounts in USDT), computed in rateService — SUBTRACTIVE:
 *   base_usdt            = amount_inr / base_rate
 *   merchant_settlement  = base_usdt - (base_usdt × merchant_payin%/100)  → credited to merchant
 *   trader_deduction     = base_usdt - (base_usdt × trader_margin%/100)  → deducted from trader
 *   platform_revenue     = trader_deduction - merchant_settlement        → platform wallet
 *   merchant_fee_usdt    = base_usdt × merchant_payin%/100               → real amount subtracted
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
 *   base_usdt         = amount_inr / base_rate
 *   trader_deduction  = base_usdt − (base_usdt × trader_margin%/100)
 *   merchant_receives = base_usdt − (base_usdt × merchant_payin%/100)
 *   merchant_fee      = base_usdt × merchant_payin%/100   (the real amount subtracted)
 *   platform_profit   = trader_deduction − merchant_receives
 */
async function computeFees(order) {
  const s = await rateService.calculateSettlement(order.amount_inr, order.trader_id, order.merchant_id);

  return {
    base_rate: s.base_rate,
    trader_rate: s.trader_rate,
    admin_rate: s.admin_rate,
    trader_margin: s.trader_margin_percent,
    merchant_payin_percent: s.merchant_payin_percent,
    // Merchant is credited base_usdt minus the real subtracted merchant fee.
    merchant_settlement_usdt: s.merchant_settlement_usdt,
    merchant_receives_usdt: s.merchant_settlement_usdt,
    admin_receives_usdt: s.merchant_settlement_usdt,
    // Real amount subtracted from base_usdt (base_usdt × merchant_payin%/100) —
    // no longer a reporting-only implied figure.
    merchant_fee_usdt: s.merchant_fee_usdt,
    trader_deduction_usdt: s.trader_deduction_usdt,
    platform_profit_usdt: s.platform_revenue_usdt,
  };
}

/**
 * Settle a confirmed order under the rate-margin model. Deducts
 * trader_deduction_usdt from the trader, credits merchant_receives_usdt to the
 * merchant, and persists the full breakdown on the order.
 *
 * MUST be called with an active `transaction` that already holds the order
 * row's lock (see smartMerge.confirmOrder) — this function locks the
 * trader/merchant rows WITHIN that same transaction, so the balance
 * read-modify-write and the order's status transition commit or fail
 * together as one atomic unit. Two concurrent settlement attempts for the
 * same order can then no longer both move money: the second caller blocks
 * on confirmOrder's order-row lock until the first transaction commits,
 * then its own re-check of order.status (done by the caller, before this
 * runs) sees the order is no longer active and never calls this at all.
 *
 * Separately, locking the trader/merchant rows here (previously the
 * merchant was read unlocked, so its new balance was computed from a
 * possibly-stale read) also closes a real lost-update: two different
 * orders settling to the same merchant at nearly the same moment could
 * previously clobber each other's credit.
 *
 * @param {object} order
 * @param {import('sequelize').Transaction} transaction - required; caller
 *   already holds this order row's FOR UPDATE lock inside it.
 * @returns the fee breakdown.
 */
async function settleOrder(order, transaction) {
  if (!transaction) {
    throw Object.assign(
      new Error('settleOrder requires an active transaction — the caller must already hold the order row lock'),
      { status: 500 }
    );
  }

  const trader = order.trader_id
    ? await db.Trader.findByPk(order.trader_id, { transaction, lock: transaction.LOCK.UPDATE })
    : null;
  const merchant = order.merchant_id
    ? await db.Merchant.findByPk(order.merchant_id, { transaction, lock: transaction.LOCK.UPDATE })
    : null;
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

  if (trader) {
    // Trader gives USDT (amount_inr / trader_rate). No commission credit —
    // the trader's margin is already baked into their (higher) rate.
    // adjustBalance re-reads the trader by id; passing the same lock option
    // is harmless (InnoDB row locks are reentrant within one transaction)
    // and keeps this using the shared, log-writing helper.
    await adjustBalance(
      order.trader_id,
      {
        type: 'deduction',
        amountUsdt: fees.trader_deduction_usdt,
        orderId: order.id,
        note: `Order confirmed - ${order.amount_inr} INR @ rate ${fees.trader_rate}`,
      },
      { transaction, lock: transaction.LOCK.UPDATE }
    );
  }
  if (merchant) {
    // Merchant is credited amount_inr / admin_rate (fee baked into the rate).
    // Computed from the LOCKED read above, not a stale unlocked one.
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

  // Accumulate the platform revenue wallet (settings table). Done outside
  // this transaction on purpose: settings live in their own table + cache,
  // and this figure is a best-effort accounting total, not a per-order
  // balance that must stay perfectly atomic with the settlement itself —
  // matches the original code's placement (this ran after the old inner
  // transaction committed too).
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
