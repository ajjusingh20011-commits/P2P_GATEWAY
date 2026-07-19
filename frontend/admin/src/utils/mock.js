/**
 * Mock data + formatting helpers for the Admin Panel.
 * Deterministic (index-based) generation so the UI is stable across reloads.
 * Replace these with live API calls once backend endpoints are wired.
 */

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
export const inr = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const inrFull = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usdt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';

export const pct = (n) => `${Number(n).toFixed(1)}%`;

export const compact = (n) =>
  Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const maskUpi = (upi = '') => {
  const [name, domain] = upi.split('@');
  if (!domain) return upi;
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
};

export const maskKey = (key = '') => {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}${'•'.repeat(12)}${key.slice(-4)}`;
};

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export const ACCOUNT_TYPES = {
  gpay: { label: 'GPay Business', color: 'sky' },
  phonepe: { label: 'PhonePe Business', color: 'violet' },
  airtel: { label: 'Airtel Payments Bank', color: 'red' },
  bharat_pe: { label: 'BharatPe Business', color: 'amber' },
  paytm: { label: 'Paytm Business', color: 'sky' },
};
// Detection engines that capture incoming payments.
export const ENGINES = ['SMS Parser', 'Notification Listener', 'UPI Intent', 'Bank Statement', 'Manual'];

// ---------------------------------------------------------------------------
// Traders
// ---------------------------------------------------------------------------
export const traders = [];

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------
export const merchants = [];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = ['new', 'assigned', 'paid', 'confirmed', 'expired', 'disputed', 'cancelled'];

export const orders = [];

// ---------------------------------------------------------------------------
// Payments / notification logs (across all traders)
// ---------------------------------------------------------------------------
export const payments = [];

// ---------------------------------------------------------------------------
// Payouts (trader withdrawal requests)
// ---------------------------------------------------------------------------
export const PAYOUT_STATUSES = ['awaiting', 'processing', 'completed', 'dispute'];

export const payouts = [];

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
export const DISPUTE_STATUSES = ['open', 'reviewing', 'resolved'];

export const disputes = [];

// ---------------------------------------------------------------------------
// Smartphones (ALL traders)
// ---------------------------------------------------------------------------
export const smartphones = [];

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------
export const settlementTraders = [];

export const settlementMerchants = [];

export const settlementHistory = [];

// ---------------------------------------------------------------------------
// Dashboard aggregates
// ---------------------------------------------------------------------------
export const dashboardStats = {
  volumeTodayInr: 0,
  activeTraders: 0,
  activeMerchants: 0,
  transactionsToday: 0,
  successRate: 0,
  platformRevenueUsdt: 0,
};

export const volume7Days = [];

export const successVsFailed = { success: 0, failed: 0 };

export const topTraders = [];

export const topMerchants = [];

// Seed for the live transaction feed (Dashboard animates on top of this).
export const liveFeedSeed = [];

// Badge counts for the sidebar.
export const counts = {
  disputes: 0,
  payouts: 0,
  orders: 0,
};
