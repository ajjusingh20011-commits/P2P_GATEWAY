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
const PayoutEvidence = require('../models/PayoutEvidence');
const { MAX_ACTIVE_PAYOUTS } = require('../services/payoutList');
const unrecognizedSenderReview = require('../services/unrecognizedSenderReview');
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

/**
 * POST /api/internal/set-active-payout
 * Body: { device_id, orderId, payeeName, accountNumber, ifsc, amount } to arm
 * (add/replace this orderId in the device's list, capped at 3), or
 * { device_id, orderId, clear: true } to prune just that orderId.
 *
 * FEATURE 2 — Payout evidence capture, signal-delivery leg (Phase 1a: a LIST of
 * up to 3 active payouts, not a single slot). The P2P backend calls this once a
 * trader picks up a payout order; mirrored down to the device on its next
 * heartbeat (routes/apk.js). Nothing calls this yet from the P2P backend's own
 * pickup flow — that wiring is a separate follow-up; this endpoint is real and
 * independently testable. Semantics: services/payoutList.js.
 */
router.post('/set-active-payout', async (req, res, next) => {
  try {
    const { device_id, orderId, payeeName, accountNumber, ifsc, amount, clear } = req.body || {};
    if (!device_id || !mongoose.Types.ObjectId.isValid(device_id)) {
      return res.status(400).json({ success: false, message: 'device_id is required' });
    }
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    const oid = String(orderId);

    // Prune-by-orderId (replace before add) — atomic, so a re-arm can never
    // duplicate an orderId and a clear only ever removes that one payout.
    await Device.updateOne({ _id: device_id }, { $pull: { activePayouts: { orderId: oid } } });

    let device;
    if (clear) {
      device = await Device.findById(device_id);
    } else {
      const entry = {
        orderId: oid,
        payeeName: payeeName || '',
        accountNumber: accountNumber || '',
        ifsc: ifsc || '',
        amount: amount != null ? String(amount) : '',
        activatedAt: new Date(),
      };
      // $slice:-3 keeps the 3 most-recently-armed — the payoutList cap.
      device = await Device.findByIdAndUpdate(
        device_id,
        { $push: { activePayouts: { $each: [entry], $slice: -MAX_ACTIVE_PAYOUTS } } },
        { new: true }
      );
    }
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    return res.json({ success: true, activePayouts: device.activePayouts || [] });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/internal/set-active-payout-for-trader — arm (or clear) EVERY device
 * a trader owns to capture payout evidence for one order.
 *
 * FEATURE 2 multi-device: a trader may process a payout on ANY of their paired
 * phones, and Device.activePayout is a single slot, so the P2P backend arms all
 * of a trader's devices at pickup; whichever phone they actually use is already
 * capturing (the server matches the upload to the right order by content).
 *
 * Body: { traderId, orderId, payeeName, accountNumber, ifsc, amount } to arm,
 * or { traderId, orderId, clear: true } to clear — the clear is TARGETED to
 * that orderId so it never wipes an arming the trader has since taken for a
 * different order. Trader-scoped sibling of set-active-payout above.
 */
router.post('/set-active-payout-for-trader', async (req, res, next) => {
  try {
    const {
      traderId, orderId, payeeName, accountNumber, ifsc, amount, clear,
    } = req.body || {};
    if (traderId == null || !Number.isFinite(Number(traderId))) {
      return res.status(400).json({ success: false, message: 'traderId is required' });
    }
    const tid = Number(traderId);

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    const oid = String(orderId);

    if (clear) {
      // Prune just THIS order from every device the trader owns — leaves any
      // other in-processing payouts on those devices intact (the whole point
      // of Phase 1a's list vs the old single slot).
      const r = await Device.updateMany(
        { traderId: tid, 'activePayouts.orderId': oid },
        { $pull: { activePayouts: { orderId: oid } } }
      );
      return res.json({ success: true, cleared: r.modifiedCount != null ? r.modifiedCount : (r.nModified || 0) });
    }

    // Arm: replace-then-add across all the trader's devices, capped at 3. Two
    // atomic steps because Mongo can't $pull and $push the same path at once;
    // $pull first guarantees no duplicate orderId, $push+$slice enforces the cap.
    const entry = {
      orderId: oid,
      payeeName: payeeName || '',
      accountNumber: accountNumber || '',
      ifsc: ifsc || '',
      amount: amount != null ? String(amount) : '',
      activatedAt: new Date(),
    };
    await Device.updateMany({ traderId: tid }, { $pull: { activePayouts: { orderId: oid } } });
    const r = await Device.updateMany(
      { traderId: tid },
      { $push: { activePayouts: { $each: [entry], $slice: -MAX_ACTIVE_PAYOUTS } } }
    );
    return res.json({ success: true, armed: r.modifiedCount != null ? r.modifiedCount : (r.nModified || 0) });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/internal/sync-active-payouts-for-trader
 *
 * Self-healing RECONCILE (interim fix for the "device shows No payout in process
 * despite a genuinely active payout" sync bug). The single fire-and-forget arm
 * at accept() can silently miss (device offline then, transient failure, or a
 * Device.traderId link gap). The gateway calls this on the trader's panel poll
 * with their REAL current in_processing set, so a missed arm converges within
 * one poll instead of staying dead.
 *
 * Body: { traderId, payouts: [{ orderId, payeeName, accountNumber, ifsc, amount }] }.
 * Idempotent: prunes any armed order no longer in-process, and adds only the
 * missing ones — an already-armed order is left untouched so its activatedAt
 * (the local window) is not reset every poll.
 */
router.post('/sync-active-payouts-for-trader', async (req, res, next) => {
  try {
    const { traderId, payouts } = req.body || {};
    if (traderId == null || !Number.isFinite(Number(traderId))) {
      return res.status(400).json({ success: false, message: 'traderId is required' });
    }
    const tid = Number(traderId);
    const list = Array.isArray(payouts) ? payouts : [];
    const oids = list.map((p) => String(p && p.orderId)).filter(Boolean);

    // 1. Drop any armed order that is no longer in-process (settled/canceled/etc).
    await Device.updateMany(
      { traderId: tid },
      { $pull: { activePayouts: { orderId: { $nin: oids } } } }
    );
    // 2. Add each in-process order that is MISSING — only to devices that don't
    //    already carry it, so an already-armed order keeps its activatedAt.
    let added = 0;
    for (const p of list) {
      const oid = String(p && p.orderId);
      if (!oid || oid === 'undefined') continue;
      const entry = {
        orderId: oid,
        payeeName: (p && p.payeeName) || '',
        accountNumber: (p && p.accountNumber) || '',
        ifsc: (p && p.ifsc) || '',
        amount: p && p.amount != null ? String(p.amount) : '',
        activatedAt: new Date(),
      };
      // eslint-disable-next-line no-await-in-loop
      const r = await Device.updateMany(
        { traderId: tid, 'activePayouts.orderId': { $ne: oid } },
        { $push: { activePayouts: { $each: [entry], $slice: -MAX_ACTIVE_PAYOUTS } } }
      );
      added += (r.modifiedCount != null ? r.modifiedCount : (r.nModified || 0));
    }
    return res.json({ success: true, synced: oids.length, added });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/internal/payout-evidence?orderId=X[,Y]
 *
 * FEATURE 2 — the gateway's payoutService.transferred() reads the captured
 * success-screen fields here to ENFORCE the amount/last-4 hard match before it
 * lets a bank payout be marked transferred (utils/payoutMatch.js). Aggregates
 * the per-upload PayoutEvidence rows to the latest non-null extractedFields —
 * same read shape as the trader route in routes/ngo.js, but service-authed and
 * NOT trader-scoped: the gateway already owns the order and passes its ids
 * (both the uuid and the numeric id, since a capture may key off either).
 */
router.get('/payout-evidence', async (req, res, next) => {
  try {
    const raw = String(req.query.orderId || '').trim();
    if (!raw) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    const orderIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const rows = await PayoutEvidence.find({ orderId: { $in: orderIds } })
      .sort({ createdAt: 1 })
      .lean();

    let extractedFields = null;
    let hasScreenshot = false;
    for (const r of rows) {
      if (r.extractedFields != null) extractedFields = r.extractedFields;
      if (r.screenshotBase64) hasScreenshot = true;
    }
    return res.json({ success: true, extractedFields, hasScreenshot, uploadCount: rows.length });
  } catch (err) {
    return next(err);
  }
});

/* ---------------------------------------------------------------------------
 * Redesign Section 4 — Unrecognized bank-sender review queue, admin-wide
 * (service-token) so the P2P admin panel can reach it through the gateway
 * proxy. Same shared logic as the ngo-admin route. Promote goes live at once
 * (Section 3 overlay reload, inside the service).
 * ------------------------------------------------------------------------- */

// GET /api/internal/unrecognized-senders?status=&page=&limit=
router.get('/unrecognized-senders', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const { queue, total } = await unrecognizedSenderReview.listQueue({
      status: req.query.status, limit, skip: (page - 1) * limit,
    });
    return res.json({ success: true, queue, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/internal/unrecognized-senders/:code/promote  Body: { confirmedName, confirmedCode?, reviewedBy? }
router.post('/unrecognized-senders/:code/promote', async (req, res, next) => {
  try {
    const r = await unrecognizedSenderReview.promote(req.params.code, {
      confirmedName: req.body && req.body.confirmedName,
      confirmedCode: req.body && req.body.confirmedCode,
      reviewedBy: (req.body && req.body.reviewedBy) || 'admin-panel',
    });
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    if (r.notFound) return res.status(404).json({ success: false, message: 'Unrecognized sender not found' });
    return res.json({ success: true, promoted: r.row });
  } catch (err) {
    return next(err);
  }
});

// POST /api/internal/unrecognized-senders/:code/ignore  Body: { reviewedBy? }
router.post('/unrecognized-senders/:code/ignore', async (req, res, next) => {
  try {
    const r = await unrecognizedSenderReview.ignore(req.params.code, {
      reviewedBy: (req.body && req.body.reviewedBy) || 'admin-panel',
    });
    if (r.notFound) return res.status(404).json({ success: false, message: 'Unrecognized sender not found' });
    return res.json({ success: true, ignored: r.row.code });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
