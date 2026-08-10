'use strict';

/**
 * Internal service-to-service routes — mounted at /api/internal.
 * Unauthenticated, same trust model as POST /api/checkout/verify: both
 * services run on a private network in this deployment, and this endpoint
 * only ever discloses a boolean, never a record.
 */

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const Device = require('../models/Device');
const SessionStore = require('../services/SessionStore');

const router = express.Router();

// Same 15s freshness window routes/apk.js uses for its own `online` field —
// duplicated as a constant rather than exported/imported because apk.js keeps
// it private and this file must not reach into that router's internals.
// If that window ever changes, change it here too.
const ONLINE_WINDOW_MS = 15 * 1000;
const isOnline = (lastSeen) => !!lastSeen && Date.now() - new Date(lastSeen).getTime() <= ONLINE_WINDOW_MS;

// GET /api/internal/upi-check?upi_id=X[&exclude_account_id=Y] — used by the
// P2P gateway backend before creating/updating a payment_details row, to
// enforce UPI uniqueness across both databases.
//
// `exclude_account_id` is for the payment_details mirror the trader
// frontend keeps for every NGO/web-login account (syncNgoAccountToPaymentDetail):
// that mirror's own source account already exists here with the same UPI,
// so without excluding it this check always found "itself" and rejected
// every new Web Login account's mirror sync as a false-positive duplicate.
router.get('/upi-check', async (req, res, next) => {
  try {
    const upiId = String(req.query.upi_id || '').trim();
    if (!upiId) return res.json({ exists: false });
    const query = { upiId };
    const excludeId = req.query.exclude_account_id;
    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      query._id = { $ne: excludeId };
    }
    const existing = await Account.findOne(query).select('_id');
    return res.json({ exists: !!existing });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/internal/connection-liveness
 *
 * Read-only snapshot of which connections are actually alive right now, for
 * the P2P gateway's routing engine. It cannot answer this itself: device
 * heartbeats live in Mongo and Web Login sessions live in this process's
 * memory (SessionStore holds real Playwright handles).
 *
 * Deliberately reuses the two existing sources of truth verbatim rather than
 * reimplementing liveness:
 *   - devices: the same lastSeen freshness window apk.js's isOnline() uses.
 *   - webAccounts: SessionStore.isSessionAlive(), the same call
 *     GET /api/ngo/accounts/:id/status already serves to the trader panel.
 *
 * Returns identifiers only (device id, upi id, the gateway's own
 * payment_detail id) plus a boolean — no credentials, no session contents,
 * consistent with the "boolean only" trust model of this router.
 */
router.get('/connection-liveness', async (req, res, next) => {
  try {
    const devices = await Device.find({}).select('_id lastSeen status traderId').lean();

    // Only web accounts can have a Playwright session; APK-type accounts are
    // covered by the device list above.
    const accounts = await Account.find({ type: 'web' })
      .select('_id upiId status traderId gatewayPaymentDetailId')
      .lean();

    const webAccounts = await Promise.all(
      accounts.map(async (a) => ({
        accountId: String(a._id),
        upiId: a.upiId || null,
        // The gateway matches on upiId first — gatewayPaymentDetailId has been
        // observed dangling (pointing at a deleted payment_details row) — but
        // it is still reported so the gateway can use it as a secondary key.
        gatewayPaymentDetailId: a.gatewayPaymentDetailId ?? null,
        traderId: a.traderId ?? null,
        status: a.status || null,
        // A session is only usable if the account is marked live AND the real
        // browser page is still on a logged-in URL.
        alive: a.status === 'live' && (await SessionStore.isSessionAlive(String(a._id))),
      }))
    );

    return res.json({
      success: true,
      checkedAt: new Date().toISOString(),
      devices: devices.map((d) => ({
        deviceId: String(d._id),
        traderId: d.traderId ?? null,
        status: d.status || null,
        alive: isOnline(d.lastSeen),
      })),
      webAccounts,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
