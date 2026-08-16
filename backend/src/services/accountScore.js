'use strict';

/**
 * Session-scoped success score for a payment account, and the routing gate
 * built on it.
 *
 * FORMULA (exactly as specified — the zero-success branch is deliberately not
 * a percentage of anything, it is a decaying penalty):
 *
 *     x > 0   ->  (x / y) * 100
 *     x === 0 ->  50 / y
 *
 *   1/3 -> 33.33     2/6 -> 33.33
 *   0/3 -> 16.67     0/4 -> 12.5
 *
 * y === 0 (no scored orders yet) returns null, not a number. A fresh account
 * must be able to take its first order; scoring it 0% would make the gate
 * below permanently unsatisfiable and nothing would ever route.
 *
 * WHAT COUNTS (y) — Item 3, real assignment accounting. Every order ASSIGNED to
 * this account in its CURRENT live session is a genuine opportunity and enters
 * the score once it has CONCLUDED (reached a terminal status), whether or not
 * the customer ever claimed it. In particular an order that timed out un-claimed
 * (status 'failed') counts — the old rule scored only customer-claimed orders,
 * so an account could be handed real chances that went nowhere and still show a
 * fake 100%. In-flight orders (ACTIVE_STATUSES) are not yet an outcome and are
 * excluded until they finish; a disconnect_failed order counts even while still
 * active, because the outage already reached the customer.
 *
 * WHAT COUNTS AS SUCCESS (x). Settled successfully AND not disconnect_failed.
 * A disconnect failure is permanent: reconnecting and settling the order later
 * does not redeem it, because the customer already experienced the outage.
 */

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');

// Below this, an account stops receiving new orders.
const MIN_SUCCESS_RATE = 30;

/**
 * Orders belonging to `detail`'s current session that are scored at all.
 *
 * Membership is decided by order id, not by timestamp: both
 * live_session_started_at and orders.created_at are second-granular, so an
 * order created in the same second as a toggle-on could be attributed to
 * either session and a reset would not reliably clear the score.
 */
function scoredWhere(detail) {
  return {
    payment_detail_id: detail.id,
    id: { [Op.gt]: detail.live_session_start_order_id || 0 },
    // Item 3 — real assignment accounting. Every order ASSIGNED to this account
    // in the current session is a genuine opportunity, and it is scored once it
    // has CONCLUDED, regardless of whether the customer ever claimed it. A
    // timed-out un-claimed order (jobs/orderExpiry.js sets status 'failed') now
    // counts as a non-success — closing the old gap where an order the customer
    // never followed through on counted as nothing, letting an account sit at a
    // fake 100% despite real chances that went nowhere.
    //
    // Scored "on conclusion", not at assignment: an in-flight order
    // (ACTIVE_STATUSES) is not yet an outcome, so it is excluded until it
    // finishes — otherwise an account legitimately handling several concurrent
    // orders would be pushed below the threshold and starved. A disconnect
    // failure is the one exception: it counts even while the order is still in
    // an active status, because the outage already happened to the customer.
    [Op.or]: [
      { status: { [Op.notIn]: db.Order.ACTIVE_STATUSES } },
      { disconnect_failed: true },
    ],
  };
}

/** The spec's formula. Exported so it can be checked directly. */
function computeRate(x, y) {
  if (!y) return null;              // no scored orders — exempt, see above
  if (x > 0) return +((x / y) * 100).toFixed(2);
  return +(50 / y).toFixed(2);      // zero successes: a decaying penalty
}

/**
 * @returns {Promise<{rate: number|null, successes: number, scored: number, sessionStartedAt: Date|null}>}
 */
async function sessionScore(detail) {
  if (!detail || !detail.live_session_started_at) {
    return { rate: null, successes: 0, scored: 0, sessionStartedAt: detail?.live_session_started_at || null };
  }
  const where = scoredWhere(detail);
  const [scored, successes] = await Promise.all([
    db.Order.count({ where }),
    db.Order.count({ where: { ...where, status: 'success', disconnect_failed: false } }),
  ]);
  return {
    rate: computeRate(successes, scored),
    successes,
    scored,
    sessionStartedAt: detail.live_session_started_at,
  };
}

/** Routing gate. `true` means "do not send new orders here". */
async function isBelowThreshold(detail) {
  const { rate, successes, scored } = await sessionScore(detail);
  if (rate === null) return false;  // nothing scored yet — must be allowed to start
  if (rate >= MIN_SUCCESS_RATE) return false;
  logger.info(`routing: account ${detail.upi_id} below success threshold (${rate}% from ${successes}/${scored} this session) — skipping`);
  return true;
}

/**
 * Start a fresh session. Called when an account enters the live pool, which is
 * the trader's own toggle-on — a new session wipes the previous score, and is
 * the only way an account that fell below the threshold gets going again.
 */
async function startSession(detailId) {
  // High-water mark taken at the moment the session begins. Everything already
  // in the table belongs to a previous session and is excluded from here on.
  const maxId = (await db.Order.max('id')) || 0;
  await db.PaymentDetail.update(
    { live_session_started_at: new Date(), live_session_start_order_id: maxId },
    { where: { id: detailId } }
  );
  logger.info(`score: payment_detail ${detailId} entered the live pool — session score reset (from order id > ${maxId})`);
}

/**
 * Mark every still-open order on an account as a disconnect failure. Called
 * when the connection is observed going alive -> dead. Orders that already
 * reached a terminal state are untouched: they were resolved before the
 * outage, so the outage is not theirs.
 */
async function markOpenOrdersFailed(detailId) {
  const [count] = await db.Order.update(
    { disconnect_failed: true },
    {
      where: {
        payment_detail_id: detailId,
        disconnect_failed: false,
        status: { [Op.in]: ['pending', 'checkout_open', 'claimed_paid', 'under_review'] },
      },
    }
  );
  if (count) logger.warn(`score: payment_detail ${detailId} disconnected with ${count} open order(s) — scored as failures`);
  return count;
}

module.exports = {
  MIN_SUCCESS_RATE,
  computeRate,
  sessionScore,
  isBelowThreshold,
  startSession,
  markOpenOrdersFailed,
  scoredWhere,
};
