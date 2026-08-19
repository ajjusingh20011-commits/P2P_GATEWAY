'use strict';

const { resolveReceivingUpis } = require('../src/services/matchingEngineV2');

// BUG-58 — a payment landing on one sibling account must never settle an order
// on a DIFFERENT sibling that shares the same physical device. resolveReceivingUpis
// is the pure decision at the heart of the fix: given the device's accounts and
// the platform the capture identifies, either return the exact UPI(s) to match
// against, or refuse (hold) rather than guess.
describe('resolveReceivingUpis (BUG-58 sibling disambiguation)', () => {
  // The exact reported setup: device "oppo ckb" backs a Paytm and a GPay account.
  const paytm = { upi_id: 'paytmqr6r1aem@ptys', account_type: 'paytm' };
  const gpay = { upi_id: 'gpay-12197830319@okbizaxis', account_type: 'gpay' };
  const siblings = [paytm, gpay];

  test('THE REPORTED BUG: a GPay payment resolves ONLY to the GPay UPI, never the Paytm sibling', () => {
    const r = resolveReceivingUpis(siblings, 'gpay');
    expect(r.refuse).toBeUndefined();
    expect(r.upiIds).toEqual(['gpay-12197830319@okbizaxis']);
    // Critically, the Paytm UPI is NOT in the match set — so the open Paytm ₹21
    // order can no longer be settled by a GPay payment.
    expect(r.upiIds).not.toContain('paytmqr6r1aem@ptys');
  });

  test('a Paytm payment resolves only to the Paytm UPI', () => {
    const r = resolveReceivingUpis(siblings, 'paytm');
    expect(r.upiIds).toEqual(['paytmqr6r1aem@ptys']);
    expect(r.upiIds).not.toContain('gpay-12197830319@okbizaxis');
  });

  test('single-account device: unchanged behaviour, no ambiguity (settles as before)', () => {
    expect(resolveReceivingUpis([paytm], 'paytm').upiIds).toEqual(['paytmqr6r1aem@ptys']);
    // Even with an unknown platform, a lone account is unambiguous.
    expect(resolveReceivingUpis([paytm], null).upiIds).toEqual(['paytmqr6r1aem@ptys']);
  });

  test('empty device (no linked accounts): returns empty, so caller falls through to trader-wide guard', () => {
    expect(resolveReceivingUpis([], 'gpay')).toEqual({ upiIds: [] });
    expect(resolveReceivingUpis([], null)).toEqual({ upiIds: [] });
  });

  test('siblings + unknown platform (SMS / unresolved app): REFUSE, do not guess', () => {
    const r = resolveReceivingUpis(siblings, null);
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('ambiguous_sibling_accounts');
  });

  test('siblings + a platform none of them use: REFUSE (money hit an unlinked account)', () => {
    const r = resolveReceivingUpis(siblings, 'phonepe');
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('receiving_platform_not_linked');
  });

  test('two SAME-platform siblings: indistinguishable from a notification -> REFUSE', () => {
    const gpayA = { upi_id: 'gpayA@okaxis', account_type: 'gpay' };
    const gpayB = { upi_id: 'gpayB@okhdfcbank', account_type: 'gpay' };
    const r = resolveReceivingUpis([gpayA, gpayB], 'gpay');
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('ambiguous_same_platform_siblings');
  });

  test('three siblings, one matching platform: resolves to exactly that one', () => {
    const airtel = { upi_id: 'x@airtel', account_type: 'airtel' };
    const r = resolveReceivingUpis([paytm, gpay, airtel], 'airtel');
    expect(r.upiIds).toEqual(['x@airtel']);
  });

  test('never returns a guess: a refusal always carries a reason and no upiIds', () => {
    const r = resolveReceivingUpis(siblings, null);
    expect(r.upiIds).toBeUndefined();
    expect(typeof r.reason).toBe('string');
  });
});

// The SMS half — a bank credit SMS names the BANK, matched against the bank the
// trader DECLARED for each account (bank_name -> canonical code). Signature:
// resolveReceivingUpis(deviceAccounts, receivingPlatform=null, receivingBankCode).
describe('resolveReceivingUpis — SMS bank disambiguation (BUG-58 SMS half)', () => {
  const hdfc = { upi_id: 'x@okhdfcbank', account_type: 'gpay', bank_name: 'HDFC Bank' };
  const sbi = { upi_id: 'y@oksbi', account_type: 'gpay', bank_name: 'SBI' }; // abbreviation on purpose
  const siblings = [hdfc, sbi];

  test('an HDFC SMS settles the HDFC-declared sibling, never the SBI sibling', () => {
    const r = resolveReceivingUpis(siblings, null, 'HDFCBK');
    expect(r.upiIds).toEqual(['x@okhdfcbank']);
    expect(r.upiIds).not.toContain('y@oksbi');
  });

  test('reconciliation works: an SBIBNK SMS matches the account declared "SBI" (abbreviation)', () => {
    const r = resolveReceivingUpis(siblings, null, 'SBIBNK');
    expect(r.upiIds).toEqual(['y@oksbi']);
  });

  test('SMS bank matching NO declared sibling: hold (receiving_bank_not_linked)', () => {
    const r = resolveReceivingUpis(siblings, null, 'ICICIB');
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('receiving_bank_not_linked');
  });

  test('all siblings have a BLANK bank_name: hold, never guess', () => {
    const blanks = [
      { upi_id: 'a@x', account_type: 'gpay', bank_name: '' },
      { upi_id: 'b@y', account_type: 'gpay', bank_name: null },
    ];
    const r = resolveReceivingUpis(blanks, null, 'HDFCBK');
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('receiving_bank_not_linked');
  });

  test('one sibling matches, the other is blank: still resolves to the clear match', () => {
    const mixed = [hdfc, { upi_id: 'b@y', account_type: 'gpay', bank_name: '' }];
    const r = resolveReceivingUpis(mixed, null, 'HDFCBK');
    expect(r.upiIds).toEqual(['x@okhdfcbank']);
  });

  test('two siblings declared the SAME bank: indistinguishable by SMS -> hold', () => {
    const twoHdfc = [
      { upi_id: 'a@okhdfcbank', account_type: 'gpay', bank_name: 'HDFC Bank' },
      { upi_id: 'b@okhdfcbank', account_type: 'paytm', bank_name: 'HDFC Bank' },
    ];
    const r = resolveReceivingUpis(twoHdfc, null, 'HDFCBK');
    expect(r.refuse).toBe(true);
    expect(r.reason).toBe('ambiguous_same_bank_siblings');
  });

  test('single-account device with a bank SMS: unchanged, settles (no ambiguity)', () => {
    const r = resolveReceivingUpis([hdfc], null, 'HDFCBK');
    expect(r.upiIds).toEqual(['x@okhdfcbank']);
  });
});
