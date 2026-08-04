'use strict';

/**
 * Enforces UPI ID uniqueness across both databases before a new Account is
 * saved — locally in Mongo (the DB-level partial unique index in
 * models/Account.js is the real backstop) and, best effort, in the P2P
 * gateway backend's `payment_details` table. A down/unreachable gateway
 * backend must not block account creation, so the cross-service check fails
 * open (logs and continues) on any network error.
 */

const axios = require('axios');
const Account = require('../models/Account');

const UPI_TAKEN_MESSAGE = 'This UPI ID is already registered on the platform';

class UpiTakenError extends Error {
  constructor() {
    super(UPI_TAKEN_MESSAGE);
    this.status = 409;
  }
}

async function assertUpiAvailable(upiId, { excludeId } = {}) {
  if (!upiId) return;

  const query = { upiId };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Account.findOne(query).select('_id');
  if (existing) throw new UpiTakenError();

  try {
    const base = process.env.P2P_BACKEND_URL || 'http://localhost:4000';
    const res = await axios.get(`${base}/api/internal/upi-check`, {
      params: { upi_id: upiId },
      timeout: 3000,
    });
    if (res.data?.exists) throw new UpiTakenError();
  } catch (err) {
    if (err instanceof UpiTakenError) throw err;
    console.error(`assertUpiAvailable: P2P backend cross-check unreachable, proceeding — ${err.message}`);
  }
}

module.exports = { assertUpiAvailable, UpiTakenError, UPI_TAKEN_MESSAGE };
