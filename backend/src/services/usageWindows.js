'use strict';

/**
 * Shared hour/day/week/month usage computation for a PaymentDetail —
 * COUNT + SUM of its orders since each window's start, from ONE Order query.
 *
 * This is the same live-aggregation approach routingEngine.pickEligibleAccount
 * already used (inline) to ENFORCE max_per_hour/day/week/month and
 * hourly/daily/weekly/monthly_limit(_amount). It's shared here so the numbers
 * routing enforces against and the numbers the trader-panel usage badge
 * displays can never drift apart — a stored, periodically-reset counter
 * (mirroring the legacy daily_limit/today_used pair) would be a second,
 * independent source of truth for the same fact, and every reset-cron this
 * session has touched has, at some point, been the actual bug (stale
 * ngo-backend process, missed EADDRINUSE, etc.) — a live query has no reset
 * to miss and is always exactly as correct as the Order table itself.
 */

const { Op } = require('sequelize');
const db = require('../models');

/**
 * Resolves the start of the current billing cycle for the monthly window.
 * If `monthlyStartDate` is set, the cycle anchors to that day-of-month
 * (rolling back to last month if today is before the anchor day this
 * month); otherwise it falls back to calendar month start.
 */
function monthWindowStart(monthlyStartDate, now) {
  if (monthlyStartDate) {
    const anchorDay = new Date(monthlyStartDate).getDate();
    let start = new Date(now.getFullYear(), now.getMonth(), anchorDay);
    if (start > now) start = new Date(now.getFullYear(), now.getMonth() - 1, anchorDay);
    return start;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * @param {number} paymentDetailId
 * @param {string|Date|null} monthlyStartDate
 * @param {object} [opts]
 * @param {*} [opts.statusWhere] Sequelize `status` where-fragment. Callers
 *   enforcing a cap (routingEngine) want in-flight orders counted too
 *   (`{[Op.notIn]: ['failed','rejected']}` — an order reserves capacity the
 *   moment it's created); callers displaying confirmed spend (the usage
 *   badge) want `'success'` only. Omit to count every order regardless of
 *   status.
 * @param {Date} [opts.now]
 */
async function computeWindowUsage(paymentDetailId, monthlyStartDate, opts = {}) {
  const now = opts.now || new Date();
  const hourStart = new Date(now.getTime() - 3600000);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 24 * 3600000);
  const monthStart = monthWindowStart(monthlyStartDate, now);

  const queryFloor = monthStart < weekStart ? monthStart : weekStart;
  const where = { payment_detail_id: paymentDetailId, created_at: { [Op.gte]: queryFloor } };
  if (opts.statusWhere !== undefined) where.status = opts.statusWhere;

  const orders = await db.Order.findAll({
    where,
    attributes: ['amount_inr', 'created_at'],
    raw: true,
  });

  const countSince = (since) => orders.reduce((n, o) => (o.created_at >= since ? n + 1 : n), 0);
  const sumSince = (since) => orders.reduce((s, o) => (o.created_at >= since ? s + Number(o.amount_inr) : s), 0);

  return {
    hourStart,
    dayStart,
    weekStart,
    monthStart,
    used_this_hour: countSince(hourStart),
    used_today: countSince(dayStart),
    used_this_week: countSince(weekStart),
    used_this_month: countSince(monthStart),
    hourly_amount_total: sumSince(hourStart),
    daily_amount_total: sumSince(dayStart),
    weekly_amount_total: sumSince(weekStart),
    monthly_amount_total: sumSince(monthStart),
  };
}

module.exports = { computeWindowUsage, monthWindowStart };
