'use strict';

const {
  upsertPayout, removePayout, hasPayout, getPayout, makeEntry, MAX_ACTIVE_PAYOUTS,
} = require('../src/services/payoutList');

const mk = (orderId, over = {}) => makeEntry({
  orderId, amount: '100', accountNumber: '1234', payeeName: 'X', activatedAt: over.at, ...over,
});

describe('payoutList — multi-payout list semantics (Phase 1a / Scenario 10)', () => {
  test('makeEntry normalizes full identity, amount coerced to string', () => {
    const e = makeEntry({ orderId: 42, amount: 500, accountNumber: '9999', ifsc: 'HDFC0001', payeeName: 'Diken' });
    expect(e).toMatchObject({ orderId: '42', amount: '500', accountNumber: '9999', ifsc: 'HDFC0001', payeeName: 'Diken' });
    expect(e.activatedAt instanceof Date).toBe(true);
  });

  test('adds up to 3 distinct payouts', () => {
    let list = [];
    list = upsertPayout(list, mk('A'));
    list = upsertPayout(list, mk('B'));
    list = upsertPayout(list, mk('C'));
    expect(list.map((p) => p.orderId)).toEqual(['A', 'B', 'C']);
  });

  test('re-arming an existing orderId REPLACES it — never duplicates', () => {
    let list = upsertPayout([], mk('A', { amount: '100' }));
    list = upsertPayout(list, mk('A', { amount: '250' })); // same order, new amount
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe('250');
  });

  test('a 4th distinct payout evicts the OLDEST (cap = 3)', () => {
    let list = [];
    list = upsertPayout(list, mk('A', { at: '2026-08-20T10:00:00Z' }));
    list = upsertPayout(list, mk('B', { at: '2026-08-20T10:01:00Z' }));
    list = upsertPayout(list, mk('C', { at: '2026-08-20T10:02:00Z' }));
    list = upsertPayout(list, mk('D', { at: '2026-08-20T10:03:00Z' }));
    expect(list).toHaveLength(MAX_ACTIVE_PAYOUTS);
    expect(list.map((p) => p.orderId).sort()).toEqual(['B', 'C', 'D']); // A (oldest) evicted
  });

  test('removePayout prunes ONE order and leaves the others intact', () => {
    let list = [mk('A'), mk('B'), mk('C')];
    list = removePayout(list, 'B');
    expect(list.map((p) => p.orderId)).toEqual(['A', 'C']);
  });

  test('hasPayout / getPayout find by orderId (string-safe)', () => {
    const list = [mk('A'), mk(7)];
    expect(hasPayout(list, 'A')).toBe(true);
    expect(hasPayout(list, '7')).toBe(true);   // numeric orderId coerced
    expect(hasPayout(list, 'Z')).toBe(false);
    expect(getPayout(list, '7').orderId).toBe('7');
    expect(getPayout(list, 'Z')).toBeNull();
  });

  test('never mutates the input array', () => {
    const orig = [mk('A')];
    const copy = JSON.parse(JSON.stringify(orig));
    upsertPayout(orig, mk('B'));
    removePayout(orig, 'A');
    expect(JSON.parse(JSON.stringify(orig))).toEqual(copy);
  });
});

// The device-ownership check must read the LIST, not a single slot.
jest.mock('../src/models/Device', () => ({}));
jest.mock('../src/models/PayoutLock', () => ({ findOne: jest.fn(async () => null) }));
const PayoutLock = require('../src/models/PayoutLock');
const { isDeviceArmedForOrder } = require('../src/services/payoutLockService');

describe('payoutLockService.isDeviceArmedForOrder — list-aware', () => {
  beforeEach(() => PayoutLock.findOne.mockClear());

  test('armed when the order is ANY entry in activePayouts (no DB hit)', async () => {
    const device = { traderId: 1, activePayouts: [{ orderId: 'A' }, { orderId: 'B' }, { orderId: 'C' }] };
    expect(await isDeviceArmedForOrder(device, 'B')).toBe(true);
    expect(PayoutLock.findOne).not.toHaveBeenCalled();
  });

  test('not armed for an order absent from the list → falls back to the PayoutLock check', async () => {
    const device = { traderId: 1, activePayouts: [{ orderId: 'A' }] };
    expect(await isDeviceArmedForOrder(device, 'Z')).toBe(false);
    expect(PayoutLock.findOne).toHaveBeenCalledWith({ orderId: 'Z', traderId: 1 });
  });

  test('empty / missing list does not throw', async () => {
    expect(await isDeviceArmedForOrder({ traderId: 1, activePayouts: [] }, 'A')).toBe(false);
    expect(await isDeviceArmedForOrder({ traderId: 1 }, 'A')).toBe(false);
  });
});
