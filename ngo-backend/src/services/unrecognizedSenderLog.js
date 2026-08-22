'use strict';

/**
 * Redesign Section 4 — capture pipeline for the Unrecognized/Unmatched queue.
 *
 * A DLT-shaped bank SMS that reaches the server but whose header the tiered
 * matcher can't place is recorded (deduped by entity code) instead of being
 * lost, so the bank list can grow from REAL traffic. Best-effort: recording
 * must never affect capture/settlement — callers wrap it in try/catch and it
 * also self-guards.
 *
 * The classification half (classifyForQueue) is pure — no DB, no Android — so
 * it is unit-tested directly.
 */

const { identifyBankFromSender, extractBankSignoff } = require('../utils/bankSenders');

// A genuine UPI/IMPS reference is exactly 12 digits (Section 7 red-flag input).
const VALID_UTR = /^\d{12}$/;

// Money-verb + amount shape, mirroring the phone's broad pre-filter — so we only
// queue things that actually look like payment alerts, not every stray SMS.
const AMOUNT = /(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/i;
const TXN_LANGUAGE = /\b(?:credited|debited|credit|debit|received|sent|paid|deposited)\b/i;

/**
 * Isolate the DLT entity token from a sender: the longest alphanumeric segment
 * (the 2-char operator prefix and 1-char category suffix are shorter). Mirrors
 * bankSenders.headerTokens' intent without importing it, kept local so this
 * module never re-touches that file.
 */
function entityCode(sender) {
  const segs = String(sender || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!segs.length) return '';
  return segs.reduce((best, s) => (s.length > best.length ? s : best), '');
}

/**
 * Decide whether an inbound event belongs in the review queue, and extract its
 * review fields. PURE.
 * @returns {{ shouldLog:boolean, code:string, signoffName:string, hasValidUtr:boolean }}
 */
function classifyForQueue({ type, sender, body, utr } = {}) {
  const no = { shouldLog: false, code: '', signoffName: '', hasValidUtr: false };
  if (String(type || '').toUpperCase() !== 'SMS') return no; // notifications identify by app, not DLT header
  if (!sender) return no;
  // Already identified by the tiered matcher (any tier) → not "unrecognized".
  if (identifyBankFromSender(sender)) return no;
  const code = entityCode(sender);
  if (!code || code.length < 4) return no; // not a real entity code (operator/suffix noise)
  const text = String(body || '');
  // Only queue things shaped like a payment alert (amount + money verb).
  if (!(AMOUNT.test(text) && TXN_LANGUAGE.test(text))) return no;
  return {
    shouldLog: true,
    code,
    signoffName: extractBankSignoff(text),
    hasValidUtr: VALID_UTR.test(String(utr || '').trim()),
  };
}

/**
 * Record (best-effort) an inbound event into the queue if it qualifies. Deduped
 * by entity code: increments occurrences, refreshes the sample/sign-off/UTR, and
 * tracks distinct devices. Never throws to the caller.
 * @returns {Promise<boolean>} true if a row was written/updated.
 */
async function recordFromEvent(evt = {}) {
  try {
    const c = classifyForQueue(evt);
    if (!c.shouldLog) return false;
    // Lazy-require the model so the pure classifier can be unit-tested without Mongo.
    const UnrecognizedSender = require('../models/UnrecognizedSender');
    const now = new Date();
    const set = {
      lastSender: String(evt.sender || ''),
      sampleBody: String(evt.body || '').slice(0, 1000),
      lastAmount: String(evt.amount || ''),
      lastUtr: String(evt.utr || ''),
      lastSeenAt: now,
    };
    if (c.signoffName) set.signoffName = c.signoffName;
    const update = {
      $setOnInsert: { code: c.code, firstSeenAt: now, status: 'pending' },
      $set: set,
      $inc: { occurrences: 1 },
    };
    if (c.hasValidUtr) update.$set.hasValidUtr = true;
    if (evt.traderId != null && evt.traderId !== '') update.$set.lastTraderId = Number(evt.traderId);
    const addToSet = {};
    if (evt.deviceId) addToSet.deviceIds = String(evt.deviceId);
    if (evt.traderId != null && evt.traderId !== '') addToSet.traderIds = Number(evt.traderId);
    if (Object.keys(addToSet).length) update.$addToSet = addToSet;
    await UnrecognizedSender.updateOne({ code: c.code }, update, { upsert: true });
    return true;
  } catch (e) {
    // Best-effort — a review-log failure must never disturb capture/settlement.
    // eslint-disable-next-line no-console
    console.warn(`unrecognizedSenderLog: could not record — ${e.message}`);
    return false;
  }
}

module.exports = { classifyForQueue, entityCode, recordFromEvent };
