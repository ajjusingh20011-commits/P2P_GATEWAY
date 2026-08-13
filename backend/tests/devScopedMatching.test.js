/**
 * Regression test — device-scoped order matching (matchingEngineV2).
 *
 * Guards a subtle money-correctness bug: for a notification-only receiver event
 * (no UPI, no UTR), matching used to resolve the trader's ENTIRE UPI set and
 * disambiguate purely by time — so a ₹20 payment that landed on the device's
 * UPI A could settle a same-amount open order sitting on the trader's OTHER
 * UPI B. The fix resolves the specific UPI(s) the event's DEVICE collects on
 * first (payment_details.ngo_device_id), falling back to trader-wide only when
 * the device isn't linked to any UPI.
 *
 * This exercises the REAL matchingEngineV2.matchAndSettle. Only the data layer
 * (Sequelize models) and the money-moving smartMerge.confirmOrder are mocked —
 * every decision about which UPIs to search and which order wins is real code.
 *
 * If this ever fails after a matching-engine refactor, the wrong-match has
 * silently returned: a payer's order stays open while an unrelated order on a
 * different UPI is marked paid. Do not "fix" it by loosening the assertions.
 */
const { Op } = require('sequelize');

// jest.mock factories are hoisted above imports and may only close over
// variables whose names begin with "mock" — hence these names.
let mockPds = [];
let mockOrders = [];
const mockSettled = [];

jest.mock('../src/utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));

jest.mock('../src/services/smartMerge', () => ({
  // Records the settled order id instead of moving real money.
  confirmOrder: async (order) => { mockSettled.push(order.id); },
}));

jest.mock('../src/models', () => {
  const { Op: SeqOp } = require('sequelize');
  const wrap = (o) => ({
    ...o,
    paymentDetail: { upi_id: o.upi_id },
    async update(fields) { Object.assign(o, fields); Object.assign(this, fields); return this; },
  });
  return {
    // Faithful emulation of exactly the two queries the engine runs.
    PaymentDetail: {
      findAll: async ({ where }) => mockPds
        .filter((p) =>
          (!('ngo_device_id' in where) || p.ngo_device_id === where.ngo_device_id) &&
          (!('trader_id' in where) || p.trader_id === where.trader_id))
        .map((p) => ({ upi_id: p.upi_id })),
    },
    Order: {
      ACTIVE_STATUSES: ['pending', 'checkout_open', 'claimed_paid', 'under_review'],
      findAll: async ({ where, include }) => {
        const statuses = where.status[SeqOp.in];
        const amount = Number(where.amount_inr);
        const upiIds = include[0].where.upi_id[SeqOp.in];
        return mockOrders
          .filter((o) => statuses.includes(o.status) && Number(o.amount_inr) === amount && upiIds.includes(o.upi_id))
          .map(wrap);
      },
      findOne: async ({ where }) => {
        const f = mockOrders.find((o) => o.status === 'success' && o.utr_number === where.utr_number);
        return f ? wrap(f) : null;
      },
    },
    UtrDiscrepancyLog: { create: async () => ({}) },
  };
});

const engine = require('../src/services/matchingEngineV2');

const EVENT_TIME = '2026-08-12T01:23:30Z'; // when the ₹ notification fired

// Two same-amount open orders on two different UPIs of the SAME trader; the
// order on UPI B was created closer to the event time (so a time-only
// disambiguation would wrongly pick it).
function twoUpiTwentyRupeeOrders() {
  mockPds = [
    { id: 1, trader_id: 1, upi_id: 'a@okaxis', ngo_device_id: 'DEV-A' },
    { id: 2, trader_id: 1, upi_id: 'b@okhdfc', ngo_device_id: 'DEV-B' },
  ];
  mockOrders = [
    { id: 1001, status: 'pending', amount_inr: 20, upi_id: 'a@okaxis', created_at: '2026-08-12T01:21:00Z', donor_submitted_utr: null },
    { id: 1002, status: 'pending', amount_inr: 20, upi_id: 'b@okhdfc', created_at: '2026-08-12T01:23:10Z', donor_submitted_utr: null },
  ];
}

async function settle(event) {
  mockSettled.length = 0;
  const result = await engine.matchAndSettle(event);
  return { result, settledOrderId: mockSettled[0] ?? null };
}

beforeEach(() => { mockPds = []; mockOrders = []; mockSettled.length = 0; });

describe('matchingEngineV2 — device-scoped resolution (wrong-match regression)', () => {
  test('money on the device\'s UPI A settles A\'s order, not the trader\'s same-amount order on UPI B', async () => {
    twoUpiTwentyRupeeOrders();
    const { result, settledOrderId } = await settle({
      deviceId: 'DEV-A', traderId: 1, amount: 20, utr: '', eventTimestamp: EVENT_TIME, source: 'apk_notification',
    });
    expect(settledOrderId).toBe(1001);
    expect(result).toMatchObject({ matched: true, order_id: 1001 });
  });

  test('without a device id (pre-fix, trader-wide) it wrong-matches UPI B — the exact bug this scoping prevents', async () => {
    twoUpiTwentyRupeeOrders();
    const { settledOrderId } = await settle({
      traderId: 1, amount: 20, utr: '', eventTimestamp: EVENT_TIME, source: 'apk_notification',
    });
    expect(settledOrderId).toBe(1002);
  });

  test('fallback: a device with no linked UPI still settles via the trader-wide set (no stranded payment)', async () => {
    mockPds = [{ id: 1, trader_id: 1, upi_id: 'a@okaxis', ngo_device_id: 'DEV-A' }];
    mockOrders = [{ id: 2001, status: 'pending', amount_inr: 30, upi_id: 'a@okaxis', created_at: '2026-08-12T01:23:00Z', donor_submitted_utr: null }];
    const { result, settledOrderId } = await settle({
      deviceId: 'DEV-UNLINKED', traderId: 1, amount: 30, utr: '', eventTimestamp: EVENT_TIME, source: 'apk_notification',
    });
    expect(result.matched).toBe(true);
    expect(settledOrderId).toBe(2001);
  });

  test('a device linked to multiple UPIs disambiguates within its own UPIs by closest time', async () => {
    mockPds = [
      { id: 1, trader_id: 1, upi_id: 'a@okaxis', ngo_device_id: 'DEV-MULTI' },
      { id: 2, trader_id: 1, upi_id: 'b@okhdfc', ngo_device_id: 'DEV-MULTI' },
    ];
    mockOrders = [
      { id: 3001, status: 'pending', amount_inr: 40, upi_id: 'a@okaxis', created_at: '2026-08-12T01:21:00Z', donor_submitted_utr: null },
      { id: 3002, status: 'pending', amount_inr: 40, upi_id: 'b@okhdfc', created_at: '2026-08-12T01:23:10Z', donor_submitted_utr: null },
    ];
    const { result, settledOrderId } = await settle({
      deviceId: 'DEV-MULTI', traderId: 1, amount: 40, utr: '', eventTimestamp: EVENT_TIME, source: 'apk_notification',
    });
    expect(result.matched).toBe(true);
    expect(settledOrderId).toBe(3002);
  });
});
