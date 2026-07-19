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
 * Persists a raw device event (SMS/notification/screen) for later matching.
 * @param {Object} payload
 * @returns {Promise<Object>} the created RawEvent
 */
async function ingestRawEvent(payload) {
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
  persistTransactions,
  startSession,
  stopSession,
  isSessionActive,
};
