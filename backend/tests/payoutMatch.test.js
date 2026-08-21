'use strict';

const { evaluatePayoutMatch } = require('../src/utils/payoutMatch');

// Feature 2 — the active "I have transferred" submission gate evaluator. The
// same pure function enforces the block server-side (payoutService.transferred)
// and drives the trader panel's button; these cases pin the money-path rules:
// amount + account last-4 exact for bank payouts, UPI payouts not gated, name
// never blocks.
describe('evaluatePayoutMatch (payout submission gate)', () => {
  const bankOrder = { payment_method: 'bank', amount_inr: 920, account_number: '123456784521' };

  test('exact amount + a matching captured last-4 -> submittable', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '920', last4: ['4521'] });
    expect(v.applicable).toBe(true);
    expect(v.hardMatch).toBe(true);
    expect(v.reasons).toHaveLength(0);
  });

  test('decimal-formatted amount ("920.00") still equals 920', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '920.00', last4: ['4521'] });
    expect(v.hardMatch).toBe(true);
  });

  test('wrong amount blocks with amount_mismatch', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '9200', last4: ['4521'] });
    expect(v.hardMatch).toBe(false);
    expect(v.reasons.some((r) => r.code === 'amount_mismatch')).toBe(true);
  });

  test('right amount but wrong account (the BUG-58 sibling case) blocks', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '920', last4: ['9999'] });
    expect(v.hardMatch).toBe(false);
    expect(v.reasons.some((r) => r.code === 'account_mismatch')).toBe(true);
  });

  test('recipientLast4 (fallback when no name shown) satisfies the account check', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '920', last4: [], recipientLast4: '4521' });
    expect(v.hardMatch).toBe(true);
  });

  test('no capture yet -> blocked with no_capture (the default disabled state)', () => {
    const v = evaluatePayoutMatch(bankOrder, null);
    expect(v.applicable).toBe(true);
    expect(v.hardMatch).toBe(false);
    expect(v.reasons.some((r) => r.code === 'no_capture')).toBe(true);
  });

  test('amount unreadable -> blocked with its own distinct reason', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '', last4: ['4521'] });
    expect(v.hardMatch).toBe(false);
    expect(v.reasons.some((r) => r.code === 'amount_not_readable')).toBe(true);
  });

  test('UPI-id payout is NOT gated (applicable:false, never blocks)', () => {
    const upiOrder = { payment_method: 'upi', amount_inr: 920, account_number: null, upi_id: 'x@y' };
    const v = evaluatePayoutMatch(upiOrder, { amount: '1', last4: ['0000'] });
    expect(v.applicable).toBe(false);
    expect(v.hardMatch).toBe(true);
  });

  test('bank payout with no account number on file -> not gated', () => {
    const v = evaluatePayoutMatch({ payment_method: 'bank', amount_inr: 920, account_number: '' }, null);
    expect(v.applicable).toBe(false);
    expect(v.hardMatch).toBe(true);
  });

  test('both hard fields wrong -> both reasons reported', () => {
    const v = evaluatePayoutMatch(bankOrder, { amount: '10', last4: ['1111'] });
    expect(v.hardMatch).toBe(false);
    expect(v.reasons.some((r) => r.code === 'amount_mismatch')).toBe(true);
    expect(v.reasons.some((r) => r.code === 'account_mismatch')).toBe(true);
  });
});

// REDESIGN — server-authoritative resolution (which in_processing payout a
// capture belongs to) + the global receipt single-use key.
const { resolvePayoutMatches, receiptKey, isWellFormedReceiptId } = require('../src/utils/payoutMatch');

describe('resolvePayoutMatches (which payout does a capture belong to)', () => {
  const A = { uuid: 'A', payment_method: 'bank', amount_inr: 500, account_number: '111122223333' };
  const B = { uuid: 'B', payment_method: 'bank', amount_inr: 920, account_number: '999988887777' };
  const C = { uuid: 'C', payment_method: 'bank', amount_inr: 500, account_number: '555544443333' };

  test('picks the single matching payout among several', () => {
    const m = resolvePayoutMatches([A, B, C], { amount: '920', last4: ['7777'] });
    expect(m.map((o) => o.uuid)).toEqual(['B']);
  });

  test('no match -> empty (Invalid Receipt)', () => {
    expect(resolvePayoutMatches([A, B, C], { amount: '999', last4: ['0000'] })).toHaveLength(0);
  });

  test('same amount + same last-4 -> tie (both returned, forces review)', () => {
    const A2 = { uuid: 'A', payment_method: 'bank', amount_inr: 500, account_number: '111122223333' };
    const D = { uuid: 'D', payment_method: 'bank', amount_inr: 500, account_number: '444422223333' };
    expect(resolvePayoutMatches([A2, D], { amount: '500', last4: ['3333'] }).map((o) => o.uuid)).toEqual(['A', 'D']);
  });

  test('UPI payout resolves on amount alone', () => {
    const U1 = { uuid: 'U1', payment_method: 'upi', amount_inr: 500, upi_id: 'x@bank' };
    const U2 = { uuid: 'U2', payment_method: 'upi', amount_inr: 920, upi_id: 'y@bank' };
    expect(resolvePayoutMatches([U1, U2], { amount: '920', last4: [] }).map((o) => o.uuid)).toEqual(['U2']);
  });
});

describe('receiptKey / isWellFormedReceiptId (global single-use lock key)', () => {
  test('a real 12-digit UTR is well-formed and used', () => {
    expect(isWellFormedReceiptId('919634090229')).toBe(true);
    expect(receiptKey({ utr: '919634090229' })).toBe('919634090229');
  });
  test('short / non-numeric tokens are NOT locked (fall back to content match)', () => {
    expect(isWellFormedReceiptId('12345')).toBe(false);
    expect(isWellFormedReceiptId('ABCDEFGHIJKL')).toBe(false); // no digit
    expect(receiptKey({ utr: '12345', transactionId: 'x' })).toBe('');
  });
  test('falls back to a well-formed transaction id when no UTR', () => {
    expect(receiptKey({ utr: '', transactionId: 'T260820205229597621870B' })).toBe('T260820205229597621870B');
  });
});
