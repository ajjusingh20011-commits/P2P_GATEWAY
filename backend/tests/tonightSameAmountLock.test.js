/**
 * Tonight's scenario #12 — BUG-42 same-amount lock across sibling accounts,
 * at ORDER-CREATION time. Drives the REAL routingEngine.hasSameAmountActiveOrder;
 * only the data layer and infra deps (redis/websocket) are mocked.
 *
 * Extended for the PLATFORM-SCOPED refinement: the device half of the lock only
 * blocks siblings the capture could not tell apart, i.e. siblings on the SAME
 * platform. A GPay account and a Paytm account on one phone are individually
 * attributable (matchingEngineV2.resolveReceivingUpis pins the receiver by
 * account_type), so blocking them from holding the same amount was stricter
 * than the ambiguity it was defending against.
 */
const { Op } = require('sequelize');

jest.mock('../src/loaders/redis', () => ({ connection: {}, isRedisAvailable: () => false }));
jest.mock('../src/websocket', () => ({
  emitToTrader: () => {}, emitToAdmin: () => {}, emitToMerchant: () => {}, emitToOrder: () => {}, broadcast: () => {},
}));
jest.mock('../src/utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }));
jest.mock('../src/models', () => {
  const { Op: SeqOp } = require('sequelize');
  const inSet = (clause, val) => Array.isArray(clause?.[SeqOp.in]) && clause[SeqOp.in].includes(val);
  return {
    PaymentDetail: {
      // Mirrors the real query: same device, excluding the candidate itself.
      // account_type is now selected too — it is what decides whether a sibling
      // is genuinely indistinguishable from the candidate.
      findAll: async ({ where }) => mockOrdersHelper.pds
        .filter((p) => p.ngo_device_id === where.ngo_device_id && p.id !== where.id[SeqOp.ne])
        .map((p) => ({ id: p.id, account_type: p.account_type })),
    },
    Order: {
      ACTIVE_STATUSES: ['pending', 'checkout_open', 'claimed_paid', 'under_review'],
      count: async ({ where }) => mockOrdersHelper.orders.filter((o) =>
        inSet(where.payment_detail_id, o.payment_detail_id) &&
        Number(o.amount_inr) === Number(where.amount_inr) &&
        inSet(where.status, o.status)).length,
    },
  };
});

// Shared mutable state the mock reads (declared with a mock-prefixed name so the
// jest.mock factory may close over it).
const mockOrdersHelper = { pds: [], orders: [] };

const routing = require('../src/services/routingEngine');

beforeEach(() => { mockOrdersHelper.pds = []; mockOrdersHelper.orders = []; });

describe('#12 same-amount lock across sibling accounts (BUG-42)', () => {
  // Device DEV backs A(id 1, gpay) and B(id 2, gpay). A already holds ₹500.
  beforeEach(() => {
    mockOrdersHelper.pds = [
      { id: 1, ngo_device_id: 'DEV', account_type: 'gpay' },
      { id: 2, ngo_device_id: 'DEV', account_type: 'gpay' },
    ];
    mockOrdersHelper.orders = [
      { id: 900, payment_detail_id: 1, amount_inr: 500, status: 'pending' }, // A's open ₹500
    ];
  });

  test('routing a SECOND ₹500 order to same-platform sibling B is blocked (collision seen across the device)', async () => {
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, 'DEV', 'gpay');
    expect(blocked).toBe(true);
  });

  test('a different amount to B is fine (no false lock)', async () => {
    const blocked = await routing.hasSameAmountActiveOrder(2, 999, 'DEV', 'gpay');
    expect(blocked).toBe(false);
  });

  test('without the device link, the sibling collision would be missed — proving device-scoping is what catches it', async () => {
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, undefined, 'gpay');
    expect(blocked).toBe(false); // only B's own (none) is checked
  });

  test('an account still blocks itself at the same amount, whatever its platform', async () => {
    const blocked = await routing.hasSameAmountActiveOrder(1, 500, 'DEV', 'gpay');
    expect(blocked).toBe(true);
  });
});

describe('#12b platform-scoped device lock — different platforms are attributable', () => {
  // Same one phone, but now A is GPay and B is Paytm.
  beforeEach(() => {
    mockOrdersHelper.pds = [
      { id: 1, ngo_device_id: 'DEV', account_type: 'gpay' },
      { id: 2, ngo_device_id: 'DEV', account_type: 'paytm' },
    ];
    mockOrdersHelper.orders = [
      { id: 900, payment_detail_id: 1, amount_inr: 500, status: 'pending' }, // GPay's open ₹500
    ];
  });

  test('a ₹500 order MAY route to the Paytm sibling while GPay holds ₹500 (the fix)', async () => {
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, 'DEV', 'paytm');
    expect(blocked).toBe(false);
  });

  test('and the reverse: GPay may take ₹500 while Paytm holds it', async () => {
    mockOrdersHelper.orders = [{ id: 901, payment_detail_id: 2, amount_inr: 500, status: 'pending' }];
    const blocked = await routing.hasSameAmountActiveOrder(1, 500, 'DEV', 'gpay');
    expect(blocked).toBe(false);
  });

  test('a THIRD account on the same phone, same platform as the busy one, is still blocked', async () => {
    mockOrdersHelper.pds.push({ id: 3, ngo_device_id: 'DEV', account_type: 'gpay' });
    const blocked = await routing.hasSameAmountActiveOrder(3, 500, 'DEV', 'gpay');
    expect(blocked).toBe(true);
  });

  test('only the same-platform sibling is consulted — a busy Paytm sibling does not block a GPay candidate', async () => {
    mockOrdersHelper.pds.push({ id: 3, ngo_device_id: 'DEV', account_type: 'gpay' });
    // Paytm(2) is busy at ₹500; GPay(1) is not.
    mockOrdersHelper.orders = [{ id: 902, payment_detail_id: 2, amount_inr: 500, status: 'pending' }];
    const blocked = await routing.hasSameAmountActiveOrder(3, 500, 'DEV', 'gpay');
    expect(blocked).toBe(false);
  });

  test('platform comparison is case/whitespace insensitive (declared values are free text)', async () => {
    mockOrdersHelper.pds = [
      { id: 1, ngo_device_id: 'DEV', account_type: 'GPay' },
      { id: 2, ngo_device_id: 'DEV', account_type: ' gpay ' },
    ];
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, 'DEV', 'gpay');
    expect(blocked).toBe(true);
  });
});

describe('#12c platform-scoped lock fails SAFE when a platform is unknown', () => {
  test('a sibling with no account_type still blocks — it cannot be proven distinguishable', async () => {
    mockOrdersHelper.pds = [
      { id: 1, ngo_device_id: 'DEV', account_type: null },
      { id: 2, ngo_device_id: 'DEV', account_type: 'paytm' },
    ];
    mockOrdersHelper.orders = [{ id: 900, payment_detail_id: 1, amount_inr: 500, status: 'pending' }];
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, 'DEV', 'paytm');
    expect(blocked).toBe(true);
  });

  test('a caller that does not pass its own platform keeps the old blanket device-wide block', async () => {
    mockOrdersHelper.pds = [
      { id: 1, ngo_device_id: 'DEV', account_type: 'gpay' },
      { id: 2, ngo_device_id: 'DEV', account_type: 'paytm' },
    ];
    mockOrdersHelper.orders = [{ id: 900, payment_detail_id: 1, amount_inr: 500, status: 'pending' }];
    const blocked = await routing.hasSameAmountActiveOrder(2, 500, 'DEV');
    expect(blocked).toBe(true);
  });
});
