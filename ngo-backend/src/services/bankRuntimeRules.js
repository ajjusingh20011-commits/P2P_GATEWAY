'use strict';

/**
 * Redesign Section 3 — the runtime rule store.
 *
 * Loads admin-PROMOTED unrecognized senders (Section 4 review queue) into the
 * matcher's runtime overlay (bankSenders.setRuntimeBankCodes), so a genuinely-
 * new bank starts resolving on ALL devices with NO app rebuild and NO server
 * redeploy — the whole point of the redesign's "no new APK to fix a bank".
 *
 * Because the phone now broad-forwards every DLT-shaped SMS (Section 1) and the
 * SERVER identifies the bank (Section 2), refreshing this server-side overlay is
 * all it takes for every device to benefit — the phone needs no bank rules of
 * its own.
 *
 * Refresh triggers:
 *   - startup (startRuntimeRulesRefresh, called when routes load), then periodic;
 *   - immediately after a promote/ignore decision (admin route calls refresh).
 * Best-effort: a load failure leaves the previous overlay in place and retries
 * on the interval — it never throws into a request path.
 */

const bankSenders = require('../utils/bankSenders');

const REFRESH_MS = 10 * 60 * 1000; // periodic reconcile; promote also refreshes on demand
let started = false;

/**
 * Read every promoted row and rebuild the overlay. A promoted row's logo is
 * inherited from its confirmedCode when that maps to a known bank, else null
 * (the UI falls back to initials). Returns the number of codes loaded, or -1 on
 * failure (previous overlay left intact).
 */
async function refreshRuntimeBankCodes() {
  try {
    const UnrecognizedSender = require('../models/UnrecognizedSender');
    const rows = await UnrecognizedSender.find({ status: 'promoted' }).lean();
    const map = {};
    for (const r of rows) {
      const code = String(r.code || '').toUpperCase();
      if (!code) continue;
      const canon = bankSenders.BANK_BY_SENDER_CODE[String(r.confirmedCode || '').toUpperCase()];
      map[code] = {
        name: r.confirmedName || (canon && canon.name) || 'Bank',
        logo: (canon && canon.logo) || null,
      };
    }
    bankSenders.setRuntimeBankCodes(map);
    // eslint-disable-next-line no-console
    console.log(`bankRuntimeRules: loaded ${Object.keys(map).length} promoted bank code(s) into the runtime overlay`);
    return Object.keys(map).length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`bankRuntimeRules: refresh failed — ${e.message}`);
    return -1;
  }
}

/** Start the initial load + periodic reconcile. Idempotent. */
function startRuntimeRulesRefresh() {
  if (started) return;
  started = true;
  // Short delay so the Mongo connection is up; failures retry on the interval.
  setTimeout(() => { refreshRuntimeBankCodes(); }, 3000);
  const timer = setInterval(() => { refreshRuntimeBankCodes(); }, REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { refreshRuntimeBankCodes, startRuntimeRulesRefresh };
