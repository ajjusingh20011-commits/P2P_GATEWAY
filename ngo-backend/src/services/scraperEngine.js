const puppeteer = require('puppeteer');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const RawEvent = require('../models/RawEvent');
const proxyManager = require('./proxyManager');
const ngoService = require('./ngoService');
const { ACCOUNT_STATUS, TRANSACTION_STATUS } = require('../config/constants');

/**
 * Puppeteer-based scraping engine. In production each platform (Paytm, PhonePe,
 * …) has its own login + transaction-list extraction flow; here we provide the
 * orchestration skeleton: launch a proxied browser, log in with the account's
 * decrypted credentials, and persist any newly-seen transactions.
 *
 * The per-platform DOM extraction is deliberately isolated in scrapePlatform()
 * so it can be filled in per platform without touching the orchestration.
 *
 * DEAD CODE (confirmed, 2026-07-22): scrapePlatform() never navigates
 * anywhere and always returns []. scrapeAccount/scrapeAllLiveAccounts/
 * startSession/stopSession/isSessionActive are unused — nothing in the
 * codebase calls them anymore. Real web-login scraping is implemented in
 * webScraper.js (Playwright-based PaytmScraper), driven by the
 * connect/verify-otp/status/sync routes in routes/ngo.js. Do not wire
 * startSession() back into any route without first replacing
 * scrapePlatform()'s stub with a real implementation — it currently marks
 * accounts LIVE having done nothing.
 *
 * ingestRawEvent() below is NOT dead — it's actively used by routes/apk.js.
 */

/**
 * Ingests raw scraped transaction rows into the Transaction collection,
 * de-duplicating on (accountId, utr/txnId).
 * @param {Object} account
 * @param {Array<Object>} rows
 * @returns {Promise<number>} number of new transactions stored
 */
async function persistTransactions(account, rows) {
  let stored = 0;
  for (const row of rows) {
    const dedupe = {
      accountId: account._id,
      $or: [
        { utr: row.utr || '__none__' },
        { txnId: row.txnId || '__none__' },
      ],
    };
    // eslint-disable-next-line no-await-in-loop
    const exists = row.utr || row.txnId ? await Transaction.findOne(dedupe) : null;
    if (exists) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await Transaction.create({
      ngoId: account.ngoId,
      accountId: account._id,
      platform: account.platform,
      amount: row.amount || '',
      payerName: row.payerName || '',
      payerUpiId: row.payerUpiId || '',
      utr: row.utr || '',
      txnId: row.txnId || '',
      bankName: row.bankName || '',
      paymentMode: row.paymentMode || '',
      status: row.status || TRANSACTION_STATUS.SUCCESS,
      scrapedAt: new Date(),
    });
    stored += 1;
  }
  return stored;
}

/**
 * Per-platform extraction hook. Returns an array of normalized transaction
 * rows. Replace the body with real DOM navigation per platform.
 * @param {import('puppeteer').Page} page
 * @param {Object} account decrypted account
 * @returns {Promise<Array<Object>>}
 */
// eslint-disable-next-line no-unused-vars
async function scrapePlatform(page, account) {
  // Placeholder for platform-specific navigation & DOM parsing.
  // Intentionally returns no rows until a real flow is wired in.
  return [];
}

/**
 * Scrapes a single account end-to-end.
 * @param {string} accountId
 * @returns {Promise<{stored: number}>}
 */
async function scrapeAccount(accountId) {
  const account = await ngoService.getAccountWithCredentials(accountId);
  if (!account) {
    const err = new Error('Account not found');
    err.statusCode = 404;
    throw err;
  }

  const proxyIp = proxyManager.assignProxy(String(account.ngoId));
  const { args } = proxyManager.getLaunchOptions(proxyIp);

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args });
    const page = await browser.newPage();
    await proxyManager.authenticatePage(page);

    const rows = await scrapePlatform(page, account);
    const stored = await persistTransactions(account, rows);

    await Account.findByIdAndUpdate(accountId, {
      status: ACCOUNT_STATUS.LIVE,
      lastSyncTime: new Date(),
    });

    return { stored };
  } catch (err) {
    await Account.findByIdAndUpdate(accountId, {
      status: ACCOUNT_STATUS.DISCONNECTED,
    });
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * How far back an identical capture counts as a re-delivery rather than a new
 * payment. Not unbounded: two genuinely separate payments can produce
 * byte-identical text when the app's format carries no time or reference
 * ("Received ₹87 from Verify Tester"), and suppressing the second of those
 * forever would silently cost a real settlement.
 *
 * The failure modes are not symmetric, which is why this errs long: a
 * suppressed real payment falls back to manual confirmation, whereas an
 * unsuppressed re-post can settle a DIFFERENT open order of the same amount
 * and move money against the wrong trade.
 */
const RAW_EVENT_DEDUPE_WINDOW_MINUTES = 24 * 60;
// Tighter window for the weaker fallback key (device+amount, no payer/time).
// Set to 20 to safely cover the observed re-post gap, which reaches ~16 min — a
// literal 15-min window would miss a 16-min re-post, defeating the fallback.
// Still short enough that a genuine second same-amount payment to the same
// device more than 20 min apart is NOT suppressed.
const CONTENT_FALLBACK_WINDOW_MINUTES = 20;

// GPay (and others) shift a payment's text between the notification title and
// body across re-posts, so exact sender/body no longer identifies the same
// payment (BUG-52). These pull the two signals that ARE stable across re-posts
// out of the combined title+body: the payer name and the embedded payment time
// ("at 5:49 pm"), so the dedupe recognises the same real payment regardless of
// how the app worded each post.
function extractPayerName(text) {
  const m = /(?:received\s+from|debited\s+by|credited\s+by|\bfrom|\bby)\s+([A-Za-z][A-Za-z.'\- ]{1,39}?)(?=\s*(?:\bon\b|\bat\b|\bvia\b|\bfor\b|₹|rs\.?|inr|upi|ref|utr|rrn|[.,;()]|\d|$))/i.exec(String(text || ''));
  return m ? m[1].trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function extractEmbeddedTime(text) {
  const s = String(text || '');
  let m = /\b(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(s);
  if (m) return `${parseInt(m[1], 10)}:${m[2]}${m[3].toLowerCase()}m`;
  m = /\bat\s+(\d{1,2}):(\d{2})\b/.exec(s); // 24-hour "on 12-08-26 at 21:48"
  if (m) return `${parseInt(m[1], 10)}:${m[2]}`;
  return '';
}

/**
 * Persists a raw device event (SMS/notification/screen) for later matching.
 *
 * De-duplicates on (deviceId, body, amount, utr) within the window above.
 * This used to be a bare RawEvent.create with no dedupe of any kind, which was
 * harmless only for as long as APK captures never actually matched anything.
 * They do now (see matchingEngineV2's trader_id resolution), and payment apps
 * re-post notifications: a Google Pay for Business summary notification whose
 * expanded text names one real payment was re-delivered 21 times in a week on
 * a live device. Each delivery reached the matcher as a fresh event, and with
 * no UTR in the text the Tier 2 (amount-only) path would happily settle a
 * second, unrelated order for the same amount.
 *
 * `utr` is part of the key deliberately, even though the reported case has
 * none: two real payments that happen to render identical text still carry
 * different bank references, so keying on it suppresses strictly less while
 * still catching every re-post (a re-post repeats the reference, or repeats
 * its absence).
 *
 * Web Login captures are exempt — they are structured reads from the
 * platform's own API rather than re-postable OS notifications, and their body
 * is not the payment's identity.
 *
 * @param {Object} payload
 * @returns {Promise<Object>} the created RawEvent, or the existing one it
 *   duplicates, flagged `isDuplicate` (in memory only — nothing is persisted
 *   to say so, and callers must treat a flagged event as already handled).
 */
async function ingestRawEvent(payload) {
  const isWebLogin = String(payload.source || '').startsWith('web_login');

  if (payload.deviceId && payload.body && !isWebLogin) {
    const since = new Date(Date.now() - RAW_EVENT_DEDUPE_WINDOW_MINUTES * 60 * 1000);
    const fallbackSince = new Date(Date.now() - CONTENT_FALLBACK_WINDOW_MINUTES * 60 * 1000);
    const amount = payload.amount || '';
    const text = `${payload.sender || ''} ${payload.body || ''}`;
    const payer = extractPayerName(text);
    const time = extractEmbeddedTime(text);

    // Same device + same amount in the window is the shared axis; the exact
    // wording is NOT, because GPay re-posts with the payment moved between title
    // and body (BUG-52: same ₹20 to "Chiranjit K B" ingested twice, 16 min
    // apart, once from the body, once from the title). So compare CONTENT —
    // payer + embedded time — and keep identical-text / a tight window as
    // fallbacks.
    const candidates = await RawEvent.find({
      deviceId: payload.deviceId,
      createdAt: { $gte: since },
      ...(amount ? { amount } : {}),
    }).sort({ createdAt: -1 }).limit(500);

    let dup = null;
    let reason = '';
    for (const c of candidates) {
      const cText = `${c.sender || ''} ${c.body || ''}`;
      // Primary: same payer AND same embedded payment time = the same real
      // payment, however the two posts happened to be worded.
      if (payer && time && extractPayerName(cText) === payer && extractEmbeddedTime(cText) === time) {
        dup = c; reason = `content match (payer="${payer}" time="${time}")`; break;
      }
      // Retained: a byte-identical re-post is still a duplicate.
      if ((c.sender || '') === (payload.sender || '') && c.body === payload.body && (c.utr || '') === (payload.utr || '')) {
        dup = c; reason = 'identical re-post'; break;
      }
    }
    // Fallback when payer/time couldn't be parsed: suppress a same-device,
    // same-amount (same-payer if we have one) repeat within the tight window.
    if (!dup && amount && (!payer || !time)) {
      for (const c of candidates) {
        if (c.createdAt < fallbackSince) continue;
        const cPayer = extractPayerName(`${c.sender || ''} ${c.body || ''}`);
        if (!payer || !cPayer || cPayer === payer) {
          dup = c; reason = `fallback (device+amount${payer ? '+payer' : ''}, <${CONTENT_FALLBACK_WINDOW_MINUTES}min)`; break;
        }
      }
    }

    if (dup) {
      // Logged, never silent: a suppressed capture is a real event the trader
      // saw on their phone. Support must be able to explain why it isn't on the
      // Notifications page — and confirm a genuine rapid repeat wasn't lost — so
      // the reason, the parsed content key, and the matched row are all printed.
      console.warn(
        `ingest: DUPLICATE suppressed [${reason}] — device=${payload.deviceId} amount=${amount || '(none)'} `
        + `payer="${payer || '(unparsed)'}" time="${time || '(unparsed)'}" utr=${payload.utr || '(none)'} `
        + `matches raw ${dup._id} from ${dup.createdAt.toISOString()} (re-posted notification, not a new payment)`
      );
      dup.isDuplicate = true;
      return dup;
    }
  }

  return RawEvent.create(payload);
}

/**
 * Scrapes every live account. Intended to be driven by node-cron.
 */
async function scrapeAllLiveAccounts() {
  const accounts = await Account.find({
    status: { $in: [ACCOUNT_STATUS.LIVE, ACCOUNT_STATUS.PAUSED] },
  }).select('_id');

  const results = [];
  for (const a of accounts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await scrapeAccount(a._id.toString());
      results.push({ accountId: a._id, ...r });
    } catch (err) {
      results.push({ accountId: a._id, error: err.message });
    }
  }
  return results;
}

// Tracks accounts with an active scraping session.
const activeSessions = new Set();

/**
 * Starts (or restarts) a scraping session for an account. Fires the scrape in
 * the background so callers (HTTP handlers) are not blocked; failures are
 * logged, not thrown.
 * @param {string} accountId
 * @returns {boolean} true if the session is now marked active
 */
function startSession(accountId) {
  const id = String(accountId);
  activeSessions.add(id);
  scrapeAccount(id).catch((err) => {
    console.error(`Scraper session for ${id} failed to start:`, err.message);
  });
  return true;
}

/**
 * Stops the scraping session for an account.
 * @param {string} accountId
 * @returns {boolean}
 */
function stopSession(accountId) {
  activeSessions.delete(String(accountId));
  return true;
}

/**
 * @param {string} accountId
 * @returns {boolean} whether a session is currently active
 */
function isSessionActive(accountId) {
  return activeSessions.has(String(accountId));
}

module.exports = {
  scrapeAccount,
  scrapeAllLiveAccounts,
  ingestRawEvent,
  RAW_EVENT_DEDUPE_WINDOW_MINUTES,
  persistTransactions,
  startSession,
  stopSession,
  isSessionActive,
};
