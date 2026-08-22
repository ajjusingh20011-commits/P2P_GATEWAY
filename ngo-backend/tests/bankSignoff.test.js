'use strict';

// Redesign Section 2 — server-side bank sign-off extraction as a second
// confirmation layer. Pure functions; no DB. Verified against the 5 real Bank
// of Maharashtra MQR credit formats plus agreement/mismatch cases.

const { extractBankSignoff, identifyBankFromSms } = require('../src/utils/bankSenders');

const BOM = [
  'Dear Merchant, A/C XX4321 credited by Rs 250.00 on 21-AUG-26 via UPI MQR from rahul@upi. Ref No 623409812345. Avail Bal: Rs 14,250.00. - Bank of Maharashtra',
  'Your A/C XX4321 credited with INR 1,499.00 on 21-AUG-26 by MQR payment from customermobile@paytm (UPI Ref: 623409812346). Updated Bal: INR 15,749.00. - Bank of Maharashtra',
  'Dear Merchant, A/c XX4321 credited by Rs 3,750.00 on 21-AUG-26 towards UPI QR collection by payer SNEHA SHARMA. Ref No 623409812347. - Bank of Maharashtra',
  'Credit Alert: INR 8,200.00 credited to your BOM A/C XX4321 on 21-AUG-26 via Merchant QR Code (RRN: 623409812348). Clg Bal: INR 27,699.00. - Bank of Maharashtra',
  'Dear Merchant, A/C XX4321 credited with Rs 15,000.00 on 21-AUG-26 by UPI payment via MQR Ref No 623409812349. Total Avail Bal: Rs 42,699.00. - Bank of Maharashtra',
];

describe('extractBankSignoff', () => {
  test('recovers "Bank of Maharashtra" from all 5 real BoM formats (Bank-of-X shape)', () => {
    for (const body of BOM) expect(extractBankSignoff(body)).toBe('Bank of Maharashtra');
  });

  test('handles "<X> Bank" shapes (Bank at the end)', () => {
    expect(extractBankSignoff('… UTR 12345. - State Bank of India')).toBe('State Bank of India');
    expect(extractBankSignoff('… Ref 999. - Tamilnad Mercantile Bank')).toBe('Tamilnad Mercantile Bank');
    expect(extractBankSignoff('… credited. - Jana Small Finance Bank')).toBe('Jana Small Finance Bank');
    expect(extractBankSignoff('… - The Cosmos Co-operative Bank')).toBe('The Cosmos Co-operative Bank');
  });

  test('absent sign-off → "" (confidence signal only, never required)', () => {
    expect(extractBankSignoff('Rs 500 credited to A/c XX1234 UTR 123456789012')).toBe('');
    expect(extractBankSignoff('')).toBe('');
    expect(extractBankSignoff(null)).toBe('');
  });
});

describe('identifyBankFromSms (header + sign-off)', () => {
  test('recognised header + agreeing sign-off → agrees=true, displays bank', () => {
    const r = identifyBankFromSms('VK-MAHABK-S', BOM[0]);
    expect(r.bankRecognized).toBe(true);
    expect(r.header.tier).toBe(1);
    expect(r.signoffName).toBe('Bank of Maharashtra');
    expect(r.signoffAgrees).toBe(true);
    expect(r.displayName).toBe('Bank of Maharashtra');
  });

  test('UNRECOGNISED header (BOMBNK) → falls back to sign-off name for display', () => {
    const r = identifyBankFromSms('JM-BOMBNK-S', BOM[2]);
    expect(r.bankRecognized).toBe(false);   // header doesn't resolve
    expect(r.header).toBeNull();
    expect(r.displayName).toBe('Bank of Maharashtra'); // recovered from sign-off
  });

  test('UNRECOGNISED header (MAHAUPI) → sign-off recovers the name', () => {
    const r = identifyBankFromSms('VK-MAHAUPI-S', BOM[3]);
    expect(r.bankRecognized).toBe(false);
    expect(r.displayName).toBe('Bank of Maharashtra');
  });

  test('recognised header but MISMATCHED sign-off → agrees=false (suspicious)', () => {
    const r = identifyBankFromSms('JK-SBIBNK-S', '… credited Rs 10. UTR 12. - HDFC Bank');
    expect(r.bankRecognized).toBe(true);
    expect(r.header.name).toBe('State Bank of India');
    expect(r.signoffName).toBe('HDFC Bank');
    expect(r.signoffAgrees).toBe(false);
  });

  test('recognised header, no sign-off → agrees=null (n/a), displays header name', () => {
    const r = identifyBankFromSms('JK-SBIBNK-S', 'Rs 10 credited to A/c XX1234 UTR 123456789012');
    expect(r.signoffAgrees).toBeNull();
    expect(r.displayName).toBe('State Bank of India');
  });
});
