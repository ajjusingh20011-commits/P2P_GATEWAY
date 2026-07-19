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
  CONNECTION_TYPE,
  RAW_EVENT_TYPE,
  CATEGORY,
  WEBHOOK_STATUS,
  TRANSACTION_STATUS,
  DEVICE_STATUS,
  WEBHOOK_EXPIRY_MINUTES,
  GENESIS_HASH,
};
