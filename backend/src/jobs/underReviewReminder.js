'use strict';

/**
 * underReviewReminder job — finds orders that have been sitting in
 * under_review for >= REMINDER_THRESHOLD_HOURS and nudges a human to close
 * them out. Notifications only — no status change, no balance touch, no
 * auto-close. A trader (Confirm button) or admin (existing confirm/reject/
 * dispute endpoints, which already work on under_review orders regardless
 * of age — see adminController.js's REVIEWABLE_STATUSES gate) always makes
 * the final call.
 *
 * Same registration/processing pattern as staleClaimSweep.js/orderExpiry.js
 * (sequential for-loop, capped batch, errors bubble to the setInterval
 * caller in server.js) — see reminder_sent_at's migration comment for why
 * that column exists.
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const telegramService = require('../services/telegramService');

const REMINDER_THRESHOLD_HOURS = 2;

async function checkUnderReviewReminders() {
  const threshold = new Date(Date.now() - REMINDER_THRESHOLD_HOURS * 60 * 60 * 1000);
  const orders = await db.Order.findAll({
    where: {
      status: 'under_review',
      updated_at: { [Op.lt]: threshold },
      reminder_sent_at: null,
    },
    limit: 500,
  });

  for (const order of orders) {
    const amount = order.amount_inr;

    // Trader in-panel notification — the real, established path: a
    // NotificationLog row (backs GET /trader/notifications, which
    // NotificationBell reads). There's no dedicated "notification" socket
    // event in this codebase to piggyback on (NotificationBell only
    // refetches on payment:detected/order:confirmed, neither of which
    // apply here), so this relies on the bell's own poll/next-refetch to
    // surface it — deliberately not inventing a new event type.
    if (order.trader_id) {
      // eslint-disable-next-line no-await-in-loop
      await db.NotificationLog.create({
        trader_id: order.trader_id,
        notification_id: `REMINDER-${order.id}`,
        amount,
        currency: 'INR',
        transaction_id: order.utr_number || order.donor_submitted_utr || null,
        payment_method: null,
        description: `Order ${order.uuid} has been under review for ${REMINDER_THRESHOLD_HOURS}+ hours — please confirm or reject.`,
        received_at: new Date(),
      });
    }

    // Admin/support Telegram alert — same fire-and-forget pattern as every
    // other telegramService call site in this codebase.
    telegramService
      .sendAlertToAdmin(
        `Order ${order.uuid} has been under_review for ${REMINDER_THRESHOLD_HOURS}+ hours (₹${amount}, trader ${order.trader_id || 'unassigned'}) — please confirm or reject.`
      )
      .catch(() => {});

    // eslint-disable-next-line no-await-in-loop
    await order.update({ reminder_sent_at: new Date() });
  }

  if (orders.length) logger.info(`underReviewReminder: reminded on ${orders.length} stale under_review order(s)`);
  return { reminded: orders.length };
}

module.exports = { checkUnderReviewReminders, REMINDER_THRESHOLD_HOURS };
