'use strict';

/**
 * settlementJob — daily settlement (also runnable on demand from the admin API).
 *
 * Groups today's confirmed orders by (trader, merchant), computes the platform
 * fee + trader commission + net, writes a Settlement row per group, and credits
 * balances. Finally resets daily-usage counters for the new day.
 */

const { Op } = require('sequelize');

const config = require('../config');
const db = require('../models');
const logger = require('../utils/logger');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function runSettlement() {
  const since = startOfToday();
  const rate = config.platform.exchangeRate;
  const feePct = config.platform.feePercent;
  const commissionPct = config.platform.traderCommissionPercent;

  const orders = await db.Order.findAll({
    where: { status: 'success', trader_id: { [Op.ne]: null }, created_at: { [Op.gte]: since } },
    attributes: ['id', 'trader_id', 'merchant_id', 'amount_inr'],
  });

  // Group by trader:merchant.
  const groups = new Map();
  for (const o of orders) {
    const key = `${o.trader_id}:${o.merchant_id}`;
    const g = groups.get(key) || { trader_id: o.trader_id, merchant_id: o.merchant_id, total: 0 };
    g.total += Number(o.amount_inr);
    groups.set(key, g);
  }

  const created = [];
  for (const g of groups.values()) {
    const platformFee = +(g.total * (feePct / 100)).toFixed(2);
    const traderCommission = +(g.total * (commissionPct / 100)).toFixed(2);
    const net = +(g.total - platformFee - traderCommission).toFixed(2);

    const settlement = await db.Settlement.create({
      trader_id: g.trader_id,
      merchant_id: g.merchant_id,
      total_amount: g.total,
      platform_fee: platformFee,
      trader_commission: traderCommission,
      net_amount: net,
      status: 'completed',
      settled_at: new Date(),
    });

    // Credit balances (converted to USDT).
    await db.Trader.increment({ balance_usdt: +(traderCommission / rate).toFixed(8) }, { where: { id: g.trader_id } });
    await db.Merchant.increment({ balance: +(net / rate).toFixed(8) }, { where: { id: g.merchant_id } });
    created.push(settlement.id);
  }

  // Reset daily-usage counters for the new day.
  await db.Trader.update({ current_daily_used: 0 }, { where: {} });
  await db.PaymentDetail.update({ today_used: 0 }, { where: {} });

  logger.info(`settlement: created ${created.length} settlement(s) from ${orders.length} order(s)`);
  return { settlements_created: created.length, orders_processed: orders.length };
}

module.exports = { runSettlement };
