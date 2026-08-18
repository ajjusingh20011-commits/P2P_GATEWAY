/**
 * Regression test — payout-evidence device-ownership + first-submission-
 * wins lock (payoutLockService). Guards: (1) a device never armed for an
 * orderId can't submit evidence for it; (2) the FIRST accepted submission
 * locks the order and clears every other device's activePayout for it;
 * (3) a second submission from a DIFFERENT device is rejected; (4) a
 * follow-up from the SAME device that won the lock (e.g. a late-arriving
 * SMS) is accepted normally.
 *
 * A trader with several linked devices must never be able to get a payout
 * evidence double-submitted, and other devices must stop showing the
 * payout as active once it's actually done. Do not loosen these
 * assertions. PayoutLock's mock below simulates Mongo's real unique-index
 * E11000 behavior on orderId — that IS the mechanism under test, not
 * incidental plumbing.
 */
const mockDeviceUpdateManyCalls = [];
jest.mock('../src/models/Device', () => ({
  updateMany: async (filter, update) => {
    mockDeviceUpdateManyCalls.push({ filter, update });
    return { modifiedCount: 0 };
  },
}));

let mockLocks; // orderId -> { orderId, deviceId, traderId }
jest.mock('../src/models/PayoutLock', () => ({
  create: async (doc) => {
    if (mockLocks[doc.orderId]) {
      const err = new Error('E11000 duplicate key');
      err.code = 11000;
      throw err;
    }
    mockLocks[doc.orderId] = { ...doc };
    return { ...doc };
  },
  findOne: async (query) => {
    const lock = mockLocks[query.orderId];
    if (!lock) return null;
    if (query.traderId != null && lock.traderId !== query.traderId) return null;
    return lock;
  },
}));

const {
  isDeviceArmedForOrder,
  attemptSubmissionLock,
  clearOtherDevices,
} = require('../src/services/payoutLockService');

beforeEach(() => {
  mockLocks = {};
  mockDeviceUpdateManyCalls.length = 0;
});

test('device never armed for this orderId is rejected', async () => {
  const device = { deviceId: 'dev-x', traderId: 7, activePayout: null };
  expect(await isDeviceArmedForOrder(device, 'order-1')).toBe(false);
});

test('first evidence submission from a correctly-armed device is accepted, and clears every other device', async () => {
  const device = { deviceId: 'dev-A', traderId: 7, activePayout: { orderId: 'order-1' } };
  expect(await isDeviceArmedForOrder(device, 'order-1')).toBe(true);

  const lock = await attemptSubmissionLock('order-1', 'dev-A', 7);
  expect(lock.allowed).toBe(true);
  expect(lock.isFirstSubmission).toBe(true);

  await clearOtherDevices(7, 'dev-A', 'order-1');
  expect(mockDeviceUpdateManyCalls).toHaveLength(1);
  expect(mockDeviceUpdateManyCalls[0].filter).toMatchObject({
    traderId: 7,
    deviceId: { $ne: 'dev-A' },
    'activePayout.orderId': 'order-1',
  });
  expect(mockDeviceUpdateManyCalls[0].update).toEqual({ activePayout: null });
});

test('second submission from a DIFFERENT device after the first succeeded is rejected', async () => {
  await attemptSubmissionLock('order-1', 'dev-A', 7);

  // dev-B's own activePayout for order-1 may already be cleared by dev-A's
  // win — that's the point — but a PayoutLock now exists under trader 7,
  // so ownership still resolves true, distinguishing "already submitted
  // elsewhere" (409) from "never armed at all" (403).
  const deviceB = { deviceId: 'dev-B', traderId: 7, activePayout: null };
  expect(await isDeviceArmedForOrder(deviceB, 'order-1')).toBe(true);

  const lock = await attemptSubmissionLock('order-1', 'dev-B', 7);
  expect(lock.allowed).toBe(false);
  expect(lock.lockedByDeviceId).toBe('dev-A');
});

test('follow-up submission from the SAME device that won the lock is accepted normally', async () => {
  await attemptSubmissionLock('order-1', 'dev-A', 7);
  const lock = await attemptSubmissionLock('order-1', 'dev-A', 7);
  expect(lock.allowed).toBe(true);
});
