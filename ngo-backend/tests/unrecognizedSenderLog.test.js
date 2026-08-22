'use strict';

// Redesign Section 4 — the pure classifier that decides whether an inbound event
// belongs in the unrecognized-sender review queue, and extracts its review data.

const { classifyForQueue, entityCode } = require('../src/services/unrecognizedSenderLog');

const bomBody = 'Dear Merchant, A/c XX4321 credited by Rs 3,750.00 on 21-AUG-26 towards UPI QR collection by payer SNEHA SHARMA. Ref No 623409812347. - Bank of Maharashtra';

describe('entityCode', () => {
  test('isolates the DLT entity token (longest segment)', () => {
    expect(entityCode('JM-BOMBNK-S')).toBe('BOMBNK');
    expect(entityCode('VK-MAHAUPI-S')).toBe('MAHAUPI');
    expect(entityCode('AX-HDFCBK-T')).toBe('HDFCBK');
  });
});

describe('classifyForQueue', () => {
  test('UNRECOGNISED DLT bank SMS (BOMBNK) → queue it, with code + sign-off', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'JM-BOMBNK-S', body: bomBody, utr: '623409812347' });
    expect(c.shouldLog).toBe(true);
    expect(c.code).toBe('BOMBNK');
    expect(c.signoffName).toBe('Bank of Maharashtra');
    expect(c.hasValidUtr).toBe(true); // exactly 12 digits
  });

  test('RECOGNISED header (MAHABK Tier-1) → NOT queued', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'VK-MAHABK-S', body: bomBody, utr: '623409812345' });
    expect(c.shouldLog).toBe(false);
  });

  test('recognised via Tier-2 prefix (HDFCBF→HDFC) → NOT queued', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'AX-HDFCBF-S', body: 'Rs 100 credited to A/c XX1234', utr: '' });
    expect(c.shouldLog).toBe(false);
  });

  test('notification (not SMS) → NOT queued (apps identify by platform, not DLT)', () => {
    const c = classifyForQueue({ type: 'NOTIFICATION', sender: 'JM-BOMBNK-S', body: bomBody, utr: '623409812347' });
    expect(c.shouldLog).toBe(false);
  });

  test('non-payment-shaped body (no amount+verb) → NOT queued', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'JM-BOMBNK-S', body: 'Your OTP is 4821. - Bank of Maharashtra', utr: '' });
    expect(c.shouldLog).toBe(false);
  });

  test('short/non-12-digit reference → hasValidUtr false (Section-7 red flag)', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'JM-BOMBNK-S', body: bomBody, utr: '12345' });
    expect(c.shouldLog).toBe(true);
    expect(c.hasValidUtr).toBe(false);
  });

  test('unresolved header but no bank sign-off → still queued, signoff empty', () => {
    const c = classifyForQueue({ type: 'SMS', sender: 'JM-BOMBNK-S', body: 'Rs 500 credited to A/c XX9999 on 21-AUG-26', utr: '' });
    expect(c.shouldLog).toBe(true);
    expect(c.signoffName).toBe('');
  });
});
