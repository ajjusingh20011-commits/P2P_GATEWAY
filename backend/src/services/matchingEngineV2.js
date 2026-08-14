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

/**
 * Every UPI belonging to a trader, straight from the gateway's own
 * payment_details — the authoritative list.
 *
 * ngo-backend used to resolve this itself from its Mongo `Account` collection,
 * which holds Web Login accounts only. An APK-linked UPI has no Account
 * document at all, so a payment that landed on one was matched against the
 * wrong UPI set (or, for a pure-APK trader, an empty one) and could never
 * settle. See BUG-30. Resolving here removes the cross-database guess: this
 * service owns payment_details, so it is the only place that can answer
 * "which UPIs does trader X actually collect on?" correctly.
 *
 * Deliberately NOT filtered on is_active_detail: an order is routed while the
 * account is switched on, but the trader may switch it off before the payment
 * notification lands. The money still arrived and the order is still open —
 * filtering here would strand it. Settlement is already constrained by the
 * order's own status + amount.
 */
async function upiIdsForTrader(traderId) {
  const details = await db.PaymentDetail.findAll({
    where: { trader_id: traderId },
    attributes: ['upi_id'],
  });
  return details.map((d) => d.upi_id).filter(Boolean);
}

/**
 * The UPI(s) a specific device actually collects on — payment_details linked
 * to it via `ngo_device_id`. This is the scope that stops a payment landing on
 * the device's UPI A from settling a same-amount order sitting on the trader's
 * *other* UPI B.
 *
 * IMPORTANT — which id this is. `ngo_device_id` holds ngo-backend's Mongo
 * `Device._id`, NOT the android device id that a RawEvent carries. They are
 * different identifier spaces: "6a7da28e9bbebda2eb93b3a6" against
 * "b50bf3ebb8ea1a69". connectionLiveness.js documents the mapping
 * (payment_details.ngo_device_id -> Device._id) and has always joined on it
 * correctly; this function was written against the android id, so it matched
 * zero rows for every capture and device scoping silently never happened —
 * every APK payment fell through to the trader-wide list and settled whichever
 * same-amount order was closest in time, on any of that trader's accounts.
 * BUG-41, confirmed on live data: three orders across two accounts all settled
 * from one unrelated device. ngo-backend now sends the Mongo _id.
 *
 * `ngo_device_id` is nullable and has no unique index, so this can legitimately
 * return several UPIs (one device backing several accounts — returned together,
 * and pickClosestByTime disambiguates within them) or none (that device is not
 * linked to any account; see the caller for what happens then).
 */
async function upiIdsForDevice(deviceId) {
  const details = await db.PaymentDetail.findAll({
    where: { ngo_device_id: deviceId },
    attributes: ['upi_id'],
  });
  return details.map((d) => d.upi_id).filter(Boolean);
}

/** Whether this trader links any account to a device at all. */
async function traderUsesDeviceLinking(traderId) {
  const linked = await db.PaymentDetail.count({
    where: { trader_id: traderId, ngo_device_id: { [Op.ne]: null } },
  });
  return linked > 0;
}

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
 * @param {string[]|string} [event.upiIds] - the account's own upi_id, when the
 *   source knows exactly which account received the money (scraper). Omitted
 *   by the APK path, which only knows the device's trader.
 * @param {number|string} [event.traderId] - resolved to that trader's full UPI
 *   list here (see upiIdsForTrader). Used when upiIds isn't supplied; a Device
 *   is tied to a trader, not to one account, so the APK path genuinely cannot
 *   name the receiving UPI and lets pickClosestByTime disambiguate instead.
 * @param {number|string} event.amount
 * @param {string} [event.utr] - receiver-side UTR, if the source has one.
 * @param {string|Date} [event.eventTimestamp]
 * @param {string} [event.payerName]
 * @param {string} [event.payerUpi]
 * @param {string} event.source - 'apk_notification' | 'scraper' | etc, used
 *   as smartMerge's `engine` tag and the discrepancy log's `source`.
 * @returns {Promise<{matched: boolean, reason?: string, tier?: number, order_id?: number}>}
 */
async function matchAndSettle({ upiIds, deviceId, traderId, amount, utr, eventTimestamp, payerName, payerUpi, source }) {
  let normalizedUpiIds = (Array.isArray(upiIds) ? upiIds : [upiIds]).filter(Boolean);
  const normalizedAmount = Number(amount);
  const normalizedTraderId = Number(traderId);
  const normalizedDeviceId = deviceId != null ? String(deviceId).trim() : '';

  // Resolve the UPI set to match against, most-precise source first:
  //   1. explicit upiIds  — the scraper already knows the exact account.
  //   2. device-scoped     — the APK path names its device; use only the
  //                          UPI(s) that device collects on (the fix).
  //   3. trader-wide       — fallback when the device isn't named or isn't
  //                          linked to any UPI; never strand a real payment.
  if (!normalizedUpiIds.length) {
    if (normalizedDeviceId) {
      normalizedUpiIds = await upiIdsForDevice(normalizedDeviceId);
      if (normalizedUpiIds.length) {
        logger.info(`matchingEngineV2: device-scoped to ${normalizedUpiIds.length} upi(s) for device ${normalizedDeviceId} — ${normalizedUpiIds.join(',')} (source=${source || 'unknown'})`);
      }
    }

    if (!normalizedUpiIds.length && Number.isFinite(normalizedTraderId)) {
      // The trader-wide fallback is what closed the wrong customer's order in
      // BUG-41, so it is no longer unconditional. If this trader links their
      // accounts to devices at all, then a capture from a device that is
      // linked to none of them cannot be attributed to any particular account
      // — and settling it against whichever same-amount order happens to be
      // open is a guess with real money behind it. Refuse instead: the payment
      // still appears on the Notifications page for manual confirmation.
      //
      // Traders who link nothing keep the old behaviour, because for them the
      // fallback is the only path there has ever been and refusing would
      // strand every payment they take.
      if (normalizedDeviceId && await traderUsesDeviceLinking(normalizedTraderId)) {
        logger.warn(
          `matchingEngineV2: REFUSING to match — device ${normalizedDeviceId} is not linked to any of trader `
          + `${normalizedTraderId}'s accounts, and that trader does link devices. Settling trader-wide here is what `
          + `closed the wrong account's order in BUG-41 (source=${source || 'unknown'}, amount=${normalizedAmount})`
        );
        return { matched: false, reason: 'device_not_linked_to_any_account', upis_checked: [] };
      }

      normalizedUpiIds = await upiIdsForTrader(normalizedTraderId);
      if (!normalizedUpiIds.length) {
        logger.warn(`matchingEngineV2: trader ${normalizedTraderId} has no payment_details at all — nothing to match on (source=${source || 'unknown'})`);
        return { matched: false, reason: 'no_accounts_for_trader', upis_checked: [] };
      }
      logger.info(`matchingEngineV2: ${normalizedDeviceId ? `device ${normalizedDeviceId} has no linked UPI — ` : ''}trader-wide fallback resolved ${normalizedUpiIds.length} upi(s) for trader ${normalizedTraderId} — ${normalizedUpiIds.join(',')}`);
    }
  }

  if (!normalizedUpiIds.length || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    logger.warn(`matchingEngineV2: invalid event (upiIds=${JSON.stringify(upiIds)}, traderId=${JSON.stringify(traderId)}, amount=${amount}) — treating as orphan`);
    return { matched: false, reason: 'invalid_input', upis_checked: normalizedUpiIds };
  }

  const candidates = await findCandidateOrders(normalizedUpiIds, normalizedAmount);

  if (!candidates.length) {
    // Expected/normal — an unrelated personal payment, or the order this
    // belonged to already expired. Not an error.
    logger.info(`matchingEngineV2: orphan event — no open order for upi(s)=${normalizedUpiIds.join(',')} amount=${normalizedAmount} source=${source || 'unknown'}`);
    return { matched: false, reason: 'orphan', upis_checked: normalizedUpiIds };
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

module.exports = { matchAndSettle, findCandidateOrders, pickClosestByTime, upiIdsForTrader, upiIdsForDevice, MATCH_TIER };
