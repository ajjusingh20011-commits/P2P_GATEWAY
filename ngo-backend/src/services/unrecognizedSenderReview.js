'use strict';

/**
 * Redesign Section 4/3 — shared review logic for the Unrecognized-sender queue,
 * so the ngo-admin route AND the gateway-proxied admin panel (via internal.js)
 * use ONE implementation. Promote makes the bank live immediately by reloading
 * the runtime overlay (Section 3).
 */

const UnrecognizedSender = require('../models/UnrecognizedSender');
const bankRuntimeRules = require('./bankRuntimeRules');

/** The review queue for a status, most-seen first, mapped to a review view. */
async function listQueue({ status = 'pending', limit = 50, skip = 0 } = {}) {
  const s = ['pending', 'promoted', 'ignored'].includes(status) ? status : 'pending';
  const [rows, total] = await Promise.all([
    UnrecognizedSender.find({ status: s }).sort({ occurrences: -1, lastSeenAt: -1 }).skip(skip).limit(limit).lean(),
    UnrecognizedSender.countDocuments({ status: s }),
  ]);
  const queue = rows.map((r) => ({
    code: r.code,
    lastSender: r.lastSender,
    signoffName: r.signoffName || null,
    sampleBody: r.sampleBody,
    occurrences: r.occurrences,
    distinctDevices: (r.deviceIds || []).length,
    deviceIds: r.deviceIds || [],
    traderIds: r.traderIds || [],
    lastTraderId: r.lastTraderId != null ? r.lastTraderId : null,
    hasValidUtr: !!r.hasValidUtr,
    lastAmount: r.lastAmount,
    lastUtr: r.lastUtr,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    status: r.status,
  }));
  return { queue, total };
}

/** Confirm a genuinely-new bank → live immediately (overlay reload). */
async function promote(code, { confirmedName, confirmedCode, reviewedBy } = {}) {
  const c = String(code || '').toUpperCase();
  const name = String(confirmedName || '').trim();
  if (!c) return { error: 'code is required' };
  if (!name) return { error: 'confirmedName is required' };
  const row = await UnrecognizedSender.findOneAndUpdate(
    { code: c },
    {
      $set: {
        status: 'promoted',
        confirmedName: name,
        confirmedCode: String(confirmedCode || c).toUpperCase(),
        reviewedAt: new Date(),
        reviewedBy: reviewedBy || 'admin',
      },
    },
    { new: true }
  );
  if (!row) return { notFound: true };
  // Section 3 — reload the runtime overlay so it resolves everywhere at once.
  await bankRuntimeRules.refreshRuntimeBankCodes();
  return { row: { code: row.code, confirmedName: row.confirmedName, confirmedCode: row.confirmedCode } };
}

/** Dismiss noise so it stops resurfacing. */
async function ignore(code, { reviewedBy } = {}) {
  const c = String(code || '').toUpperCase();
  if (!c) return { error: 'code is required' };
  const row = await UnrecognizedSender.findOneAndUpdate(
    { code: c },
    { $set: { status: 'ignored', reviewedAt: new Date(), reviewedBy: reviewedBy || 'admin' } },
    { new: true }
  );
  if (!row) return { notFound: true };
  return { row: { code: row.code } };
}

module.exports = { listQueue, promote, ignore };
