'use strict';

/**
 * Matching engine v2 — settles an order from a receiver-side payment event
 * (an APK SMS/notification relayed through ngo-backend's /api/apk/event, or
 * a scraped bank/UPI transaction from ngo-backend's web scraper), reached
 * via POST /api/internal/match-settlement (routes/internalRoutes.js).
 *
 * This is deliberately independent of the older Mongo-side donor-webhook
 * matching in ngo-backend's matchingEngine.js (checkMatch/matchWebhook),
 * which still runs unchanged for the NGO's own donation ledger. That flow
 * requires a donor to have already clicked "I've paid" (creating a Webhook)
 * AND a scraped Transaction to show up before it will settle an order —
 * so a payment reported only via APK notification (no scraper running)
 * never reached settlement. v2 treats each receiver-side event as
 * sufficient on its own: find the order by {upi_id(s), amount}, no
 * donor-webhook prerequisite.
 *
 * Tiers (all three settle immediately via smartMerge.confirmOrder — they
 * differ only in trust/audit trail, never in whether settlement happens):
 *   0 — receiver-side UTR exactly matches order.donor_submitted_utr
 *   1 — receiver-side UTR present but missing/mismatched vs donor's
 *       (still settles; a utr_discrepancy_logs row is written for review)
 *   2 — no receiver-side UTR at all (notification-only sources); amount +
 *       trader + time-window match only
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const smartMerge = require('./smartMerge');

const MATCH_TIER = { EXACT_UTR: 0, UTR_MISMATCH: 1, AMOUNT_ONLY: 2 };

/** Find every open order for any of the given UPI ids at this exact amount. */
async function findCandidateOrders(upiIds, amount) {
  return db.Order.findAll({
    where: { status: { [Op.in]: db.Order.ACTIVE_STATUSES }, amount_inr: amount },
    include: [{
      model: db.PaymentDetail,
      as: 'paymentDetail',
      required: true,
      where: { upi_id: { [Op.in]: upiIds } },
    }],
  });
}

/**
 * When more than one order could plausibly match (e.g. an old under_review
 * order for the same amount, plus a fresh one — or, for an APK-notification
 * event, orders sitting on different UPIs belonging to the same NGO), pick
 * whichever order's creation time is closest to the event's timestamp.
 * Never an arbitrary/first-found match.
 */
function pickClosestByTime(candidates, eventTimestamp) {
  if (candidates.length === 1) return candidates[0];
  const eventTime = eventTimestamp ? new Date(eventTimestamp).getTime() : Date.now();
  return candidates.reduce((closest, c) => {
    const closestDelta = Math.abs(new Date(closest.created_at).getTime() - eventTime);
    const cDelta = Math.abs(new Date(c.created_at).getTime() - eventTime);
    return cDelta < closestDelta ? c : closest;
  }, candidates[0]);
}

/**
 * @param {object} event
 * @param {string[]|string} event.upiIds - one UPI (scraper: the account's
 *   own upi_id) or several (APK notification: every UPI belonging to the
 *   NGO the device reported for, since a Device isn't tied to one Account).
 * @param {number|string} event.amount
 * @param {string} [event.utr] - receiver-side UTR, if the source has one.
 * @param {string|Date} [event.eventTimestamp]
 * @param {string} [event.payerName]
 * @param {string} [event.payerUpi]
 * @param {string} event.source - 'apk_notification' | 'scraper' | etc, used
 *   as smartMerge's `engine` tag and the discrepancy log's `source`.
 * @returns {Promise<{matched: boolean, reason?: string, tier?: number, order_id?: number}>}
 */
async function matchAndSettle({ upiIds, amount, utr, eventTimestamp, payerName, payerUpi, source }) {
  const normalizedUpiIds = (Array.isArray(upiIds) ? upiIds : [upiIds]).filter(Boolean);
  const normalizedAmount = Number(amount);

  if (!normalizedUpiIds.length || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    logger.warn(`matchingEngineV2: invalid event (upiIds=${JSON.stringify(upiIds)}, amount=${amount}) — treating as orphan`);
    return { matched: false, reason: 'invalid_input' };
  }

  const candidates = await findCandidateOrders(normalizedUpiIds, normalizedAmount);

  if (!candidates.length) {
    // Expected/normal — an unrelated personal payment, or the order this
    // belonged to already expired. Not an error.
    logger.info(`matchingEngineV2: orphan event — no open order for upi(s)=${normalizedUpiIds.join(',')} amount=${normalizedAmount} source=${source || 'unknown'}`);
    return { matched: false, reason: 'orphan' };
  }

  const order = pickClosestByTime(candidates, eventTimestamp);

  if (order.status === 'success') {
    // Already settled (e.g. a duplicate/retried delivery of the same
    // event) — confirmOrder is idempotent, but skip the tier/discrepancy
    // bookkeeping since there's nothing new to record.
    return { matched: true, tier: order.match_tier, order_id: order.id, alreadySettled: true };
  }

  const cleanUtr = utr ? String(utr).trim() : '';

  // UTR reuse guard — app-level pre-check for a clean, immediate rejection.
  // The settled_utr_lock_key generated-column unique index (see migration
  // 20260729000002) is the DB-level backstop if this races.
  if (cleanUtr) {
    const alreadySettled = await db.Order.findOne({ where: { status: 'success', utr_number: cleanUtr } });
    if (alreadySettled && alreadySettled.id !== order.id) {
      logger.warn(`matchingEngineV2: UTR ${cleanUtr} already settled order ${alreadySettled.id} — rejecting reuse for order ${order.id}`);
      return { matched: false, reason: 'duplicate_utr', order_id: order.id, conflicting_order_id: alreadySettled.id };
    }
  }

  let tier;
  const donorUtr = order.donor_submitted_utr ? String(order.donor_submitted_utr).trim() : '';

  if (cleanUtr && donorUtr && cleanUtr === donorUtr) {
    tier = MATCH_TIER.EXACT_UTR;
  } else if (cleanUtr) {
    tier = MATCH_TIER.UTR_MISMATCH;
    await db.UtrDiscrepancyLog.create({
      order_id: order.id,
      expected_utr: donorUtr || null,
      actual_utr: cleanUtr,
      source: source || null,
    });
    logger.warn(`matchingEngineV2: order ${order.id} settling on Tier 1 (UTR mismatch) — expected="${donorUtr || '(none)'}" actual="${cleanUtr}"`);
  } else {
    tier = MATCH_TIER.AMOUNT_ONLY;
  }

  await order.update({
    match_tier: tier,
    payer_name: payerName || order.payer_name,
    payer_upi: payerUpi || order.payer_upi,
    auto_verified: true,
  });

  await smartMerge.confirmOrder(order, {
    utrNumber: cleanUtr || undefined,
    engine: source,
    senderName: payerName || undefined,
  });

  logger.info(`matchingEngineV2: order ${order.id} settled via Tier ${tier} (source=${source || 'unknown'})`);
  return { matched: true, tier, order_id: order.id };
}

module.exports = { matchAndSettle, findCandidateOrders, pickClosestByTime, MATCH_TIER };
