'use strict';

/**
 * ID / credential generators.
 */

const crypto = require('crypto');

/** Human-readable order reference, e.g. ORD-8F3K9A2C. */
function orderRef() {
  return 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/** Merchant API key (public) and secret (private). */
function apiKey() {
  return 'pk_live_' + crypto.randomBytes(16).toString('hex');
}
function apiSecret() {
  return 'sk_live_' + crypto.randomBytes(24).toString('hex');
}

/** Opaque device auth token for a registered APK. */
function deviceToken() {
  return 'dev_' + crypto.randomBytes(24).toString('hex');
}

/** Mask a secret for display: keep head + tail. */
function mask(value = '') {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}${'•'.repeat(12)}${value.slice(-4)}`;
}

module.exports = { orderRef, apiKey, apiSecret, deviceToken, mask };
