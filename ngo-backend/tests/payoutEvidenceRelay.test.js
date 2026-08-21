'use strict';

/**
 * Regression: POST /api/apk/payout-evidence (capture path, no orderId) relays to
 * the gateway via `axios`. A missing `require('axios')` made this throw
 * "axios is not defined" at request time and returned "Could not verify right
 * now" to every trader — a full outage. This test actually INVOKES the handler
 * and asserts it reaches the gateway relay (axios.post) and returns the match,
 * i.e. never falls into the match_unavailable ReferenceError catch again.
 */

const mockAxiosPost = jest.fn().mockResolvedValue({
  data: { matched: true, orderId: 'ORDER-1', ambiguous: false, message: 'Receipt matched — you can now submit this payout.' },
});

jest.mock('axios', () => ({ post: mockAxiosPost, get: jest.fn() }));
jest.mock('../src/middleware/internalAuth', () => ({ internalAuthHeaders: () => ({ 'X-Service-Token': 't' }) }));
jest.mock('../src/models/Device', () => ({ findOne: jest.fn().mockResolvedValue({ traderId: 7 }) }));
jest.mock('../src/models/PayoutEvidence', () => ({ create: jest.fn().mockResolvedValue({ _id: { toString: () => 'evid1' }, reason: 'capture', screenshotBase64: '', linkedSmsRaw: '' }) }));
jest.mock('../src/services/payoutLockService', () => ({
  attemptSubmissionLock: jest.fn().mockResolvedValue({ allowed: true, isFirstSubmission: true }),
  clearOtherDevices: jest.fn().mockResolvedValue(undefined),
}));

const router = require('../src/routes/apk');

function getHandler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

async function invoke(body) {
  const handler = getHandler('post', '/payout-evidence');
  const req = { body, app: { get: () => null } };
  let jsonBody = null;
  let statusCode = 200;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  const next = (err) => { throw err; };
  await handler(req, res, next);
  return { statusCode, body: jsonBody };
}

test('capture path relays through axios and returns the match (no ReferenceError)', async () => {
  const out = await invoke({
    deviceId: 'dev1',
    extractedFields: { amount: '500', last4: ['3333'], utr: '919634090229' },
  });
  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  expect(mockAxiosPost.mock.calls[0][0]).toMatch(/\/api\/internal\/match-payout-evidence$/);
  expect(out.body.matched).toBe(true);
  expect(out.body.orderId).toBe('ORDER-1');
  // The old bug fell into the catch and returned this; it must NOT happen now.
  expect(out.body.reason).not.toBe('match_unavailable');
});
