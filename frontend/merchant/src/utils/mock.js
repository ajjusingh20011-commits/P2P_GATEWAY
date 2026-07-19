/**
 * Mock data + formatting helpers for the Merchant Panel.
 * Deterministic (index-based) generation so the UI is stable across reloads.
 */

export const inr = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const inrFull = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usdt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';
export const pct = (n) => `${Number(n).toFixed(1)}%`;
export const compact = (n) =>
  Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const maskKey = (key = '') => {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}${'•'.repeat(12)}${key.slice(-4)}`;
};

export const ACCOUNT_TYPES = {
  gpay: { label: 'GPay', color: 'sky' },
  phonepe: { label: 'PhonePe', color: 'violet' },
  paytm: { label: 'Paytm', color: 'sky' },
  bharat_pe: { label: 'BharatPe', color: 'amber' },
  upi: { label: 'UPI', color: 'indigo' },
};
// Base checkout origin (checkout app runs on 5176 in dev).
export const CHECKOUT_ORIGIN =
  (typeof window !== 'undefined' && import.meta.env.VITE_CHECKOUT_URL) || 'http://localhost:5176';

export const checkoutUrl = (orderId) => `${CHECKOUT_ORIGIN}/?order=${orderId}`;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export const stats = {
  todayCollections: 0,
  totalTransactions: 0,
  successRate: 0,
  pendingOrders: 0,
  balanceUsdt: 0,
  monthlyVolumeInr: 0,
};

// Daily revenue for the last 30 days.
export const revenue30Days = [];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = ['new', 'confirmed', 'expired', 'disputed'];

export const orders = [];

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const transactions = [];

// ---------------------------------------------------------------------------
// Balance / settlements
// ---------------------------------------------------------------------------
export const settlements = [];

// ---------------------------------------------------------------------------
// API credentials
// ---------------------------------------------------------------------------
export const apiCredentials = {
  apiKey: 'pk_live_7f2a91c4d8e3b6a0f5c2',
  apiSecret: 'sk_live_q3z8m1k5v2n6x9f2a7b1c4d8',
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export const webhookLogs = [];

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const profile = {
  businessName: 'Test Store',
  email: 'merchant@p2p.com',
  phone: '+91 98765 43210',
  webhookUrl: 'https://teststore.com/webhooks/p2p',
};

export const counts = {
  ordersPending: 0,
};
