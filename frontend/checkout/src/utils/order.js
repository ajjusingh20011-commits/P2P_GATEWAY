/**
 * UPI helpers for the customer checkout. Real orders are read from the
 * ?order= query param and fetched from the backend — see services/api.js.
 */

/** Read the ?order= id from the URL (null if absent). */
export function getOrderIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('order');
  } catch (_) {
    return null;
  }
}

/**
 * Demo checkout — merchant panel's "Create New Order"/payout pages build
 * this link client-side for a demo merchant (is_demo true on the Merchant
 * row), entirely without a real order: ?demo=1&amount=&ref=&merchant=&id=.
 * Never a real order, never read by the backend — the whole demo flow lives
 * in CheckoutPage.jsx's isDemo branch. Returns null when ?demo=1 isn't set.
 */
export function getDemoParamsFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') !== '1') return null;
    return {
      amountInr: Number(params.get('amount')) || 500,
      ref: params.get('ref') || 'DEMO',
      merchantName: params.get('merchant') || 'Demo Store',
      id: params.get('id') || `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Builds the synthetic order object the demo flow renders — same shape
 * services/api.js's mapCheckout() produces for a real order, so CheckoutPage
 * needs no separate rendering path. upiId is deliberately fake (never a real
 * trader's) and obviously demo-labeled.
 */
export function buildDemoOrder(demoParams) {
  const { amountInr, ref, merchantName, id } = demoParams;
  return {
    id,
    shortId: id,
    gatewayOrderId: id,
    merchantName,
    payeeName: merchantName,
    paymentDetailId: null,
    upiId: `demo.${String(ref).toLowerCase().replace(/[^a-z0-9]/g, '') || 'order'}@maxpaydemo.test`,
    bankName: '',
    accountType: null,
    amountInr,
    qrData: null,
    traderOnline: true,
    utrNumber: null,
    hasUpi: true,
    status: 'pending',
    expiresAt: Date.now() + 10 * 60 * 1000,
    remaining: 10 * 60,
    depositType: null,
    confirmationType: null,
    rejectionReason: null,
    redirectUrl: null,
    hasReceipt: false,
  };
}

export const inr = (n) =>
  '₹' +
  Number(n).toLocaleString('en-IN', {
    // Paise only when the amount actually has them, so a whole-rupee order reads
    // "₹5,000" instead of "₹5,000.00". Display only — the value is untouched.
    minimumFractionDigits: Math.round(Number(n) * 100) % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

/**
 * The payment reference shown to the payer. Deliberately a fixed, generic
 * string. It used to be `Payment for ${id}` — which put our internal gateway
 * reference ("Payment for PG_20260928_00005") in front of the payer inside
 * their own banking app, where it means nothing to them and discloses our
 * order numbering. Nothing reads this back: it is not used for matching,
 * reconciliation, webhook correlation, support display or dispute evidence
 * (checked across backend, ngo-backend, the APK and all four panels — it
 * appears only in the link builders below), so no settlement path depends on
 * what is written here. Shared by every link builder — `upiLink`'s `tn`,
 * `phonepeNativeLink`'s `note` and `paytmCashWalletLink`'s `tn` — so there is
 * exactly one place that decides this value.
 */
export const PAYMENT_NOTE = 'Payment';

/**
 * Build the standard UPI deep link (also used to render the QR code).
 *
 * `id` is still accepted so existing callers don't break, and is now unused
 * on purpose rather than by accident.
 */
// eslint-disable-next-line no-unused-vars
export function upiLink({ upiId, payeeName, amountInr, id }, scheme = 'upi') {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: String(amountInr),
    cu: 'INR',
    tn: PAYMENT_NOTE,
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

/**
 * PhonePe's native P2P/chat checkout route — user-tested working route,
 * distinct from the generic `phonepe://pay` UPI intent above (that one still
 * exists in `upiLink` for completeness, but is dead: nothing calls it with
 * scheme 'phonepe' now — see UpiApps.jsx).
 *
 * `amountInr` is the order's amount in whole/decimal RUPEES, same unit used
 * everywhere else on this page (`inr()`, `copyAmount`, `upiLink`'s `am`) —
 * converted to paise ONLY here, since this is the one payload that needs it.
 */
export function phonepeNativeLink({ upiId, amountInr }) {
  const amountPaise = Math.round(Number(amountInr) * 100);
  const payload = {
    contact: {
      cbsName: '',
      nickName: '',
      vpa: upiId,
      type: 'VPA',
    },
    p2pPaymentCheckoutParams: {
      note: PAYMENT_NOTE,
      isByDefaultKnownContact: true,
      enableSpeechToText: false,
      allowAmountEdit: false,
      showQrCodeOption: false,
      disableViewHistory: true,
      shouldShowUnsavedContactBanner: false,
      isRecurring: false,
      checkoutType: 'DEFAULT',
      transactionContext: 'p2p',
      initialAmount: amountPaise,
      disableNotesEdit: true,
      showKeyboard: true,
      currency: 'INR',
      shouldShowMaskedNumber: true,
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  return `phonepe://native?data=${data}&id=p2ppayment`;
}

/**
 * Paytm's money-transfer route — user-tested working route, distinct from the
 * old `paytmmp://pay` generic-UPI-scheme link in `upiLink` above (that one is
 * what produced "Payment failed as per UPI risk policy" on a real device).
 *
 * UNITS — deliberately different from PhonePe's, do not copy one to the other:
 *   PhonePe `initialAmount` = integer PAISE   (₹10 -> 1000)
 *   Paytm   `am`            = decimal RUPEES  (₹10 -> "10.00")
 * `amountInr` arrives in RUPEES (the unit used by `inr()`, `copyAmount` and
 * `upiLink`'s `am`), so this formats rather than converts — there is no
 * multiplication here, and none to double up.
 *
 * `tr` is sent empty, as in the tested route: this is a person-to-person
 * transfer rather than a merchant collect, and nothing reads it back.
 */
export function paytmCashWalletLink({ upiId, payeeName, amountInr }) {
  const params = new URLSearchParams({
    pa: upiId,
    cu: 'INR',
    pn: payeeName || upiId,
    am: Number(amountInr).toFixed(2),
    tn: PAYMENT_NOTE,
    tr: '',
    featuretype: 'money_transfer',
  });
  return `paytmmp://cash_wallet?${params.toString()}`;
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
