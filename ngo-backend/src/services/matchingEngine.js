const axios = require('axios');
const { internalAuthHeaders } = require('../middleware/internalAuth');
const Webhook = require('../models/Webhook');
const Transaction = require('../models/Transaction');
const NGO = require('../models/NGO');
const Device = require('../models/Device');
const ledgerService = require('./ledgerService');
const { detectRealPayment } = require('./paymentDetector');
const { isWithinMinutes } = require('../utils/timeHelper');
const {
  WEBHOOK_STATUS,
  WEBHOOK_EXPIRY_MINUTES,
} = require('../config/constants');

/**
 * Matching engine: pairs donor intents (Webhook) with real money movement
 * (RawEvent / Transaction) by amount + time window, then commits verified
 * donations to the hash-chained ledger.
 */

const MATCH_WINDOW_MINUTES = 10; // transaction must land within 10 min

function normalizeAmount(amount) {
  return parseFloat(String(amount || '').replace(/,/g, '').trim());
}

function emit(io, ngoId, event, payload) {
  if (io && ngoId) {
    io.to(String(ngoId)).emit(event, payload);
  }
}

/**
 * Notifies the P2P backend that a donation it's waiting on has been verified,
 * so it can auto-close the matching order. Only fires when the webhook (donor
 * intent) carries an `orderId` — i.e. it originated from the P2P checkout
 * flow via POST /api/checkout/verify, not a standalone NGO donation.
 * Best-effort: failures are logged, never thrown (must not block matching).
 */
async function notifyP2PBackend(webhook, txn) {
  if (!webhook.orderId) return;
  try {
    await axios.post(
      (process.env.P2P_BACKEND_URL || 'http://localhost:4000') +
        '/api/orders/verify-payment',
      {
        orderId: webhook.orderId,
        utr: txn.utr || '',
        amount: webhook.amount,
        payerName: webhook.donorName || 'Unknown',
        payerUPI: txn.payerUpiId || '',
        verified: true,
        verifiedAt: new Date().toISOString(),
      },
      // That endpoint settles an order, so it is no longer unauthenticated.
      // Sent here even though this call is currently unreachable (nothing
      // populates webhook.orderId any more), so reviving the path does not
      // also require remembering to add auth to it.
      { timeout: 5000, headers: internalAuthHeaders() }
    );
    console.log('P2P order closed:', webhook.orderId);
  } catch (e) {
    console.log('P2P callback failed:', e.message);
  }
}

/**
 * Core reconciliation triggered when a PAYMENT raw event arrives.
 *
 *  1. Look for a pending, non-expired webhook for the same NGO whose amount
 *     matches the event and that was created within the last 2 hours.
 *  2. If found, look for a scraped transaction with the same amount + NGO
 *     within 10 minutes. If found, commit a verified ledger entry, mark the
 *     webhook matched, and emit `newDonation`.
 *  3. If no webhook is found, record a direct (anonymous) donation.
 *
 * @param {Object} rawEvent a saved RawEvent (must carry ngoId + amount)
 * @param {import('socket.io').Server} [io] optional socket server for emits
 * @returns {Promise<Object|null>} the created ledger entry, or null
 */
async function checkMatch(rawEvent, io) {
  if (!rawEvent || !rawEvent.ngoId) {
    return null;
  }

  const target = normalizeAmount(rawEvent.amount);
  if (Number.isNaN(target)) {
    return null;
  }

  const eventTime = rawEvent.createdAt || new Date();
  const twoHoursAgo = new Date(Date.now() - WEBHOOK_EXPIRY_MINUTES * 60 * 1000);

  // 1. Pending webhooks for this NGO in the last 2 hours, amount-matched.
  const pending = await Webhook.find({
    ngoId: rawEvent.ngoId,
    status: WEBHOOK_STATUS.PENDING,
    createdAt: { $gte: twoHoursAgo },
  }).sort({ createdAt: -1 });

  const webhook = pending.find((w) => normalizeAmount(w.amount) === target);

  if (webhook) {
    // 2. Find a matching transaction within 10 minutes of the event.
    const candidates = await Transaction.find({ ngoId: rawEvent.ngoId }).sort({
      scrapedAt: -1,
    });
    const txn = candidates.find(
      (t) =>
        normalizeAmount(t.amount) === target &&
        isWithinMinutes(eventTime, t.scrapedAt, MATCH_WINDOW_MINUTES)
    );

    if (txn) {
      const ngo = await NGO.findById(rawEvent.ngoId).select('name').lean();
      const entry = await ledgerService.createEntry({
        ngoId: rawEvent.ngoId,
        ngoName: ngo ? ngo.name : '',
        donorName: webhook.donorName || 'Unknown',
        donorEmail: webhook.donorEmail || '',
        amount: webhook.amount,
        purpose: webhook.purpose || '',
        utr: txn.utr,
        upiId: txn.payerUpiId,
        txnId: txn.txnId,
        platform: txn.platform,
        verifiedAt: new Date(),
        webhookId: webhook._id,
        transactionId: txn._id,
      });

      webhook.status = WEBHOOK_STATUS.MATCHED;
      await webhook.save();

      emit(io, rawEvent.ngoId, 'newDonation', entry);
      await notifyP2PBackend(webhook, txn);
      return entry;
    }

    // Webhook matched on amount but no confirming transaction yet.
    return null;
  }

  // 3. No donor intent — record as a direct/anonymous donation.
  const ngo = await NGO.findById(rawEvent.ngoId).select('name').lean();
  const entry = await ledgerService.createEntry({
    ngoId: rawEvent.ngoId,
    ngoName: ngo ? ngo.name : '',
    donorName: 'Unknown',
    amount: rawEvent.amount,
    purpose: 'Direct donation',
    utr: '',
    upiId: '',
    platform: rawEvent.sender || '',
    verifiedAt: new Date(),
    rawEventId: rawEvent._id,
  });

  emit(io, rawEvent.ngoId, 'newDonation', entry);
  return entry;
}

/**
 * Attempts to match a single webhook against recent scraped transactions.
 * Used for the immediate-match attempt when a webhook is first received.
 * @param {Object} webhook a Webhook document
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<Object|null>} ledger entry if matched, else null
 */
async function matchWebhook(webhook, io) {
  if (!webhook || webhook.status !== WEBHOOK_STATUS.PENDING) {
    return null;
  }

  const target = normalizeAmount(webhook.amount);
  if (Number.isNaN(target)) {
    return null;
  }

  const candidates = await Transaction.find({ ngoId: webhook.ngoId }).sort({
    scrapedAt: -1,
  });

  const txn = candidates.find(
    (t) =>
      normalizeAmount(t.amount) === target &&
      isWithinMinutes(webhook.createdAt, t.scrapedAt, WEBHOOK_EXPIRY_MINUTES)
  );

  if (!txn) {
    return null;
  }

  const ngo = await NGO.findById(webhook.ngoId).select('name').lean();
  const entry = await ledgerService.createEntry({
    ngoId: webhook.ngoId,
    ngoName: ngo ? ngo.name : '',
    donorName: webhook.donorName || 'Unknown',
    donorEmail: webhook.donorEmail || '',
    amount: webhook.amount,
    purpose: webhook.purpose || '',
    utr: txn.utr,
    upiId: txn.payerUpiId,
    txnId: txn.txnId,
    platform: txn.platform,
    verifiedAt: new Date(),
    webhookId: webhook._id,
    transactionId: txn._id,
  });

  webhook.status = WEBHOOK_STATUS.MATCHED;
  await webhook.save();

  emit(io, webhook.ngoId, 'newDonation', entry);
  await notifyP2PBackend(webhook, txn);
  return entry;
}

/**
 * Sweeps all pending webhooks: expires stale ones, matches the rest.
 * Intended to be driven by node-cron.
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<{matched: number, expired: number}>}
 */
async function runMatching(io) {
  const now = new Date();
  let matched = 0;
  let expired = 0;

  const pending = await Webhook.find({ status: WEBHOOK_STATUS.PENDING });
  for (const webhook of pending) {
    if (webhook.expiresAt && webhook.expiresAt <= now) {
      webhook.status = WEBHOOK_STATUS.EXPIRED;
      await webhook.save();
      expired += 1;
      continue;
    }
    const result = await matchWebhook(webhook, io);
    if (result) matched += 1;
  }

  return { matched, expired };
}

/**
 * Matching engine v2 — settles a P2P order directly from a receiver-side
 * payment event, independent of the donor-webhook flow above. Calls the
 * gateway backend's matching engine (backend/src/services/matchingEngineV2.js)
 * via POST /api/internal/match-settlement, since Order/PaymentDetail (and the
 * amount-lock constraint that makes the lookup safe-by-construction) only
 * exist in that service's MySQL database. Best-effort: a down/unreachable
 * gateway backend must not throw back into the APK/scraper ingestion path —
 * failures are logged and the event is otherwise fully persisted already.
 */
async function callMatchSettlement(payload) {
  try {
    const base = process.env.P2P_BACKEND_URL || 'http://localhost:4000';
    const res = await axios.post(`${base}/api/internal/match-settlement`, payload, {
      timeout: 5000,
      headers: internalAuthHeaders(),
    });
    const d = res.data || {};
    // The single line that says whether a real payment closed a real order.
    // `upis_checked` comes back from the gateway, so the UPI list is visible
    // here even though it is now resolved on that side from trader_id.
    const upis = (d.upis_checked || payload.upi_ids || []).join(',');
    console.log(
      d.matched
        ? `match: SETTLED order ${d.order_id} (tier ${d.tier}, source ${payload.source})`
        : `match: NOT settled — reason=${d.reason || 'unknown'} amount=${payload.amount} upis=${upis || '(none resolved)'} source=${payload.source}`
    );
    return d;
  } catch (e) {
    console.error(`match: FAILED to reach the gateway matcher — ${e.message} (amount=${payload.amount} source=${payload.source})`);
    return null;
  }
}

/**
 * Triggered from POST /api/apk/event for a PAYMENT-category RawEvent. A
 * Device is only tied to one trader, not to one specific Account/UPI (a
 * trader can run several UPI accounts on the same phone/app), so this sends
 * the trader id and lets the gateway expand it to that trader's real UPI list
 * and disambiguate by timing if more than one order is amount-eligible.
 *
 * Keyed on rawEvent.traderId (RawEvent.js), not ngoId — devices/accounts are
 * genuinely trader-owned now (confirmed clean, no orphaned rows without a
 * traderId), and ngoId was the old shared-org grouping that let one
 * account's payment settle a DIFFERENT trader's order sharing the same NGO.
 */
async function triggerOrderSettlementFromRawEvent(rawEvent) {
  // Every exit below logs. This function used to return silently at three
  // separate guards, so a real payment that failed to auto-match left no trace
  // anywhere and could only be diagnosed by cross-referencing database
  // timestamps by hand.
  const tag = `match[raw ${rawEvent?._id || '?'}]`;
  if (!rawEvent || rawEvent.traderId == null) {
    console.warn(`${tag}: SKIPPED — raw event has no traderId, cannot resolve any UPI to match against`);
    return null;
  }

  // A re-delivery of a capture we have already seen (scraperEngine's
  // ingestRawEvent flags it and returns the original instead of storing a
  // second copy). Settlement is the step that actually moves money, so it gets
  // its own guard rather than trusting the caller to have stopped: without a
  // UTR the Tier 2 match is amount-only, so a re-posted notification would
  // settle whichever OTHER open order happens to share the amount.
  if (rawEvent.isDuplicate) {
    console.warn(`${tag}: SKIPPED — duplicate of an already-ingested capture, no second settlement attempted`);
    return null;
  }

  // The amount comes from the SAME classifier that creates the Transaction,
  // not from rawEvent.amount independently.
  //
  // rawEvent.amount is the phone's own extraction, and it is empty for the
  // most common notification format there is: NotificationService runs
  // SMSReceiver.AMOUNT_PATTERNS, whose regex matches "Rs"/"INR" but NOT the ₹
  // symbol, so every "Received ₹20 from …" arrived with amount "". Matching
  // then skipped the event as unusable while Transaction creation — which
  // re-parses server-side, where the ₹ IS matched — recorded the right amount.
  // The two disagreed on the same event, and only the losing one gated
  // settlement. Deriving both from detectRealPayment is what makes them
  // incapable of disagreeing; the app-side regex is fixed too, but a fix that
  // needs an APK rollout to reach a phone cannot be the one this depends on.
  //
  // Web Login captures are structured reads from the platform's own API and
  // deliberately bypass the text classifier (as they do in routes/apk.js), so
  // their amount is taken as given.
  const isWebLogin = String(rawEvent.source || '').startsWith('web_login');
  let target;

  if (isWebLogin) {
    target = normalizeAmount(rawEvent.amount);
  } else {
    const verdict = detectRealPayment({
      type: rawEvent.type,
      sender: rawEvent.sender,
      body: rawEvent.body,
      amount: rawEvent.amount,
    });
    // Noise the classifier rejects must not settle an order either. This used
    // to be gated only on the presence of an amount, so a promotional message
    // that happened to carry one could reach the matcher.
    if (!verdict.isRealPayment) {
      console.warn(`${tag}: SKIPPED — not a real payment (${verdict.reason})`);
      return null;
    }
    target = normalizeAmount(verdict.amount);
  }

  if (Number.isNaN(target) || target <= 0) {
    console.warn(`${tag}: SKIPPED — unusable amount ${JSON.stringify(rawEvent.amount)} (device) / ${JSON.stringify(target)} (parsed)`);
    return null;
  }

  // Send BOTH the device id and the trader id. The gateway scopes matching to
  // the specific UPI(s) this device collects on FIRST, and only falls back to
  // the trader's wider set under the conditions described there — so a payment
  // that landed on the device's UPI A can no longer settle a same-amount order
  // sitting on the trader's UPI B. payment_details lives in the gateway's
  // MySQL, which is the only place that can resolve either id to real UPIs
  // (BUG-30).
  //
  // The id sent is this device's MONGO _id, not the android deviceId the
  // RawEvent carries: payment_details.ngo_device_id stores Device._id (see
  // backend/src/jobs/connectionLiveness.js, which has always joined on it).
  // Sending the android id meant the gateway's device lookup matched nothing
  // at all, so scoping silently never happened and every capture fell through
  // to trader-wide matching — BUG-41, which closed three real orders on the
  // wrong accounts.
  const device = await Device.findOne({ deviceId: rawEvent.deviceId }).select('_id').lean();
  if (!device) {
    console.warn(`${tag}: device ${rawEvent.deviceId || '(none)'} has no Device document — matching will fall back to trader scope`);
  }

  console.log(`${tag}: attempting — device=${rawEvent.deviceId || '(none)'} (_id=${device ? device._id : 'none'}) trader=${rawEvent.traderId} amount=${target} utr=${rawEvent.utr || '(none)'}`);
  return callMatchSettlement({
    device_id: device ? String(device._id) : null,
    trader_id: rawEvent.traderId,
    amount: target,
    utr: rawEvent.utr || '',
    event_time: rawEvent.createdAt || rawEvent.utcTimestamp || new Date().toISOString(),
    source: 'apk_notification',
  });
}

/**
 * Triggered right after the web scraper persists a new Transaction. The
 * Transaction is already tied to one specific Account, so there's no
 * multi-UPI ambiguity here — only the usual same-amount timing case.
 */
async function triggerOrderSettlementFromTransaction(txn, account) {
  if (!txn) return null;
  const upiId = account?.upiId;
  if (!upiId) return null;

  const target = normalizeAmount(txn.amount);
  if (Number.isNaN(target) || target <= 0) return null;

  return callMatchSettlement({
    upi_ids: [upiId],
    amount: target,
    utr: txn.utr || '',
    event_time: txn.txnTime || txn.scrapedAt || new Date().toISOString(),
    payer_name: txn.payerName || '',
    payer_upi: txn.payerUpiId || '',
    source: 'scraper',
  });
}

module.exports = {
  checkMatch,
  matchWebhook,
  runMatching,
  normalizeAmount,
  triggerOrderSettlementFromRawEvent,
  triggerOrderSettlementFromTransaction,
};
