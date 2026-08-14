/**
 * Regression test — connectionLiveness re-arms is_active when a device recovers.
 *
 * The bug: is_active (routing's linkage gate) is flipped OFF the instant a
 * device goes offline (the trader panel's auto-unlink), but nothing ever turned
 * it back ON when the device came back. Routing requires is_active AND
 * connection_alive, so an account whose switch was still on (is_active_detail
 * true) stayed dark forever after a single dropped heartbeat — its badge could
 * even read "Live" (connection_alive true) while it silently received no orders.
 *
 * The fix: syncOnce(), which already mirrors connection_alive every 15s, now
 * also sets is_active back to true when the device is genuinely live again AND
 * the trader's switch is still on. This exercises the REAL syncOnce over the two
 * sibling accounts from the field report (forftes/fdsc on one shared device);
 * only the HTTP snapshot and the Sequelize data layer are mocked.
 *
 * Guardrails this locks in — re-arm must fire ONLY for (alive && switch-on &&
 * currently-unlinked), and must NOT:
 *   - link an account the trader parked (is_active_detail false),
 *   - link an account whose device is offline,
 *   - touch an account already linked.
 * Do not loosen these — each one is a way for the fix to start linking accounts
 * that should stay dark.
 */

// jest.mock factories are hoisted above imports; closed-over vars must be
// "mock"-prefixed.
let mockRows = [];
const mockUpdates = [];

jest.mock('../src/utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));

jest.mock('../src/services/accountScore', () => ({
  markOpenOrdersFailed: async () => {},
}));

jest.mock('../src/services/ngoServiceAuth', () => ({
  internalAuthHeaders: () => ({}),
}));

jest.mock('../src/models', () => ({
  PaymentDetail: {
    // Rows behave like Sequelize instances: direct field access AND get({plain}).
    findAll: async () => mockRows.map((o) => ({ ...o, get: () => ({ ...o }) })),
    update: async (fields, opts) => { mockUpdates.push({ id: opts.where.id, fields }); },
  },
}));

const axios = require('axios');
jest.mock('axios');

const { syncOnce } = require('../src/jobs/connectionLiveness');

// The shared physical device from the report ("subha").
const DEVICE = '6a7ca86b800d9878b146905b';

const updateFor = (id) => mockUpdates.find((u) => u.id === id);

beforeEach(() => {
  mockUpdates.length = 0;
});

test('re-arms is_active for a live, switched-on, currently-unlinked account', async () => {
  mockRows = [
    // forftes@ysl — switch on, device alive, but is_active stuck false. The bug.
    { id: 18, upi_id: 'forftes@ysl', ngo_device_id: DEVICE, connection_alive: true, is_active: false, is_active_detail: true },
    // fdsc@okaxis — same device, already linked. Must be left alone.
    { id: 20, upi_id: 'fdsc@okaxis', ngo_device_id: DEVICE, connection_alive: true, is_active: true, is_active_detail: true },
  ];
  axios.get.mockResolvedValue({
    data: { success: true, devices: [{ deviceId: DEVICE, alive: true }], webAccounts: [] },
  });

  const result = await syncOnce();
  expect(result.ok).toBe(true);

  // forftes is re-armed in the same write that refreshes connection_alive.
  expect(updateFor(18).fields.is_active).toBe(true);
  expect(updateFor(18).fields.connection_alive).toBe(true);

  // fdsc was already linked — the write must NOT carry an is_active field at all
  // (no needless churn on an account that was fine).
  expect(updateFor(20).fields).not.toHaveProperty('is_active');
});

test('does NOT re-arm an account the trader parked (is_active_detail false)', async () => {
  mockRows = [
    { id: 30, upi_id: 'parked@ybl', ngo_device_id: DEVICE, connection_alive: true, is_active: false, is_active_detail: false },
  ];
  axios.get.mockResolvedValue({
    data: { success: true, devices: [{ deviceId: DEVICE, alive: true }], webAccounts: [] },
  });

  await syncOnce();
  expect(updateFor(30).fields).not.toHaveProperty('is_active');
});

test('does NOT re-arm when the device is offline', async () => {
  mockRows = [
    { id: 40, upi_id: 'dead@okaxis', ngo_device_id: DEVICE, connection_alive: true, is_active: false, is_active_detail: true },
  ];
  axios.get.mockResolvedValue({
    // device reports NOT alive → resolves connection_alive false, no re-arm.
    data: { success: true, devices: [{ deviceId: DEVICE, alive: false }], webAccounts: [] },
  });

  await syncOnce();
  expect(updateFor(40).fields.connection_alive).toBe(false);
  expect(updateFor(40).fields).not.toHaveProperty('is_active');
});
