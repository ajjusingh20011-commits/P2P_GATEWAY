/**
 * Formatting helpers + empty data stubs for the trader dashboard UI.
 * Data lists are intentionally empty — pages now load live data from the API.
 * Formatters and ACCOUNT_TYPES are kept intact.
 */

export const ACCOUNT_TYPES = {
  gpay: { label: 'GPay Business', color: 'sky' },
  phonepe: { label: 'PhonePe Business', color: 'violet' },
  airtel: { label: 'Airtel Payments Bank', color: 'red' },
  bharat_pe: { label: 'BharatPe Business', color: 'amber' },
  paytm: { label: 'Paytm Business', color: 'sky' },
};

export const inr = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const usdt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';

export const pct = (n) => `${Number(n).toFixed(1)}%`;

export const maskUpi = (upi = '') => {
  const [name, domain] = upi.split('@');
  if (!domain) return upi;
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
};

// --- Aggregates / stats: names kept, numeric values zeroed ---
export const balance = 0;

export const stats = {
  todayTrades: 0,
  todayVolume: 0,
  successRate: 0,
};

export const counts = {
  notifications: 0,
  smartphones: 0,
  payoutsAwaiting: 0,
};

// --- Data lists: emptied ---
export const paymentDetails = [];
export const trades = [];
export const offers = [];
export const payouts = [];
export const notifications = [];
export const smartphones = [];
