'use strict';

/**
 * orderIdGenerator — sequential, human-readable gateway order ids.
 * Format: PG_YYYYMMDD_NNNNN (5-digit sequence, resets each day).
 * Example: PG_20260711_00001
 */

const { Op } = require('sequelize');
const db = require('../models');

async function generateGatewayOrderId() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Highest sequence used today (order by the id column, not the string).
  const lastOrder = await db.Order.findOne({
    where: { gateway_order_id: { [Op.like]: `PG_${dateStr}_%` } },
    order: [['id', 'DESC']],
  });

  let sequence = 1;
  if (lastOrder && lastOrder.gateway_order_id) {
    const parts = String(lastOrder.gateway_order_id).split('_');
    const n = parseInt(parts[2], 10);
    if (Number.isFinite(n)) sequence = n + 1;
  }

  const padded = String(sequence).padStart(5, '0');
  return `PG_${dateStr}_${padded}`;
}

module.exports = { generateGatewayOrderId };
