'use strict';

const { canonicalBankCode, CODE_TO_NAME } = require('../src/utils/bankIdentity');

describe('canonicalBankCode (BUG-58 declared bank_name -> DLT code reconciliation)', () => {
  test('resolves canonical bank names verbatim', () => {
    expect(canonicalBankCode('HDFC Bank')).toBe('HDFCBK');
    expect(canonicalBankCode('State Bank of India')).toBe('SBIBNK');
    expect(canonicalBankCode('Kerala Gramin Bank')).toBe('KGBBNK');
  });

  test('resolves the picker abbreviations that differ from the SMS table (the reconciliation)', () => {
    expect(canonicalBankCode('SBI')).toBe('SBIBNK');
    expect(canonicalBankCode('PNB')).toBe('PNBSMS');
  });

  test('resolves the merchant-app labels a trader may have declared', () => {
    expect(canonicalBankCode('GPay Business')).toBe('GPAYBZ');
    expect(canonicalBankCode('Paytm Business')).toBe('PAYTM');
    expect(canonicalBankCode('PhonePe Business')).toBe('PHONEP');
    expect(canonicalBankCode('BharatPe Business')).toBe('BHRTPE');
  });

  test('is case- and punctuation-insensitive', () => {
    expect(canonicalBankCode('hdfc bank')).toBe('HDFCBK');
    expect(canonicalBankCode('J&K Bank')).toBe('JKBBNK');
    expect(canonicalBankCode('j k bank')).toBe('JKBBNK');
    expect(canonicalBankCode('PUNJAB & SIND BANK')).toBe('PSBBNK');
  });

  test('returns null (caller must hold, not guess) for blank or unknown names', () => {
    expect(canonicalBankCode('')).toBeNull();
    expect(canonicalBankCode(null)).toBeNull();
    expect(canonicalBankCode(undefined)).toBeNull();
    expect(canonicalBankCode('AU Bank')).toBeNull(); // no DLT code in the table
    expect(canonicalBankCode('Some Random Bank')).toBeNull();
  });

  // DRIFT GUARD — the two packages carry the same DLT vocabulary in two files
  // (ngo-backend sender->code, gateway name->code). This fails loudly if they
  // ever diverge, e.g. a code added to one and not the other.
  test('gateway code set matches the ngo-backend SMS table exactly', () => {
    const { BANK_BY_SENDER_CODE } = require('../../ngo-backend/src/utils/bankSenders');
    const gatewayCodes = Object.keys(CODE_TO_NAME).sort();
    const smsCodes = Object.keys(BANK_BY_SENDER_CODE).sort();
    expect(gatewayCodes).toEqual(smsCodes);
    // And every canonical name round-trips back to its own code.
    for (const [code, name] of Object.entries(CODE_TO_NAME)) {
      expect(canonicalBankCode(name)).toBe(code);
      // The SMS table's name for the same code must resolve to the same code too.
      expect(canonicalBankCode(BANK_BY_SENDER_CODE[code].name)).toBe(code);
    }
  });
});
