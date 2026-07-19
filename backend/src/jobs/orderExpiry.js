'use strict';

/**
 * orderExpiry job — runs every 30s.
 * Expires orders whose window has elapsed while still open, releases the
 * assigned trader back to the pool, and notifies both parties.
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const routingEngine = require('../services/routingEngine');
const webhookService = require('../services/webhookService');
const { emitToTrader, emitToMerchant } = require('../websocket');

async function checkExpiredOrders() {
  const now = new Date();
  // Only unclaimed orders expire. Once a customer has claimed payment
  // (claimed_paid/under_review) it waits for an admin, never auto-fails.
  const orders = await db.Order.findAll({
    where: {
      status: { [Op.in]: ['pending', 'checkout_open'] },
      expires_at: { [Op.lt]: now },
    },
    limit: 500,
  });

  for (const order of orders) {
    const traderId = order.trader_id;
    await order.update({ status: 'failed' });
    if (traderId) {
      await routingEngine.releaseTrader(traderId, order.id);
      emitToTrader(traderId, 'order:expired', { order_id: order.uuid });
    }
    emitToMerchant(order.merchant_id, 'order:expired', { order_id: order.uuid });
    webhookService.sendWebhook(order.merchant_id, 'order.expired', { order_id: order.uuid }).catch(() => {});
  }

  if (orders.length) logger.info(`orderExpiry: expired ${orders.length} order(s)`);
  return { expired: orders.length };
}

module.exports = { checkExpiredOrders };
