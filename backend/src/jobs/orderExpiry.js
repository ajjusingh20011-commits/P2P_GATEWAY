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

  let expiredCount = 0;
  for (const order of orders) {
    // Re-fetch under a row lock and re-verify status immediately before
    // writing — matching the same pattern smartMerge.confirmOrder now uses
    // on this same table. Previously this was a plain, unconditioned
    // `order.update({status:'failed'})` on a row read moments earlier: a
    // genuine settlement landing in that gap could commit 'success' and
    // then have this sweep silently overwrite it back to 'failed', with no
    // reconciliation ever revisiting it. Taking the same FOR UPDATE lock
    // here means MySQL serializes the two paths on this row — whichever
    // transaction commits first wins, and the loser's re-check below sees
    // the winner's already-committed status and correctly skips instead of
    // blindly overwriting it.
    // eslint-disable-next-line no-await-in-loop
    const fresh = await db.sequelize.transaction(async (transaction) => {
      const row = await db.Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row || !['pending', 'checkout_open'].includes(row.status)) return null; // raced with a settlement/claim
      await row.update({ status: 'failed' }, { transaction });
      return row;
    });
    if (!fresh) continue;

    expiredCount += 1;
    const traderId = fresh.trader_id;
    if (traderId) {
      // eslint-disable-next-line no-await-in-loop
      await routingEngine.releaseTrader(traderId, fresh.id);
      emitToTrader(traderId, 'order:expired', { order_id: fresh.uuid });
    }
    emitToMerchant(fresh.merchant_id, 'order:expired', { order_id: fresh.uuid });
    webhookService.sendWebhook(fresh.merchant_id, 'order.expired', { order_id: fresh.uuid }, { order: fresh }).catch(() => {});
  }

  if (expiredCount) logger.info(`orderExpiry: expired ${expiredCount} order(s)`);
  return { expired: expiredCount };
}

module.exports = { checkExpiredOrders };
