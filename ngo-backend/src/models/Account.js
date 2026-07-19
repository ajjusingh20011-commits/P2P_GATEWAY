const mongoose = require('mongoose');
const { PLATFORMS, ACCOUNT_STATUS, CONNECTION_TYPE } = require('../config/constants');

const accountSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: Object.values(PLATFORMS),
      required: true,
    },
    upiId: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    displayName: { type: String, trim: true, default: '' },
    organizationName: { type: String, trim: true, default: '' },
    // Per-transaction amount bounds (mirrors trader PaymentDetail semantics).
    minAmount: { type: Number, default: 0 },
    maxAmount: { type: Number, default: 500000 },
    // Max transaction COUNT per rolling window.
    maxPerHour: { type: Number, default: 100 },
    maxPerDay: { type: Number, default: 1000 },
    maxPerWeek: { type: Number, default: 5000 },
    maxPerMonth: { type: Number, default: 20000 },
    // Optional per-window AMOUNT caps (null = no cap for that window).
    monthlyLimit: { type: Number, default: null },
    weeklyLimit: { type: Number, default: null },
    dailyLimitAmount: { type: Number, default: null },
    hourlyLimitAmount: { type: Number, default: null },
    monthlyStartDate: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      default: ACCOUNT_STATUS.DISCONNECTED,
    },
    // How this account is connected: on-device APK relay (no stored
    // credentials) or a server-side web login the scraper drives.
    connectionType: {
      type: String,
      enum: Object.values(CONNECTION_TYPE),
      default: CONNECTION_TYPE.APK,
    },
    // AES-encrypted login credentials for the scraper (web connections only).
    encryptedLoginEmail: { type: String, default: '' },
    encryptedLoginPassword: { type: String, default: '' },
    encryptedLoginPhone: { type: String, default: '' },
    lastSyncTime: { type: Date, default: null },
    totalReceived: { type: Number, default: 0 },
    // Links this account to its mirrored row in the gateway backend's
    // `payment_details` table (MySQL), so the order-routing engine — which
    // only ever reads `payment_details` — can see and assign it. Set by the
    // trader frontend after it syncs this account via traderApi.
    gatewayPaymentDetailId: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Account', accountSchema);
