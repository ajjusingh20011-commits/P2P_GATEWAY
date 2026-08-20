'use strict';

/**
 * Payout evidence match evaluator — Feature 2, the active "I have transferred"
 * submission gate.
 *
 * Compares the fields the APK extracted from the trader's payment SUCCESS screen
 * (ngo-backend PayoutEvidence.extractedFields, produced tap-only by the APK's
 * SuccessScreenParser) against the payout order's real expected values. The HARD
 * fields — amount and the recipient account's last 4 digits — must match EXACTLY
 * for the transfer to be submittable. The recipient NAME is a soft signal only
 * and never blocks (names render inconsistently across apps).
 *
 * BANK-ACCOUNT payouts ONLY (product decision): a UPI-id payout's success screen
 * shows the payee UPI id / name, not a masked account number, so there is no
 * account last-4 to hard-match — those keep the old warn-don't-block behavior,
 * surfaced here as `applicable:false` (the caller must not block them).
 *
 * PURE and used on BOTH sides of the gate:
 *   - the gateway's payoutService.transferred() calls this to ENFORCE the block
 *     server-side (the real, unbypassable guarantee), and
 *   - the trader panel mirrors the identical logic (frontend/trader/src/utils/
 *     payoutMatch.js) to enable/disable the button and explain why.
 * Keep the two copies in lockstep — same rules, same reason codes.
 */

function digitsOnly(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function last4(s) {
  const d = digitsOnly(s);
  return d.length >= 4 ? d.slice(-4) : '';
}

// Money compared in integer paise so "920", "920.00" and "920.0" are equal and
// float rounding can never make two genuinely-equal amounts disagree.
function amountsEqual(a, b) {
  const na = Number(String(a == null ? '' : a).replace(/[,\s₹]/g, ''));
  const nb = Number(String(b == null ? '' : b).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.round(na * 100) === Math.round(nb * 100);
}

/**
 * @param {object} order    { payment_method, amount_inr, account_number }
 * @param {object|null} extracted  PayoutEvidence.extractedFields, or null if the
 *        trader hasn't captured yet — { amount, last4:string[], recipientLast4 }
 * @returns {{
 *   applicable: boolean,       // is the hard gate in force for this payout?
 *   hardMatch: boolean,        // may the transfer be submitted?
 *   reasons: {code,message}[], // why it's blocked (empty when hardMatch)
 *   expected: object|null,
 *   captured: object|null,
 * }}
 */
function evaluatePayoutMatch(order, extracted) {
  const method = String((order && order.payment_method) || '').toLowerCase();
  const acct = (order && order.account_number) || '';

  // The hard gate applies ONLY to bank-account payouts that carry a real
  // account number to match against. Everything else (UPI-id payouts, or a
  // bank payout somehow missing its account number) is not gated here.
  if (method !== 'bank' || !last4(acct)) {
    return { applicable: false, hardMatch: true, reasons: [], expected: null, captured: null };
  }

  const expected = { amount: order.amount_inr, last4: last4(acct) };

  if (!extracted || typeof extracted !== 'object') {
    return {
      applicable: true,
      hardMatch: false,
      reasons: [{
        code: 'no_capture',
        message: 'Capture your payment success screen first — tap Capture in the overlay on your phone.',
      }],
      expected,
      captured: null,
    };
  }

  const capAmount = extracted.amount != null ? String(extracted.amount) : '';
  const capList = Array.isArray(extracted.last4) ? extracted.last4.map(last4).filter(Boolean) : [];
  const recipLast4 = last4(extracted.recipientLast4);
  if (recipLast4 && !capList.includes(recipLast4)) capList.push(recipLast4);
  const captured = { amount: capAmount, last4: capList };

  const reasons = [];

  let amountMatch = false;
  if (!capAmount) {
    reasons.push({ code: 'amount_not_readable', message: 'The amount could not be read from the success screen — re-capture it.' });
  } else if (amountsEqual(capAmount, expected.amount)) {
    amountMatch = true;
  } else {
    reasons.push({ code: 'amount_mismatch', message: `Amount does not match: this payout is ₹${expected.amount}, but the captured payment is ₹${capAmount}.` });
  }

  let last4Match = false;
  if (capList.length === 0) {
    reasons.push({ code: 'account_not_readable', message: 'No recipient account number was visible on the success screen — re-capture it.' });
  } else if (capList.includes(expected.last4)) {
    last4Match = true;
  } else {
    reasons.push({ code: 'account_mismatch', message: `Recipient account does not match: this payout must go to an account ending ${expected.last4}.` });
  }

  return { applicable: true, hardMatch: amountMatch && last4Match, reasons, expected, captured };
}

module.exports = { evaluatePayoutMatch, _internals: { last4, amountsEqual, digitsOnly } };
