'use strict';

/**
 * UPI helpers — build the deep link + QR payload for an order/payment detail,
 * and the customer-facing checkout URL.
 */

const config = require('../config');

/**
 * Standard UPI intent string. Scanned as a QR or opened as a deep link.
 *   upi://pay?pa={upi}&pn={name}&am={amount}&cu=INR&tn={note}
 */
function buildUpiLink({ upiId, payeeName, amountInr, note }) {
  const params = new URLSearchParams({
    pa: upiId || '',
    pn: payeeName || 'Merchant',
    am: amountInr != null ? String(amountInr) : '',
    cu: 'INR',
    tn: note || 'Payment',
  });
  return `upi://pay?${params.toString()}`;
}

/** Checkout URL the customer is redirected to (keyed by order uuid). */
function checkoutUrl(orderUuid) {
  return `${config.frontend.checkout}/?order=${orderUuid}`;
}

/**
 * Assemble the payment payload returned to the merchant / checkout for an
 * order that has an assigned payment detail.
 */
function paymentPayload(order, paymentDetail) {
  const upiId = paymentDetail?.upi_id || null;
  const payeeName = paymentDetail?.account_name || 'Merchant';
  // No `note`: buildUpiLink falls back to a generic "Payment".
  //
  // This used to pass `note: order.uuid`, which rendered the raw order UUID in
  // the payer's banking app as the transaction note — an internal identifier
  // the customer should never see, and the one a payer is most likely to
  // mistake for something they need to keep. This is the QR's payload, i.e.
  // the path that actually works, so it is what payers really read.
  //
  // Safe to change: `tn` is written here and in the checkout's own builder and
  // read nowhere — not by matching, reconciliation, webhooks, support or
  // dispute evidence. Settlement keys on {upi_id, amount} plus the UTR tier,
  // device and platform; it never looks at the note.
  //
  // buildUpiLink's other caller (traderController's device-verification QR)
  // passes its own note and is unaffected.
  const link = upiId
    ? buildUpiLink({ upiId, payeeName, amountInr: order.amount_inr })
    : null;
  return {
    assigned_upi_id: upiId,
    payee_name: payeeName,
    qr_data: link,
    upi_link: link,
  };
}

module.exports = { buildUpiLink, checkoutUrl, paymentPayload };
