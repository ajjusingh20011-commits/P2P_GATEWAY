'use strict';

const {
  identifyBankFromSender, settlementBankCode, BANK_BY_SENDER_CODE,
} = require('../src/utils/bankSenders');

describe('identifyBankFromSender — Tier 1 (exact, certain)', () => {
  test('matches a standard XX-YYYYYY header, ignoring the operator prefix', () => {
    expect(identifyBankFromSender('VM-SBIBNK')).toMatchObject({ tier: 1, code: 'SBIBNK', name: 'State Bank of India', confident: true, isBank: true });
    expect(identifyBankFromSender('AX-HDFCBK')).toMatchObject({ tier: 1, code: 'HDFCBK', name: 'HDFC Bank' });
  });

  test('case-insensitive, bare header, trailing suffix, compact, non-6-char headers', () => {
    expect(identifyBankFromSender('vm-sbibnk')).toMatchObject({ tier: 1, name: 'State Bank of India' });
    expect(identifyBankFromSender('HDFCBK')).toMatchObject({ tier: 1, name: 'HDFC Bank' });
    expect(identifyBankFromSender('VM-SBIBNK-S')).toMatchObject({ tier: 1, name: 'State Bank of India' });
    expect(identifyBankFromSender('VMSBIBNK')).toMatchObject({ tier: 1, name: 'State Bank of India' });
    expect(identifyBankFromSender('JD-PAYTM')).toMatchObject({ tier: 1, code: 'PAYTM' });     // 5-char
    expect(identifyBankFromSender('AX-JANASFB')).toMatchObject({ tier: 1, code: 'JANASFB' }); // 7-char
  });
});

describe('identifyBankFromSender — Tier 2 (anchored prefix, inference)', () => {
  test('real variants resolve to their parent bank (HDFCBF→HDFC, SBIPSG→SBI)', () => {
    expect(identifyBankFromSender('AX-HDFCBF')).toMatchObject({ tier: 2, code: 'HDFCBK', name: 'HDFC Bank', confident: false, isBank: true });
    expect(identifyBankFromSender('VM-SBIPSG')).toMatchObject({ tier: 2, code: 'SBIBNK', name: 'State Bank of India', confident: false });
    expect(identifyBankFromSender('JD-ICICIT')).toMatchObject({ tier: 2, code: 'ICICIB' });
  });

  test('a Tier 2 match still carries name + logo for display', () => {
    const r = identifyBankFromSender('AX-HDFCBF');
    expect(r.name).toBe('HDFC Bank');
    expect(r.logo).toBe('hdfc-bank.svg');
    expect(r.tier).toBe(2);
  });
});

describe('identifyBankFromSender — anchored, NOT substring (collision safety)', () => {
  test('a header CONTAINING but not STARTING with a prefix does not match ("MERCAN" ≠ Canara)', () => {
    // "CAN" sits inside MERCAN but MERCAN.startsWith(a Canara prefix) is false.
    expect(identifyBankFromSender('VM-MERCAN')).toBeNull();
  });
  test('a bank name embedded mid-token is not a match', () => {
    expect(identifyBankFromSender('VM-XXSBIYY')).toBeNull(); // SBI not at the start
  });
});

describe('identifyBankFromSender — Tier 3 (blacklist traps, non-bank)', () => {
  test('CANFIN → Can Fin Homes, never Canara Bank', () => {
    const r = identifyBankFromSender('JD-CANFIN');
    expect(r).toMatchObject({ tier: 3, isBank: false, confident: false, code: null, name: 'Can Fin Homes' });
  });
  test('MAHAGO → a govt service, never Bank of Maharashtra', () => {
    const r = identifyBankFromSender('VM-MAHAGO');
    expect(r).toMatchObject({ tier: 3, isBank: false, name: 'Maharashtra Govt' });
  });
  test('the blacklist is evaluated BEFORE prefix matching (a trap never falls through)', () => {
    // Were the blacklist skipped, MAHAGO could hit a Maharashtra prefix.
    expect(identifyBankFromSender('VM-MAHAGO').isBank).toBe(false);
  });
});

describe('identifyBankFromSender — no match', () => {
  test('returns null for a genuinely unknown / promo sender', () => {
    expect(identifyBankFromSender('AD-PROMO01')).toBeNull();
    expect(identifyBankFromSender('VM-ZZZZZZ')).toBeNull();
    expect(identifyBankFromSender('')).toBeNull();
    expect(identifyBankFromSender(null)).toBeNull();
  });
});

describe('settlementBankCode — ONLY Tier 1 may auto-settle money (BUG-58 refinement)', () => {
  test('Tier 1 exact → returns the code (settle-eligible)', () => {
    expect(settlementBankCode('VM-SBIBNK')).toBe('SBIBNK');
    expect(settlementBankCode('AX-HDFCBK')).toBe('HDFCBK');
  });
  test('Tier 2 prefix inference → null (HOLD, not auto-settle)', () => {
    expect(settlementBankCode('AX-HDFCBF')).toBeNull();
    expect(settlementBankCode('VM-SBIPSG')).toBeNull();
  });
  test('Tier 3 blacklist → null (never settles)', () => {
    expect(settlementBankCode('JD-CANFIN')).toBeNull();
    expect(settlementBankCode('VM-MAHAGO')).toBeNull();
  });
  test('no match → null (hold)', () => {
    expect(settlementBankCode('AD-PROMO01')).toBeNull();
  });
});

describe('table integrity', () => {
  test('all 45 verified headers present, and each round-trips as Tier 1', () => {
    expect(Object.keys(BANK_BY_SENDER_CODE)).toHaveLength(45);
    const prefixes = ['VM', 'AX', 'JD', 'VK', 'BP', 'BZ'];
    Object.keys(BANK_BY_SENDER_CODE).forEach((code, i) => {
      const r = identifyBankFromSender(`${prefixes[i % prefixes.length]}-${code}`);
      expect(r).toMatchObject({ tier: 1, code, name: BANK_BY_SENDER_CODE[code].name });
      expect(settlementBankCode(`${prefixes[i % prefixes.length]}-${code}`)).toBe(code);
    });
  });
});
