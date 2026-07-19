/**
 * Checkout API client (public endpoints — no auth needed).
 * Talks to the gateway at http://localhost:4000/api by default.
 */

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

/** Map a backend order view into the shape the checkout UI uses. */
export function mapOrder(o) {
  const expiresMs = o.expires_at ? new Date(o.expires_at).getTime() : null;
  const remaining = expiresMs ? Math.max(0, Math.round((expiresMs - Date.now()) / 1000)) : null;
  return {
    id: o.order_id || o.uuid || String(o.id),
    merchantName: o.merchant_name || o.payee_name || 'Merchant',
    payeeName: o.payee_name || o.merchant_name || 'Merchant',
    upiId: o.assigned_upi_id || o.paymentDetail?.upi_id || '',
    amountInr: Number(o.amount_inr),
    status: o.status,
    expiresAt: expiresMs,
    remaining,
    txnRef: o.upi_ref_id || null,
  };
}

/** Map the dedicated flat checkout view into the shape the checkout UI uses. */
export function mapCheckout(d) {
  const expiresMs = d.expires_at ? new Date(d.expires_at).getTime() : null;
  const remaining = expiresMs ? Math.max(0, Math.round((expiresMs - Date.now()) / 1000)) : null;
  return {
    id: d.order_id,
    shortId: d.order_id_short || (d.order_id ? String(d.order_id).split('-')[0].toUpperCase() : ''),
    merchantName: d.merchant_name || 'Merchant',
    payeeName: d.upi_name || d.merchant_name || 'Merchant',
    paymentDetailId: d.payment_detail_id || null,
    upiId: d.upi_id || '', // FULL upi id, never masked
    bankName: d.bank_name || '',
    accountType: d.account_type || null,
    amountInr: Number(d.amount_inr),
    qrData: d.qr_data || d.upi_link || null,
    traderOnline: !!d.trader_online,
    utrNumber: d.utr_number || null,
    // "assigned" once a real UPI is attached; until then the page shows "searching".
    hasUpi: !!(d.payment_detail_id && d.upi_id),
    status: d.status,
    expiresAt: expiresMs,
    remaining,
    // Order System v2.
    gatewayOrderId: d.gateway_order_id || null,
    depositType: d.deposit_type || null,
    confirmationType: d.confirmation_type || null,
    rejectionReason: d.rejection_reason || null,
    redirectUrl: d.redirect_url || null,
  };
}

async function req(path, opts) {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data;
}

/** GET /api/orders/:id */
export async function fetchOrder(id) {
  const data = await req(`/orders/${encodeURIComponent(id)}`);
  return mapOrder(data.order);
}

/** GET /api/orders/:id/checkout — flat, checkout-page-friendly order view. */
export async function fetchCheckout(id) {
  const data = await req(`/orders/${encodeURIComponent(id)}/checkout`);
  return mapCheckout(data);
}

/** POST /api/orders/:id/new-upi — reassign to a different trader. */
export async function requestNewUpi(id) {
  const data = await req(`/orders/${encodeURIComponent(id)}/new-upi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return mapOrder(data.order);
}

/** PUT /api/orders/:id/checkout-opened — pending → checkout_open on page load. */
export async function markCheckoutOpened(id) {
  return req(`/orders/${encodeURIComponent(id)}/checkout-opened`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/orders/:id/claim-paid — the customer asserts they paid, with their
 * proof: 'utr' (reference entered), 'screenshot', or 'no_proof'.
 */
export async function claimPaid(id, { utrNumber, confirmationType } = {}) {
  const data = await req(`/orders/${encodeURIComponent(id)}/claim-paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      utr_number: utrNumber || undefined,
      confirmation_type: confirmationType || (utrNumber ? 'utr' : 'no_proof'),
      customer_confirmed: true,
    }),
  });
  return data?.order ? mapOrder(data.order) : data;
}

/** Back-compat alias (old callers). */
export async function markPaid(id, utrNumber) {
  return claimPaid(id, { utrNumber, confirmationType: utrNumber ? 'utr' : 'no_proof' });
}

/** Origin of the gateway (strip the trailing /api) — used for the socket. */
export const SOCKET_ORIGIN = BASE.replace(/\/api\/?$/, '');

