/**
 * Regression test — smartMerge.confirmOrder settles BEFORE it marks success.
 *
 * The bug: confirmOrder set status='success' first, then ran settlement in a
 * try/catch that swallowed failures as "non-fatal". A settlement failure (e.g.
 * the trader has insufficient USDT balance) therefore left a 'success' order
 * with NULL financial fields and no money moved — a half-settled success that
 * later fed the (now fallback-free) commission math as un-valuable history.
 *
 * The fix: settle first. Only if settleOrder succeeds does the order flip to
 * 'success'. If settlement throws, the order stays in its pre-confirm status,
 * an admin alert is emitted, and the error propagates (confirmOrderV2 already
 * try/catches it, so manual confirms report the real reason).
 *
 * These guardrails are money-integrity critical — do not loosen them.
 */

// jest.mock factories are hoisted; closed-over vars must be "mock"-prefixed.
const mockEvents = [];
const mockAdminEmits = [];
let mockSettleImpl = async () => ({});

jest.mock('../src/utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));

jest.mock('../src/services/balanceService', () => ({
  settleOrder: async (order) => {
    mockEvents.push('settle');
    return mockSettleImpl(order);
  },
}));

jest.mock('../src/services/routingEngine', () => ({ releaseTrader: async () => {} }));
jest.mock('../src/services/webhookService', () => ({ sendWebhook: async () => {} }));
jest.mock('../src/services/telegramService', () => ({ sendPayInNotification: async () => {} }));

jest.mock('../src/websocket', () => ({
  emitToTrader: () => {},
  emitToMerchant: () => {},
  emitToAdmin: (ev, payload) => { mockAdminEmits.push({ ev, payload }); },
  emitToOrder: () => {},
}));

jest.mock('../src/models', () => ({
  Order: { ACTIVE_STATUSES: ['pending', 'checkout_open', 'claimed_paid', 'under_review'] },
  Transaction: { update: async () => {} },
  PaymentDetail: { increment: async () => {} },
  Trader: { increment: async () => {}, findByPk: async () => ({ balance_usdt: 100 }) },
}));

const smartMerge = require('../src/services/smartMerge');

const makeOrder = () => ({
  id: 42,
  uuid: 'order-uuid-42',
  gateway_order_id: 'gw-42',
  status: 'claimed_paid',
  trader_id: 7,
  merchant_id: 3,
  payment_detail_id: 11,
  amount_inr: 1000,
  confirmed_at: null,
  async update(fields) {
    Object.assign(this, fields);
    if (fields.status === 'success') mockEvents.push('status:success');
    return this;
  },
});

const SUCCESS_FEES = {
  trader_deduction_usdt: 9.5,
  trader_rate: 105,
  merchant_receives_usdt: 9.8,
  platform_profit_usdt: 0.3,
};

beforeEach(() => {
  mockEvents.length = 0;
  mockAdminEmits.length = 0;
  mockSettleImpl = async () => SUCCESS_FEES;
});

test('settlement runs BEFORE the order is marked success', async () => {
  const order = makeOrder();
  await smartMerge.confirmOrder(order, { utrNumber: 'UTR123', engine: 'apk_notification' });

  expect(order.status).toBe('success');
  // The critical ordering: settle first, success second.
  expect(mockEvents).toEqual(['settle', 'status:success']);
});

test('a failed settlement does NOT mark success and does not swallow the error', async () => {
  mockSettleImpl = async () => {
    throw Object.assign(new Error('Trader insufficient balance'), { status: 422 });
  };
  const order = makeOrder();

  await expect(
    smartMerge.confirmOrder(order, { utrNumber: 'UTR123', engine: 'apk_notification' })
  ).rejects.toThrow('Trader insufficient balance');

  // Never a half-settled success.
  expect(order.status).toBe('claimed_paid');
  expect(mockEvents).not.toContain('status:success');
  // Admin is alerted to the stuck settlement.
  expect(mockAdminEmits.some((e) => e.ev === 'order:settlement_failed')).toBe(true);
});

test('an already-success order is a no-op (idempotent, never re-settles)', async () => {
  const order = makeOrder();
  order.status = 'success';
  await smartMerge.confirmOrder(order, { utrNumber: 'UTR123', engine: 'apk_notification' });
  expect(mockEvents).not.toContain('settle');
});
