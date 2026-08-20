'use strict';

/**
 * Phase 1a — a device's LIST of active payouts (up to 3 a trader may complete
 * on ANY of their linked devices), replacing the old single Device.activePayout
 * slot. Kept pure and separate so the list semantics — replace-by-orderId, the
 * cap, prune, and "which of the up-to-3 does this content belong to" — are
 * unit-tested without Mongo, the same boundary this project already draws for
 * payoutLockService.js / weightedRotation.js / paymentDetector.js.
 *
 * The routes implement the same semantics with atomic Mongo operators
 * ($pull to replace/clear, $push+$slice to cap); these helpers are the spec
 * those operators must match, and the reusable in-process logic.
 */

const MAX_ACTIVE_PAYOUTS = 3;

/** Normalize one active-payout descriptor (full identity per Scenario 10). */
function makeEntry({ orderId, payeeName, accountNumber, ifsc, amount, activatedAt } = {}) {
  return {
    orderId: String(orderId),
    payeeName: payeeName || '',
    accountNumber: accountNumber || '',
    ifsc: ifsc || '',
    amount: amount != null ? String(amount) : '',
    activatedAt: activatedAt ? new Date(activatedAt) : new Date(),
  };
}

/**
 * Add or REPLACE an entry by orderId, capped at `cap`. Re-arming an orderId
 * already present replaces it (no duplicates). When a genuinely new orderId
 * would exceed the cap, the OLDEST arm (by activatedAt) is evicted — the cap is
 * a device-side safety net; the real "max 3 in processing" is enforced upstream
 * at pickup. Returns a NEW array; never mutates the input.
 */
function upsertPayout(list, entry, cap = MAX_ACTIVE_PAYOUTS) {
  const e = makeEntry(entry);
  const others = (list || []).filter((p) => String(p.orderId) !== e.orderId);
  const next = [...others, e];
  if (next.length > cap) {
    next.sort((a, b) => new Date(a.activatedAt) - new Date(b.activatedAt));
    return next.slice(next.length - cap);
  }
  return next;
}

/** Remove the entry for orderId (prune). Returns a NEW array. */
function removePayout(list, orderId) {
  return (list || []).filter((p) => String(p.orderId) !== String(orderId));
}

/** Whether the list currently holds an arm for orderId. */
function hasPayout(list, orderId) {
  return (list || []).some((p) => String(p.orderId) === String(orderId));
}

/** The arm for orderId, or null. */
function getPayout(list, orderId) {
  return (list || []).find((p) => String(p.orderId) === String(orderId)) || null;
}

module.exports = {
  MAX_ACTIVE_PAYOUTS,
  makeEntry,
  upsertPayout,
  removePayout,
  hasPayout,
  getPayout,
};
