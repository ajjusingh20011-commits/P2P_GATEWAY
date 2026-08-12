/**
 * Central enums and shared constants used across models, services and routes.
 * Keeping them here avoids magic strings drifting apart between schemas.
 */

const ROLES = {
  ADMIN: 'admin',
  NGO_STAFF: 'ngo_staff',
  MERCHANT: 'merchant',
};

const NGO_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
};

const PLATFORMS = {
  PAYTM: 'paytm',
  PHONEPE: 'phonepe',
  BHARATPE: 'bharatpe',
  GPAY: 'gpay',
  AMAZONPAY: 'amazonpay',
  OTHER: 'other',
};

const ACCOUNT_STATUS = {
  LIVE: 'live',
  PAUSED: 'paused',
  DISCONNECTED: 'disconnected',
  // Created but a real login has never been attempted yet.
  PENDING: 'pending',
  // A real login (or OTP submit) was attempted and genuinely failed —
  // distinct from PAUSED (OTP pending / session expired) and PENDING
  // (never attempted).
  FAILED: 'failed',
};

// Why an account is currently PAUSED — PAUSED alone is ambiguous (a trader
// manually turning it off looks identical to a genuine OTP request or a
// dead session, since all three write the same status value). null when
// status isn't PAUSED, or for a PAUSED account whose reason predates this
// field.
const ACCOUNT_STATUS_REASON = {
  MANUAL_PAUSE: 'manual_pause',
  OTP_REQUIRED: 'otp_required',
  SESSION_EXPIRED: 'session_expired',
};

// How an account's transactions are captured: an on-device APK relay, or a
// server-side web login the scraper drives with stored credentials.
const CONNECTION_TYPE = {
  APK: 'apk',
  WEB: 'web',
};

const RAW_EVENT_TYPE = {
  SMS: 'SMS',
  NOTIFICATION: 'NOTIFICATION',
  SCREEN: 'SCREEN',
  // On-device WebView "Web Login" capture (Paytm/GPay/PhonePe merchant
  // dashboards). Authoritative structured data read from the platform's own
  // transaction API inside the app's WebView — not heuristic SMS/notif text.
  WEB_LOGIN: 'WEB_LOGIN',
};

const CATEGORY = {
  PAYMENT: 'PAYMENT',
  OTP: 'OTP',
  BANK: 'BANK',
  ALERT: 'ALERT',
  OTHER: 'OTHER',
};

const WEBHOOK_STATUS = {
  PENDING: 'pending',
  MATCHED: 'matched',
  EXPIRED: 'expired',
};

const TRANSACTION_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
};

const DEVICE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  // A license key has been generated but no phone has claimed it yet.
  PENDING: 'pending',
};

// Webhook donation intents stay open for matching for this long.
const WEBHOOK_EXPIRY_MINUTES = 120; // 2 hours

// Genesis hash used as prevHash for the very first ledger entry.
const GENESIS_HASH = '0000000000';

module.exports = {
  ROLES,
  NGO_STATUS,
  PLATFORMS,
  ACCOUNT_STATUS,
  ACCOUNT_STATUS_REASON,
  CONNECTION_TYPE,
  RAW_EVENT_TYPE,
  CATEGORY,
  WEBHOOK_STATUS,
  TRANSACTION_STATUS,
  DEVICE_STATUS,
  WEBHOOK_EXPIRY_MINUTES,
  GENESIS_HASH,
};
