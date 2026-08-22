'use strict';

// Redesign Section 3 — the runtime rule store. A promoted code, loaded into the
// matcher's runtime overlay, resolves as Tier-1 (settle-eligible) with NO code
// change — proving "add a bank with no redeploy". Pure (setter, no DB).

const {
  identifyBankFromSender,
  settlementBankCode,
  setRuntimeBankCodes,
} = require('../src/utils/bankSenders');

afterEach(() => setRuntimeBankCodes({})); // never leak overlay state between tests

test('an unrecognised code is null BEFORE promotion', () => {
  expect(identifyBankFromSender('JM-BOMBNK-S')).toBeNull();
  expect(settlementBankCode('JM-BOMBNK-S')).toBeNull();
});

test('after promotion (overlay set) the same code resolves Tier-1 and is settle-eligible', () => {
  setRuntimeBankCodes({ BOMBNK: { name: 'Bank of Maharashtra', logo: 'bank_of_maharashtra.svg' } });
  const r = identifyBankFromSender('JM-BOMBNK-S');
  expect(r).not.toBeNull();
  expect(r.tier).toBe(1);
  expect(r.confident).toBe(true);
  expect(r.name).toBe('Bank of Maharashtra');
  // Tier-1 confident → settlement gate returns the code (admin-confirmed).
  expect(settlementBankCode('JM-BOMBNK-S')).toBe('BOMBNK');
});

test('static table still wins / is unaffected by the overlay', () => {
  setRuntimeBankCodes({ ZZZZZZ: { name: 'Test Bank', logo: null } });
  // A known static bank is unchanged.
  expect(identifyBankFromSender('VK-MAHABK-S').name).toBe('Bank of Maharashtra');
  // The overlay entry resolves too.
  expect(identifyBankFromSender('XX-ZZZZZZ-S').name).toBe('Test Bank');
});

test('clearing the overlay reverts a promoted code to unrecognised', () => {
  setRuntimeBankCodes({ BOMBNK: { name: 'Bank of Maharashtra', logo: null } });
  expect(identifyBankFromSender('JM-BOMBNK-S')).not.toBeNull();
  setRuntimeBankCodes({});
  expect(identifyBankFromSender('JM-BOMBNK-S')).toBeNull();
});
