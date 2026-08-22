'use strict';

const { identifyBankFromSender, extractBankSignoff } = require('./bankSenders');

/**
 * Resolves which real payment app a captured transaction came from, and over
 * which channel we captured it.
 *
 * Why this is needed at all: Transaction.platform carries our own capture-
 * engine tag for APK rows ('apk-notification' / 'apk-sms'), not the app the
 * money actually arrived in. The trader panel rendered that tag verbatim, so a
 * real GPay payment showed up labelled "apk-notification" — internal plumbing
 * leaking into the one column meant to answer "which of my accounts was this?"
 *
 * The app IS already captured, just not anywhere obvious: NotificationService
 * builds RawEvent.sender as `<app name>: <notification title>`, so the part
 * before the first colon names the app. This reads that back rather than
 * adding a new field, which also means every row already in the database
 * resolves correctly — a new field would only ever fix rows captured after it
 * shipped.
 *
 * The junk-looking prefixes below ("merchant", "app", "business") are real
 * historical values, not typos. getAppName() in NotificationService only had
 * switch cases for four consumer apps and fell back to the last dot-segment of
 * the package name for everything else, so
 * `com.google.android.apps.nbu.paisa.merchant` (Google Pay for Business)
 * reported itself as "merchant". That fallback is fixed on the app side, but
 * captures already in the database still carry these, so they are mapped here.
 */

// key: matches the trader panel's ACCOUNT_TYPES so the badge/icon/colour
//      treatment is identical to a scraper-sourced row. null where we have no
//      brand badge for it (banks, wallets) — the label still renders.
// label: what the trader reads.
const APP_BY_SENDER_PREFIX = {
  // Consumer apps — getAppName() has always mapped these correctly.
  gpay: { key: 'gpay', label: 'GPay' },
  'google pay': { key: 'gpay', label: 'GPay' },
  paytm: { key: 'paytm', label: 'Paytm' },
  phonepe: { key: 'phonepe', label: 'PhonePe' },
  bharatpe: { key: 'bharat_pe', label: 'BharatPe' },

  // Business/merchant apps — proper names as of the app-side fix.
  'gpay business': { key: 'gpay', label: 'GPay Business' },
  'paytm business': { key: 'paytm', label: 'Paytm Business' },
  'phonepe business': { key: 'phonepe', label: 'PhonePe Business' },
  'bharatpe business': { key: 'bharat_pe', label: 'BharatPe Business' },

  // Package-fallback leftovers from before that fix.
  merchant: { key: 'gpay', label: 'GPay Business' },   // …nbu.paisa.merchant
  app: { key: 'bharat_pe', label: 'BharatPe Business' }, // com.bharatpe.app
  // com.paytm.business AND com.phonepe.app.business both truncate to this, so
  // it genuinely cannot be resolved to one brand. Named honestly rather than
  // guessed at — a wrong brand on a payment row is worse than a vague one.
  business: { key: null, label: 'Business app' },

  // Banks and wallets.
  'airtel payments bank': { key: 'airtel', label: 'Airtel Payments Bank' },
  airtelpeymentsbank: { key: 'airtel', label: 'Airtel Payments Bank' },
  'hdfc bank': { key: null, label: 'HDFC Bank' },
  hdfc: { key: null, label: 'HDFC Bank' },
  'icici bank': { key: null, label: 'ICICI Bank' },
  imobile: { key: null, label: 'ICICI Bank' },
  sbi: { key: null, label: 'SBI' },
  sbifreedomplus: { key: null, label: 'SBI' },
  'axis bank': { key: null, label: 'Axis Bank' },
  mobile: { key: null, label: 'Axis Bank' },          // com.axis.mobile
  cred: { key: null, label: 'CRED' },
  androidapp: { key: null, label: 'CRED' },           // com.dreamplug.androidapp
  mobikwik: { key: null, label: 'MobiKwik' },
  mobikwik_new: { key: null, label: 'MobiKwik' },
  freecharge: { key: null, label: 'Freecharge' },
  android: { key: null, label: 'Freecharge' },        // com.freecharge.android
  'amazon pay': { key: null, label: 'Amazon Pay' },
  shopping: { key: null, label: 'Amazon Pay' },       // in.amazon.mShop…shopping
};

// Scraper and Web Login rows key off Transaction.platform instead, which for
// those sources genuinely IS the brand. Kept separate from the sender-prefix
// table above because the same string means different things in the two
// contexts: a scraper row tagged "paytm" is the trader's Paytm for Business
// dashboard, whereas a notification whose sender begins "Paytm" is the
// consumer app. Labels here match the trader panel's ACCOUNT_TYPES so this
// doesn't quietly reword rows that already render correctly.
const APP_BY_PLATFORM = {
  gpay: { key: 'gpay', label: 'GPay Business' },
  paytm: { key: 'paytm', label: 'Paytm Business' },
  phonepe: { key: 'phonepe', label: 'PhonePe Business' },
  bharat_pe: { key: 'bharat_pe', label: 'BharatPe Business' },
  bharatpe: { key: 'bharat_pe', label: 'BharatPe Business' },
  airtel: { key: 'airtel', label: 'Airtel Payments Bank' },
};

// How we saw it, kept separate from WHICH app it was — they answer different
// questions and were previously conflated into the single `platform` string.
const CHANNEL_BY_PLATFORM = {
  'apk-notification': 'Notification',
  'apk-sms': 'SMS',
};

/** The app-name half of NotificationService's `<app>: <title>` sender. */
function senderPrefix(sender) {
  if (!sender) return '';
  const colon = sender.indexOf(':');
  return (colon === -1 ? sender : sender.slice(0, colon)).trim().toLowerCase();
}

/**
 * @param {object} txn
 * @param {string} txn.platform - Transaction.platform
 * @param {string} [txn.rawSender] - RawEvent.sender, when the row has one
 * @returns {{ key: string|null, label: string, channel: string }}
 */
function resolveSourceApp({ platform, rawSender, body } = {}) {
  const plat = String(platform || '').trim();

  // Web Login captures are read from the platform's own dashboard API, so the
  // platform tag itself already names the app ('web_login_paytm').
  if (plat.startsWith('web_login')) {
    const brand = plat.slice('web_login'.length).replace(/^[_-]/, '');
    const mapped = APP_BY_PLATFORM[brand.toLowerCase()];
    return {
      key: mapped ? mapped.key : null,
      label: mapped ? mapped.label : (brand || 'Web login'),
      channel: 'Web login',
    };
  }

  const channel = CHANNEL_BY_PLATFORM[plat];
  if (!channel) {
    // A scraper row: platform is already the brand ('paytm', 'gpay', …).
    const mapped = APP_BY_PLATFORM[plat.toLowerCase()];
    return {
      key: mapped ? mapped.key : (plat || null),
      label: mapped ? mapped.label : (plat || 'Unknown'),
      channel: 'Web scraper',
    };
  }

  const mapped = APP_BY_SENDER_PREFIX[senderPrefix(rawSender)];
  if (mapped) {
    return { key: mapped.key, label: mapped.label, channel };
  }

  // No known payment-app prefix. For a bank SMS the sender is a TRAI DLT header
  // (VM-SBIBNK), so identify the bank via the tiered system — for DISPLAY, any
  // tier that resolves is fine to show (settlement gates on tier separately, in
  // settlementBankCode). This turns a bare "Unknown app" into the real bank
  // name + logo (Tier 1/2), or an honest non-bank label (Tier 3 blacklist).
  const bank = identifyBankFromSender(rawSender);
  if (bank) {
    return { key: null, label: bank.name, channel, bankTier: bank.tier, isBank: bank.isBank };
  }

  // REDESIGN — header not in the matcher: recover the real bank name from the
  // SMS sign-off ("- Bank of Maharashtra") for DISPLAY/review, so an unmapped
  // bank shows its real name (flagged unrecognised) instead of "Unknown app".
  // DISPLAY-ONLY: key stays null and settlement uses settlementBankCode (Tier-1
  // exact) — never this label — so this cannot affect BUG-58 auto-settle. Only
  // runs when a caller passes `body`; the settlement caller doesn't, so its
  // result is unchanged.
  const signoff = extractBankSignoff(body);
  if (signoff) {
    return { key: null, label: signoff, channel, isBank: true, bankUnrecognized: true, viaSignoff: true };
  }

  // No sender at all, or a source we genuinely can't name: say so plainly
  // instead of inventing one or falling back to the capture tag.
  return { key: null, label: 'Unknown app', channel };
}

module.exports = { resolveSourceApp, senderPrefix, APP_BY_SENDER_PREFIX, APP_BY_PLATFORM };
