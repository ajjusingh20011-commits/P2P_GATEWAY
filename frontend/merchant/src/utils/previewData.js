/**
 * Preview-only data for pages with no backend support yet (Settlements,
 * Reports — see merchantRoutes.js, which has no settlement/report
 * endpoints). Kept isolated from mock.js on purpose: mock.js is a
 * network-failure FALLBACK for otherwise-real endpoints, this file backs
 * pages that have no real endpoint to fall back from at all. Never imported
 * by a page that has real data — every page using this must show a visible
 * "Preview" label.
 */

export const previewSettlements = [
  { id: 'STL-90142', date: '2026-07-28', grossInr: 412000, feeInr: 20600, netUsdt: 4406.9, status: 'completed', utr: 'UTR2607280001' },
  { id: 'STL-90098', date: '2026-07-21', grossInr: 356500, feeInr: 17825, netUsdt: 3810.4, status: 'completed', utr: 'UTR2607210007' },
  { id: 'STL-90051', date: '2026-07-14', grossInr: 289000, feeInr: 14450, netUsdt: 3096.6, status: 'completed', utr: 'UTR2607140003' },
  { id: 'STL-90012', date: '2026-07-07', grossInr: 401200, feeInr: 20060, netUsdt: 4292.8, status: 'completed', utr: 'UTR2607070002' },
];

export const previewReportSummary = {
  totalPayinInr: 1458700,
  totalPayoutInr: 612300,
  successRate: 96.8,
  avgSettlementHours: 18,
};

export const previewDailyVolume = [
  { day: 'Mon', payinInr: 62000, payoutInr: 21000 },
  { day: 'Tue', payinInr: 78500, payoutInr: 34200 },
  { day: 'Wed', payinInr: 55100, payoutInr: 18700 },
  { day: 'Thu', payinInr: 91200, payoutInr: 40500 },
  { day: 'Fri', payinInr: 103400, payoutInr: 52300 },
  { day: 'Sat', payinInr: 68900, payoutInr: 29100 },
  { day: 'Sun', payinInr: 47600, payoutInr: 15900 },
];

export const previewMethodBreakdown = [
  { method: 'GPay', share: 38, color: 'sky' },
  { method: 'PhonePe', share: 29, color: 'violet' },
  { method: 'Paytm', share: 18, color: 'sky' },
  { method: 'UPI', share: 15, color: 'indigo' },
];
