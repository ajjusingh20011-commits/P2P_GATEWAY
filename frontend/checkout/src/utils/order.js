/**
 * Mock order data + UPI helpers for the customer checkout.
 * No backend: the order is read from the ?order= query param when present,
 * otherwise a demo order is used.
 */

export const DEMO_ORDER = {
  id: 'ORD-48210',
  merchantName: 'Test Store',
  payeeName: 'Test Store',
  upiId: '8667593419@okbizaxis',
  amountInr: 5000,
  expirySeconds: 600, // 10 minutes
};

// Alternate UPI IDs served by "Get new UPI ID".
export const ALT_UPI_IDS = [
  '8667593419@okbizaxis',
  '9942137856@ybl',
  'teststore.pay@okicici',
  '7010455621@paytm',
];

/** Read the ?order= id from the URL (null if absent). */
export function getOrderIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('order');
  } catch (_) {
    return null;
  }
}

/** Demo/offline order used as a fallback when the backend is unreachable. */
export function getOrder() {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('order');
    const amount = params.get('amount');
    return {
      ...DEMO_ORDER,
      ...(id ? { id } : {}),
      ...(amount ? { amountInr: Number(amount) } : {}),
    };
  } catch (_) {
    return DEMO_ORDER;
  }
}

export const inr = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build the standard UPI deep link (also used to render the QR code). */
export function upiLink({ upiId, payeeName, amountInr, id }, scheme = 'upi') {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: String(amountInr),
    cu: 'INR',
    tn: `Payment for ${id}`,
  });
  // Different apps use different URL schemes but the same query params.
  const base = {
    upi: 'upi://pay',
    phonepe: 'phonepe://pay',
    gpay: 'tez://upi/pay',
    paytm: 'paytmmp://pay',
    bhim: 'upi://pay',
  }[scheme] || 'upi://pay';
  return `${base}?${params.toString()}`;
}

export function fmtTimer(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// WhatsApp support link.
export const SUPPORT_WHATSAPP = 'https://wa.me/919000000000?text=I%20need%20help%20with%20my%20payment';
export const HOW_TO_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
