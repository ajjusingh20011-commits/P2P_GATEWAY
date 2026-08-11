'use strict';

/**
 * Internal service-to-service routes — mounted at /api/internal.
 *
 * Every route here requires a signed X-Service-Token from the P2P backend
 * (see middleware/internalAuth.js). They used to be unauthenticated on the
 * premise that both services sit on a private network; once the APIs were
 * published at public hostnames that premise was false and these were
 * answering unauthenticated requests from the internet.
 */

const express = require('express');
const mongoose = require('mongoose');
const Account = require('../models/Account');
const Device = require('../models/Device');
const SessionStore = require('../services/SessionStore');
const { CONNECTION_TYPE } = require('../config/constants');
const { verifyInternalService } = require('../middleware/internalAuth');

const router = express.Router();

// Applied at the router, not per-route, so a future endpoint added to this
// file cannot accidentally ship unauthenticated.
router.use(verifyInternalService);

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
    //
    // The field is `connectionType`, not `type`. Filtering on `type` looks
    // like it works but is silently a no-op: database.js sets
    // mongoose.set('strictQuery', true), which strips query conditions on
    // paths the schema doesn't define — so `{ type: 'web' }` degrades to `{}`
    // and matches every account, including APK ones. Those would then be
    // evaluated with isSessionAlive() (always false, they have no browser
    // session) and wrongly reported dead.
    const accounts = await Account.find({ connectionType: CONNECTION_TYPE.WEB })
      .select('_id upiId status traderId gatewayPaymentDetailId connectionType')
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
