/**
 * Inline SVG icon set (no external icon dependency).
 * Each icon accepts standard SVG props (className, etc.).
 */
const base = {
  fill: 'none',
  viewBox: '0 0 24 24',
  strokeWidth: 1.8,
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const IconDashboard = (p) => (
  <svg {...base} {...p}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
);
export const IconOrders = (p) => (
  <svg {...base} {...p}><path d="M9 3h6l1 3H8z" /><rect x="4" y="6" width="16" height="15" rx="2" /><path d="M8 11h8M8 15h5" /></svg>
);
export const IconTransactions = (p) => (
  <svg {...base} {...p}><path d="M7 4h10a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z" /><path d="M9 9h6M9 13h6" /></svg>
);
export const IconBalance = (p) => (
  <svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h.01" /><path d="M21 9h-5a3 3 0 0 0 0 6h5" /></svg>
);
export const IconKey = (p) => (
  <svg {...base} {...p}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 21 2m-4 0 3 3-3 3" /></svg>
);
export const IconWebhook = (p) => (
  <svg {...base} {...p}><path d="M12 8a3 3 0 1 0-2.6 2.96L7 16" /><path d="M9 18a3 3 0 1 0 .8-4.6" /><path d="M15 18a3 3 0 1 0-2.4-4.8L10.5 9" /><path d="M15 18h2.5a3 3 0 1 0-2.9-3.8" /></svg>
);
export const IconProfile = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const IconLogout = (p) => (
  <svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const IconActivity = (p) => (
  <svg {...base} {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);
export const IconSearch = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const IconPlus = (p) => (
  <svg {...base} {...p}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);
export const IconChevron = (p) => (
  <svg {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconExport = (p) => (
  <svg {...base} {...p}><path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M4 21h16" /></svg>
);
export const IconEye = (p) => (
  <svg {...base} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconEyeOff = (p) => (
  <svg {...base} {...p}><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1" /><path d="M6.3 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 3-.5" /></svg>
);
export const IconCopy = (p) => (
  <svg {...base} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
);
export const IconRefresh = (p) => (
  <svg {...base} {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
);
export const IconCheck = (p) => (
  <svg {...base} {...p}><path d="M20 6L9 17l-5-5" /></svg>
);
export const IconClose = (p) => (
  <svg {...base} {...p}><path d="M18 6L6 18M6 6l12 12" /></svg>
);
export const IconRupee = (p) => (
  <svg {...base} {...p}><path d="M6 4h12M6 8h12M14 21 7 12h3a5 5 0 0 0 0-8" /></svg>
);
export const IconTrendUp = (p) => (
  <svg {...base} {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>
);
export const IconClock = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconWallet = IconBalance;
export const IconLink = (p) => (
  <svg {...base} {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
);
