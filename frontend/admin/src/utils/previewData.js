/**
 * Preview-only data for admin pages with no backend support yet (Routing,
 * Capacity, Risk, Admins — no matching route in adminRoutes.js). Kept
 * isolated from mock.js on purpose: mock.js is a network-failure FALLBACK
 * for otherwise-real endpoints; this file backs pages with no real endpoint
 * to fall back from at all. Every page using this must show a visible
 * "Preview" label.
 */

export const previewRoutingRules = [
  { id: 'RT-01', name: 'GPay Business — high limit', method: 'gpay', priority: 1, status: 'active', matchedToday: 214 },
  { id: 'RT-02', name: 'PhonePe — standard', method: 'phonepe', priority: 2, status: 'active', matchedToday: 176 },
  { id: 'RT-03', name: 'Paytm — overflow', method: 'paytm', priority: 3, status: 'active', matchedToday: 58 },
  { id: 'RT-04', name: 'UPI generic — fallback', method: 'upi', priority: 4, status: 'paused', matchedToday: 0 },
];

export const previewCapacity = {
  totalDailyLimitInr: 8500000,
  usedTodayInr: 3120000,
  activeAccounts: 42,
  strainedAccounts: 3,
};

export const previewCapacityByTrader = [
  { trader: 'trader_alpha', usedPct: 92, limitInr: 500000 },
  { trader: 'trader_beta', usedPct: 74, limitInr: 400000 },
  { trader: 'trader_gamma', usedPct: 61, limitInr: 350000 },
  { trader: 'trader_delta', usedPct: 38, limitInr: 300000 },
];

export const previewRiskSignals = [
  { id: 'RSK-01', type: 'Velocity', severity: 'high', detail: 'Merchant TS-114 — 12 orders in 3 minutes', at: '2026-07-30 09:12' },
  { id: 'RSK-02', type: 'UTR reuse', severity: 'medium', detail: 'Same UTR referenced by 2 orders', at: '2026-07-30 07:48' },
  { id: 'RSK-03', type: 'New device', severity: 'low', detail: 'Trader logged in from an unrecognized device', at: '2026-07-29 22:03' },
];

export const previewAdmins = [
  { id: 1, email: 'admin@p2p.com', role: 'super_admin', lastActive: '2026-07-30 10:02' },
  { id: 2, email: 'ops1@p2p.com', role: 'operations', lastActive: '2026-07-29 18:44' },
  { id: 3, email: 'support1@p2p.com', role: 'support', lastActive: '2026-07-28 14:20' },
];
