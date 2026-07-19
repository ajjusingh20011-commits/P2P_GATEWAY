const Webhook = require('../models/Webhook');
const Transaction = require('../models/Transaction');
const NGO = require('../models/NGO');
const ledgerService = require('./ledgerService');
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

module.exports = { checkMatch, matchWebhook, runMatching, normalizeAmount };
