'use strict';

/**
 * staleClaimSweep job — runs every 30s (registered separately in server.js,
 * alongside but independent of orderExpiry's sweep).
 *
 * Bug 4 (prior investigation): orders that reach claimed_paid and never get
 * matched by the NGO backend sit forever — orderExpiry's sweep only touches
 * pending/checkout_open, so nothing times these out or alerts anyone.
 *
 * This does NOT auto-fail a stale claim — a real payment might still be
 * legitimately pending on the NGO/APK matching side. It only flips the order
 * to `under_review` (an existing, admin-queryable status already included in
 * REVIEWABLE_STATUSES and already what the admin panel's listOrders/
 * confirm/reject/dispute endpoints expect) and emits an alert, so a human
 * has to look at it instead of it silently rotting in claimed_paid.
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const webhookService = require('../services/webhookService');
const { emitToAdmin, emitToOrder } = require('../websocket');

const STALE_CLAIM_MINUTES = 30;

async function checkStaleClaims() {
  const threshold = new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000);
  const orders = await db.Order.findAll({
    where: {
      status: 'claimed_paid',
      claimed_paid_at: { [Op.lt]: threshold },
    },
    limit: 500,
  });

  for (const order of orders) {
    // eslint-disable-next-line no-await-in-loop
    await order.update({ status: 'under_review' });
    emitToAdmin('order:stale_review', {
      order_id: order.uuid,
      gateway_order_id: order.gateway_order_id,
      amount_inr: order.amount_inr,
      claimed_paid_at: order.claimed_paid_at,
      stale_minutes: STALE_CLAIM_MINUTES,
    });
    emitToOrder(order.uuid, 'order:updated', { order_id: order.uuid, status: 'under_review' });
    webhookService.sendWebhook(order.merchant_id, 'order.stale_review', { order_id: order.uuid }).catch(() => {});
  }

  if (orders.length) logger.info(`staleClaimSweep: flagged ${orders.length} stale claimed_paid order(s) for review`);
  return { flagged: orders.length };
}

module.exports = { checkStaleClaims, STALE_CLAIM_MINUTES };
