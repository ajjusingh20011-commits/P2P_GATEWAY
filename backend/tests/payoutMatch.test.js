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
