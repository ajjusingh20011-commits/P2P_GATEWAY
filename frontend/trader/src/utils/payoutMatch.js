// Payout evidence match evaluator — trader-panel mirror of the gateway's
// canonical backend/src/utils/payoutMatch.js. This copy drives the "I have
// transferred" button (enable/disable + the reason shown to the trader); the
// gateway runs the identical logic to ENFORCE the block server-side, so a
// bypassed button still can't submit a mismatched transfer. Keep the two in
// lockstep — same rules, same reason codes.
//
// Bank-account payouts only: amount + recipient account last-4 must match
// exactly. UPI-id payouts have no masked account to match, so they are not
// gated here (applicable:false).

function digitsOnly(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function last4(s) {
  const d = digitsOnly(s);
  return d.length >= 4 ? d.slice(-4) : '';
}

function amountsEqual(a, b) {
  const na = Number(String(a == null ? '' : a).replace(/[,\s₹]/g, ''));
  const nb = Number(String(b == null ? '' : b).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.round(na * 100) === Math.round(nb * 100);
}

// order: { payment_method, amount_inr, account_number }
// extracted: PayoutEvidence.extractedFields | null
export function evaluatePayoutMatch(order, extracted) {
  const method = String((order && order.payment_method) || '').toLowerCase();
  const acct = (order && order.account_number) || '';

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
