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
  const link = upiId
    ? buildUpiLink({ upiId, payeeName, amountInr: order.amount_inr, note: order.uuid })
    : null;
  return {
    assigned_upi_id: upiId,
    payee_name: payeeName,
    qr_data: link,
    upi_link: link,
  };
}

module.exports = { buildUpiLink, checkoutUrl, paymentPayload };
