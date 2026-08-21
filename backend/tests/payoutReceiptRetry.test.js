'use strict';

// matchCapturedEvidence — the global receipt single-use lock must block reuse of
// a receipt for a DIFFERENT payout, while a good-faith RETRY of the same receipt
// for the SAME still-active payout succeeds cleanly (never a false rejection).

const mockReceipt = { findOne: jest.fn(), create: jest.fn() };
const mockRequest = { findAll: jest.fn() };

jest.mock('../src/utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('../src/websocket', () => ({ emitToAdmin: () => {}, emitToMerchant: () => {}, emitToTrader: () => {}, broadcast: () => {} }));
jest.mock('../src/services/settingsService', () => ({}));
jest.mock('../src/services/balanceService', () => ({}));
jest.mock('../src/services/ngoServiceAuth', () => ({ internalAuthHeaders: () => ({}) }));
jest.mock('axios', () => ({ post: async () => ({ data: {} }), get: async () => ({ data: {} }) }));
jest.mock('../src/models', () => ({
  PayoutReceipt: mockReceipt,
  PayoutRequest: mockRequest,
}));

const payoutService = require('../src/services/payoutService');

const UTR = '919634090229'; // well-formed → globally locked
const orderA = { uuid: 'A', payment_method: 'bank', amount_inr: 500, account_number: '111122223333' };
const orderB = { uuid: 'B', payment_method: 'bank', amount_inr: 500, account_number: '444455553333' };
const capture = { amount: '500', last4: ['3333'], utr: UTR };

beforeEach(() => {
  mockReceipt.findOne.mockReset();
  mockReceipt.create.mockReset();
  mockRequest.findAll.mockReset();
});

test('fresh capture, single match → matched + receipt consumed', async () => {
  mockRequest.findAll.mockResolvedValue([orderA]);
  mockReceipt.findOne.mockResolvedValue(null);
  mockReceipt.create.mockResolvedValue({});
  const r = await payoutService.matchCapturedEvidence(7, capture);
  expect(r.matched).toBe(true);
  expect(r.orderId).toBe('A');
  expect(mockReceipt.create).toHaveBeenCalledTimes(1);
});

test('RETRY: same receipt + same still-active payout → clean success, no re-consume', async () => {
  mockRequest.findAll.mockResolvedValue([orderA]);
  mockReceipt.findOne.mockResolvedValue({ receipt_id: UTR, order_uuid: 'A' });
  const r = await payoutService.matchCapturedEvidence(7, capture);
  expect(r.matched).toBe(true);
  expect(r.reason).toBeUndefined();
  expect(r.orderId).toBe('A');
  expect(mockReceipt.create).not.toHaveBeenCalled();
});

test('REUSE: same receipt for a DIFFERENT payout → blocked as reused', async () => {
  // The original payout 'A' is gone (settled); only 'B' is in-process now.
  mockRequest.findAll.mockResolvedValue([orderB]);
  mockReceipt.findOne.mockResolvedValue({ receipt_id: UTR, order_uuid: 'A' });
  const r = await payoutService.matchCapturedEvidence(7, capture);
  expect(r.matched).toBe(false);
  expect(r.reason).toBe('receipt_reused');
});

test('RACE: create loses to a concurrent same-payout retry → resolves to success', async () => {
  mockRequest.findAll.mockResolvedValue([orderA]);
  mockReceipt.findOne
    .mockResolvedValueOnce(null)                              // pre-check: not yet consumed
    .mockResolvedValueOnce({ receipt_id: UTR, order_uuid: 'A' }); // post-dup re-read
  mockReceipt.create.mockRejectedValue(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
  const r = await payoutService.matchCapturedEvidence(7, capture);
  expect(r.matched).toBe(true);
  expect(r.orderId).toBe('A');
});

test('no well-formed UTR → no global lock, plain content match still works', async () => {
  mockRequest.findAll.mockResolvedValue([orderA]);
  mockReceipt.findOne.mockResolvedValue(null);
  const r = await payoutService.matchCapturedEvidence(7, { amount: '500', last4: ['3333'], utr: '123' });
  expect(r.matched).toBe(true);
  expect(mockReceipt.findOne).not.toHaveBeenCalled(); // key was '' → lock skipped
  expect(mockReceipt.create).not.toHaveBeenCalled();
});
