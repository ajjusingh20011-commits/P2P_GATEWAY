const crypto = require('crypto');
const express = require('express');
const Device = require('../models/Device');
const DebitSMS = require('../models/DebitSMS');
const OverlayCapture = require('../models/OverlayCapture');
const OutgoingPayment = require('../models/OutgoingPayment');
const Payout = require('../models/Payout');
const CrashLog = require('../models/CrashLog');
const Transaction = require('../models/Transaction');
const scraperEngine = require('../services/scraperEngine');
const matchingEngine = require('../services/matchingEngine');
const { matchDebitWithOverlay } = require('../services/payoutVerifier');
const { detectRealPayment } = require('../services/paymentDetector');
const { DEVICE_STATUS, RAW_EVENT_TYPE, CATEGORY, TRANSACTION_STATUS, ROLES } = require('../config/constants');
const { verifyToken, requireRole } = require('../middleware/auth');
const { verifyServiceOrAdmin, resolveTraderFilter, requireTraderId } = require('../middleware/serviceAuth');

const router = express.Router();

/**
 * Endpoints consumed by the Android APK. Devices authenticate with a
 * deviceToken (issued at registration) rather than a user JWT.
 */

/**
 * POST /api/apk/register-device
 * Body: { deviceId, deviceModel, androidVersion, appVersion, licenseKey }
 * Claims the pending Device row created by POST /generate-license (the
 * trader-panel pairing flow) and returns its deviceToken.
 *
 * licenseKey is now REQUIRED. This route used to also accept a bare
 * deviceId with no licenseKey and no authentication at all — if a Device
 * with that deviceId already existed, it would reactivate it in place
 * (status back to ACTIVE, fields updated) and hand back its existing
 * deviceToken to whoever asked, with zero ownership check. The current
 * Android app never used that path (it always sends a licenseKey — see
 * RegistrationActivity), so removing it needs no APK change; it was only
 * ever reachable via a direct API call. Every (re-)registration now goes
 * through the real, owned licenseKey pairing flow.
 */
router.post('/register-device', async (req, res, next) => {
  try {
    const { deviceId, deviceModel, androidVersion, appVersion, licenseKey } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }
    if (!licenseKey) {
      return res.status(404).json({ success: false, message: 'Invalid or already-used license code' });
    }

    const device = await Device.findOne({ licenseKey, status: DEVICE_STATUS.PENDING });
    if (!device) {
      return res
        .status(404)
        .json({ success: false, message: 'Invalid or already-used license code' });
    }
    if (device.licenseExpiresAt && device.licenseExpiresAt.getTime() < Date.now()) {
      return res
        .status(400)
        .json({ success: false, message: 'Code expired — generate a new one' });
    }
    device.deviceId = deviceId;
    device.deviceModel = deviceModel || device.deviceModel;
    device.androidVersion = androidVersion || device.androidVersion;
    device.appVersion = appVersion || device.appVersion;
    device.status = DEVICE_STATUS.ACTIVE;
    device.lastSeen = new Date();
    if (!device.deviceToken) {
      device.deviceToken = crypto.randomBytes(24).toString('hex');
    }

    try {
      await device.save();
    } catch (saveErr) {
      // deviceId has a unique index (Device.js) — this is what actually
      // blocks Trader B's licenseKey claim from silently taking over a
      // device Trader A already owns. Previously this fell through to the
      // generic error handler and leaked the raw Mongo E11000 string as a
      // 500; now it's a clean, honest 409.
      if (saveErr && saveErr.code === 11000) {
        return res.status(409).json({ success: false, message: 'This device is already registered' });
      }
      throw saveErr;
    }

    const io = req.app.get('io');
    if (io && device.traderId != null) {
      io.to(`trader:${device.traderId}`).emit('device-registered', {
        deviceId: device.deviceId,
        deviceName: device.deviceModel,
      });
    }

    return res.status(201).json({ success: true, deviceToken: device.deviceToken });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/generate-license
 * Auth: real trader service token (see middleware/serviceAuth.js).
 * Creates a pending Device row with a short human-typeable code and returns
 * it. The phone claims this row by sending the same code as `licenseKey` to
 * POST /register-device. The generating trader's id is stamped on the row
 * now — that's what makes it theirs once claimed, not a shared org id.
 */
router.post(
  '/generate-license',
  verifyServiceOrAdmin,
  async (req, res, next) => {
    try {
      const traderId = requireTraderId(req, res);
      if (traderId == null) return undefined;

      let licenseKey;
      do {
        licenseKey = crypto.randomBytes(3).toString('hex').toUpperCase();
        // eslint-disable-next-line no-await-in-loop
      } while (await Device.exists({ licenseKey }));

      const licenseExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const device = await Device.create({
        deviceId: `pending:${licenseKey}`,
        licenseKey,
        licenseExpiresAt,
        traderId,
        status: DEVICE_STATUS.PENDING,
      });

      return res
        .status(201)
        .json({ success: true, licenseKey, licenseExpiresAt, deviceId: device._id.toString() });
    } catch (err) {
      return next(err);
    }
  }
);

// A device counts as genuinely online only if it has heartbeated (or
// registered/posted an event, which also refresh lastSeen) within this
// window — matches HeartbeatService's 4s interval with generous slack.
// `status` alone is not trustworthy: the APK always sends status:"active"
// verbatim and nothing ever flips it back on disconnect.
const ONLINE_WINDOW_MS = 15 * 1000;
const isOnline = (lastSeen) => !!lastSeen && Date.now() - new Date(lastSeen).getTime() <= ONLINE_WINDOW_MS;

/**
 * GET /api/apk/devices
 * Auth: real trader service token, or admin (optionally with ?traderId=).
 * Lists devices for the calling trader (or, for admin, everyone / one
 * trader), for the trader panel's "Registered Devices" list and the
 * payment-detail device picker (same source, so both agree).
 *
 * PENDING (a generated pairing code nobody has claimed yet, or an abandoned
 * one) is deliberately excluded — those never reached ACTIVE and shouldn't
 * permanently litter the list as an "Unnamed device" row. Use
 * DELETE /api/apk/devices/:id to actually remove a Device row.
 */
router.get(
  '/devices',
  verifyServiceOrAdmin,
  async (req, res, next) => {
    try {
      const devices = await Device.find({
        ...resolveTraderFilter(req),
        status: { $ne: DEVICE_STATUS.PENDING },
      })
        .sort({ createdAt: -1 })
        .select('deviceId deviceModel deviceName status lastSeen licenseKey createdAt listenerConnected');

      return res.json({
        success: true,
        devices: devices.map((d) => ({
          id: d._id.toString(),
          deviceId: d.deviceId,
          deviceName: d.deviceName || d.deviceModel || '',
          deviceModel: d.deviceName ? d.deviceModel || '' : '',
          status: d.status,
          lastSeen: d.lastSeen,
          online: isOnline(d.lastSeen),
          licenseKey: d.licenseKey,
          // Third status field alongside `online` — null (unknown, older
          // APK build or no heartbeat yet), true (capturing), or false
          // (permission granted but the OS silently unbound the listener —
          // the ColorOS case HeartbeatService's health check tries to fix).
          listenerConnected: d.listenerConnected,
        })),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * PATCH /api/apk/devices/:id
 * Auth: NGO staff/admin bearer token.
 * Body: { deviceName }
 * Renames a device (the trader-assigned display name shown on the
 * Smartphones page) — id is the Device's Mongo _id.
 */
router.patch(
  '/devices/:id',
  verifyServiceOrAdmin,
  async (req, res, next) => {
    try {
      const { deviceName } = req.body;
      if (typeof deviceName !== 'string' || !deviceName.trim()) {
        return res.status(400).json({ success: false, message: 'deviceName is required' });
      }
      const device = await Device.findOneAndUpdate(
        { _id: req.params.id, ...resolveTraderFilter(req) },
        { deviceName: deviceName.trim() },
        { new: true }
      );
      if (!device) {
        return res.status(404).json({ success: false, message: 'Device not found' });
      }
      return res.json({
        success: true,
        device: { id: device._id.toString(), deviceName: device.deviceName },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * DELETE /api/apk/devices/:id
 * Auth: NGO staff/admin bearer token.
 * Permanently removes a Device row (real deletion, not a client-side hide) —
 * id is the Device's Mongo _id. Works on any status, including an abandoned
 * PENDING pairing code fetched by direct id even though the list route above
 * no longer surfaces PENDING rows.
 */
router.delete(
  '/devices/:id',
  verifyServiceOrAdmin,
  async (req, res, next) => {
    try {
      const device = await Device.findOne({ _id: req.params.id, ...resolveTraderFilter(req) });
      if (!device) {
        return res.status(404).json({ success: false, message: 'Device not found' });
      }
      await Device.deleteOne({ _id: device._id });
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/apk/update-device-name — no auth (the APK posts this directly,
 * right after the trader picks a name in SetDeviceNameActivity).
 * Body: { licenseKey, deviceId, deviceName }
 */
router.post('/update-device-name', async (req, res) => {
  try {
    const { licenseKey, deviceId, deviceName } = req.body;
    await Device.findOneAndUpdate(
      { licenseKey, deviceId },
      { deviceName, lastSeen: new Date() }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * POST /api/apk/heartbeat — the APK posts this directly, every 4s from
 * HeartbeatService. Body: { licenseKey, deviceId, status }, header
 * `devicetoken` (same header /event uses).
 *
 * Requires deviceId + devicetoken to match a real, still-existing Device —
 * previously this matched on deviceId alone with no token check at all, so
 * anyone who learned/guessed a deviceId could spoof heartbeats or overwrite
 * another device's status. A missing/mismatched pair now gets a real 404
 * instead of a silent no-op update — HeartbeatService reacts to that
 * specific code by clearing local pairing and notifying the user, since it
 * means this device genuinely no longer exists (e.g. deleted from the
 * trader panel), not a flake. Any other failure (DB hiccup, etc.) still
 * resolves success, same as before — a transient error should never force
 * a real device through re-pairing.
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, status, listenerConnected } = req.body;
    const token = req.headers.devicetoken || req.headers['x-device-token'];
    if (!deviceId || !token) {
      return res.status(404).json({ success: false, message: 'deviceId and devicetoken are required' });
    }

    const update = {
      lastSeen: new Date(),
      status: status || 'active',
    };
    // Only touch the field when the APK actually sent it — an older build
    // that predates this field omits it entirely, and that must read as
    // "unknown" (the schema default, null), not get coerced to false.
    if (typeof listenerConnected === 'boolean') {
      update.listenerConnected = listenerConnected;
    }

    const device = await Device.findOneAndUpdate(
      { deviceId, deviceToken: token },
      update
    );
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not registered' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: true });
  }
});

/**
 * POST /api/apk/event
 * Header: deviceToken
 * Body: { type, sender, body, category, amount, utr, utcTimestamp }
 * Persists a RawEvent; if it is a PAYMENT, runs the matching engine.
 */
router.post('/event', async (req, res, next) => {
  try {
    const token = req.headers.devicetoken || req.headers['x-device-token'];
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: 'deviceToken header is required' });
    }

    const device = await Device.findOne({ deviceToken: token });
    if (!device) {
      return res.status(401).json({ success: false, message: 'Invalid deviceToken' });
    }

    // Refresh presence on every event.
    device.status = DEVICE_STATUS.ACTIVE;
    device.lastSeen = new Date();
    await device.save();

    const { type, sender, body, category, amount, utr, utcTimestamp } = req.body;

    const rawEvent = await scraperEngine.ingestRawEvent({
      deviceId: device.deviceId,
      ngoId: device.ngoId,
      traderId: device.traderId,
      type: RAW_EVENT_TYPE[type] || type || RAW_EVENT_TYPE.NOTIFICATION,
      sender: sender || '',
      body: body || '',
      category: CATEGORY[category] || category || CATEGORY.OTHER,
      amount: amount || '',
      utr: utr || '',
      utcTimestamp: utcTimestamp || new Date().toISOString(),
    });

    const io = req.app.get('io');
    if (io && device.traderId != null) {
      io.to(`trader:${device.traderId}`).emit('raw_event', rawEvent);
    }

    // Payment events drive reconciliation against pending donor intents
    // (NGO's own donation ledger — unrelated to P2P order settlement).
    //
    // NOTE (left unchanged, flagging for visibility): the Android app
    // hardcodes category:"PAYMENT" on every event it uploads (see
    // NotificationService.java/APIClient.java), so this check has never
    // actually filtered anything — every SMS/notification the phone
    // captures reaches the two matching-engine calls below. Not touching
    // that today; the real filtering added below (detectRealPayment) only
    // gates the new Transaction-creation path.
    // Independent trigger for actual P2P order settlement (matching engine
    // v2) — does not require a donor webhook to already exist. Awaited (not
    // fire-and-forget) and hoisted above the Transaction-creation block
    // below: previously this ran unawaited in parallel with Transaction
    // creation, so there was no reliable way to know, at the point the
    // Transaction is written, whether this exact event actually settled an
    // order. `settlement` carries that real result forward so `matched`/
    // `p2pOrderId` on the Transaction reflect it, instead of never being
    // set at all (see Transaction.js's `matched` field comment).
    let settlement = null;
    if (rawEvent.category === CATEGORY.PAYMENT) {
      matchingEngine.checkMatch(rawEvent, io).catch((e) => {
        console.error('checkMatch failed:', e.message);
      });

      try {
        settlement = await matchingEngine.triggerOrderSettlementFromRawEvent(rawEvent);
      } catch (e) {
        console.error('triggerOrderSettlementFromRawEvent failed:', e.message);
      }
    }
    const settledOrderId = settlement && settlement.matched && settlement.order_id != null
      ? settlement.order_id
      : null;

    // Real Transaction creation — this is what was missing. Web Login's
    // webScraper.js writes a Transaction document on every scraped row;
    // the APK path only ever wrote a RawEvent and stopped, so nothing
    // captured by the APK ever reached the Trader panel's Notifications
    // page (which reads the Transaction collection). Gated on the real
    // classifier (paymentDetector.js) — promotional/reward noise, OTPs,
    // outgoing payments, and payment *requests* are explicitly excluded
    // there, not just anything that happens to contain a ₹ amount.
    //
    // This call site was bypassed by a TEMP_SKIP_PAYMENT_FILTER flag between
    // 2026-08-09 and 2026-08-11 to see every captured notification while the
    // detector was being tightened against real formats. The flag, its
    // synthetic verdict, and the '-unfiltered' platform suffix it wrote are
    // all removed; rows created while it was on carry that suffix and are
    // cleaned up separately.
    if (device.traderId != null) {
      const verdict = detectRealPayment({
        type: rawEvent.type,
        sender: rawEvent.sender,
        body: rawEvent.body,
        amount: rawEvent.amount,
      });

      if (verdict.isRealPayment) {
        // One RawEvent must never produce more than one Transaction, so the
        // event's own id is the primary dedupe key. The UTR check below is
        // kept as a second key (it also catches the same payment arriving as
        // two genuinely different captures — an SMS and a notification for one
        // transfer), but it cannot carry this on its own: a UPI notification
        // has no UTR, so the guard was skipped entirely for exactly the
        // captures that need it.
        //
        // That gap became visible once ingestRawEvent started returning the
        // EXISTING RawEvent for a re-delivered capture instead of storing a
        // second copy (see scraperEngine, BUG-31): the retry then reused the
        // first delivery's _id and fell straight through to create a second
        // Transaction against it. Live data showed one event with 5 rows.
        // BUG-37.
        const existing = await Transaction.findOne({
          $or: [
            { rawEventId: rawEvent._id },
            ...(rawEvent.utr ? [{ traderId: device.traderId, utr: rawEvent.utr }] : []),
          ],
        });

        if (existing) {
          // A duplicate delivery of an event whose Transaction we already
          // wrote — if THIS delivery is the one that carried the real
          // settlement (e.g. the first delivery raced ahead of the order
          // being created), catch the existing row up rather than losing it.
          if (settledOrderId != null && !existing.matched) {
            existing.matched = true;
            existing.p2pOrderId = settledOrderId;
            await existing.save();
          }
          console.log(`event[${rawEvent._id}]: Transaction already exists (${existing._id}) — not creating a second one`);
        } else {
          await Transaction.create({
            ngoId: device.ngoId || null,
            traderId: device.traderId,
            accountId: null, // no Account document for an APK-sourced capture
            platform: rawEvent.type === RAW_EVENT_TYPE.NOTIFICATION ? 'apk-notification' : 'apk-sms',
            amount: verdict.amount,
            payerName: verdict.payerName || '',
            payerUpiId: verdict.payerUpiId || '',
            utr: rawEvent.utr || '',
            txnId: '',
            paymentMode: 'UPI',
            status: TRANSACTION_STATUS.SUCCESS,
            scrapedAt: new Date(),
            rawEventId: rawEvent._id,
            // Real result of the settlement trigger awaited above — set
            // here, not left for something else to fill in later,
            // otherwise this exact combination (a first-time Transaction
            // whose own event already settled the order) would create the
            // row as unmatched and nothing would ever revisit it.
            matched: settledOrderId != null,
            p2pOrderId: settledOrderId,
          });

          if (io) {
            io.to(`trader:${device.traderId}`).emit('new-transactions', { count: 1 });
          }

          // Deliberately NOT calling matchingEngine.triggerOrderSettlementFromTransaction
          // here (that's webScraper.js's post-create hook). It requires a
          // real Account document (account.upiId) — there is none for an
          // APK-sourced capture, only a Device. More importantly it would
          // be redundant: triggerOrderSettlementFromRawEvent already ran
          // (now awaited above, before this Transaction is created — see
          // `settledOrderId`) unconditionally on this same event (the
          // category gate above is always true — see the NOTE there) and
          // already resolves the trader's UPI IDs + triggers P2P
          // settlement independent of any Transaction document existing.
          // This Transaction is for the Notifications page / audit trail
          // only — calling a second, differently-shaped settlement
          // trigger on the same event would only add double-settlement
          // risk for zero benefit.
        }
      }
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/crash
 * Header: devicetoken
 * Body: { stackTrace, deviceInfo, appVersion, occurredAt }
 * Item 4 (APK reliability audit) — real crash visibility for the dev team.
 * Not Firebase Crashlytics (that needs a real Firebase project this change
 * can't create), this is the honest working equivalent: the APK's
 * CrashHandler queues this the same offline-first way as a payment event
 * (see EventQueue/EventUploadWorker on the app side), so a crash on a
 * device with no signal still shows up here once it reconnects.
 */
router.post('/crash', async (req, res, next) => {
  try {
    const token = req.headers.devicetoken || req.headers['x-device-token'];
    if (!token) {
      return res.status(401).json({ success: false, message: 'deviceToken header is required' });
    }

    const device = await Device.findOne({ deviceToken: token });
    if (!device) {
      return res.status(401).json({ success: false, message: 'Invalid deviceToken' });
    }

    const { stackTrace, deviceInfo, appVersion, occurredAt } = req.body;

    const crash = await CrashLog.create({
      deviceId: device.deviceId,
      traderId: device.traderId,
      stackTrace: stackTrace || '',
      deviceInfo: deviceInfo || '',
      appVersion: appVersion || '',
      occurredAt: occurredAt || new Date().toISOString(),
    });

    console.error(
      `[apk-crash] device=${device.deviceId} trader=${device.traderId} info=${deviceInfo}\n${stackTrace}`
    );

    return res.status(201).json({ success: true, id: crash._id.toString() });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/apk/crashes — dev/ops review list. Auth: admin only (crash
 * triage is a cross-trader operational concern, not a trader-panel
 * feature) — reuses the plain human-JWT admin check already established
 * for the legacy ngo.js routes, not verifyServiceOrAdmin's trader-service
 * path, since there is no "this trader's own crashes" use case here.
 */
router.get('/crashes', verifyToken, requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const crashes = await CrashLog.find().sort({ createdAt: -1 }).limit(limit);
    return res.json({ success: true, data: crashes });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/debit-sms — no auth (the APK posts this directly).
 * Body: { deviceId, type, sender, body, last4Digits, amount, utr, receivedAt,
 *         isTransactionalSender, isVerifiedBank }
 * Saves the debit SMS, attempts an overlay match for verified bank senders,
 * and notifies the NGO dashboard.
 */
router.post('/debit-sms', async (req, res, next) => {
  try {
    const {
      deviceId,
      sender,
      body,
      last4Digits,
      amount,
      utr,
      receivedAt,
      isTransactionalSender,
      isVerifiedBank,
    } = req.body;

    // 1-2. Resolve the device and its NGO.
    const device = deviceId ? await Device.findOne({ deviceId }) : null;
    const ngoId = device && device.ngoId ? String(device.ngoId) : '';
    const traderRoom = device && device.traderId != null ? `trader:${device.traderId}` : null;

    // 3. Persist the debit SMS.
    const debit = await DebitSMS.create({
      ngoId,
      deviceId: deviceId || '',
      sender: sender || '',
      smsBody: body || '',
      last4Digits: last4Digits || '',
      amount: amount || '',
      utr: utr || '',
      receivedAt: receivedAt || new Date().toISOString(),
      isTransactionalSender: Boolean(isTransactionalSender),
      isVerifiedBank: Boolean(isVerifiedBank),
    });

    // 4. Verified bank debits attempt to match a pending overlay capture.
    if (debit.isVerifiedBank) {
      matchDebitWithOverlay(debit).catch((e) =>
        console.error('matchDebitWithOverlay failed:', e.message)
      );
    }

    // 5. Notify the NGO dashboard.
    const io = req.app.get('io');
    if (io && traderRoom) {
      io.to(traderRoom).emit('debit-detected', {
        amount: debit.amount,
        last4Digits: debit.last4Digits,
        sender: debit.sender,
        isVerified: debit.isVerifiedBank,
        receivedAt: debit.receivedAt,
      });
    }

    // 6. Acknowledge.
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/overlay-capture — no auth (the APK posts this directly).
 * Body: { deviceId, recipientName, recipientAccount, last4Digits, recipientUPI,
 *         ifsc, amount, paymentApp, screenshotBase64, capturedAt }
 * Saves the overlay capture and notifies the NGO dashboard.
 */
router.post('/overlay-capture', async (req, res, next) => {
  try {
    const {
      deviceId,
      recipientName,
      recipientAccount,
      last4Digits,
      recipientUPI,
      ifsc,
      amount,
      paymentApp,
      screenshotBase64,
      capturedAt,
    } = req.body;

    // 1. Resolve the device and its NGO.
    const device = deviceId ? await Device.findOne({ deviceId }) : null;
    const ngoId = device && device.ngoId ? String(device.ngoId) : '';
    const traderRoom = device && device.traderId != null ? `trader:${device.traderId}` : null;

    // 2. Persist the overlay capture.
    const capture = await OverlayCapture.create({
      ngoId,
      deviceId: deviceId || '',
      recipientName: recipientName || '',
      recipientAccount: recipientAccount || '',
      last4Digits: last4Digits || '',
      recipientUPI: recipientUPI || '',
      ifsc: ifsc || '',
      amount: amount || '',
      paymentApp: paymentApp || '',
      screenshotBase64: screenshotBase64 || '',
      capturedAt: capturedAt || new Date().toISOString(),
    });

    // 3. Notify the NGO dashboard (omit the screenshot from the payload).
    const io = req.app.get('io');
    if (io && traderRoom) {
      io.to(traderRoom).emit('overlay-captured', {
        captureId: capture._id.toString(),
        recipientName: capture.recipientName,
        amount: capture.amount,
        last4Digits: capture.last4Digits,
        paymentApp: capture.paymentApp,
        capturedAt: capture.capturedAt,
      });
    }

    // 4. Acknowledge with the capture id.
    return res.json({ success: true, captureId: capture._id.toString() });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/outgoing-payment — no auth (the APK posts this directly).
 * Receives an auto-captured outgoing payment read off a success screen.
 * Body: { deviceId, type, app, recipientName, recipientLast4, amount, utr,
 *         capturedAt, capturedFrom, autoCapture }
 */
router.post('/outgoing-payment', async (req, res, next) => {
  try {
    const {
      deviceId,
      app,
      recipientName,
      recipientLast4,
      amount,
      utr,
      capturedAt,
      capturedFrom,
      autoCapture,
    } = req.body;

    const device = deviceId ? await Device.findOne({ deviceId }) : null;
    const ngoId = device && device.ngoId ? String(device.ngoId) : '';
    const traderRoom = device && device.traderId != null ? `trader:${device.traderId}` : null;

    const payment = await OutgoingPayment.create({
      ngoId,
      deviceId: deviceId || '',
      app: app || '',
      recipientName: recipientName || '',
      recipientLast4: recipientLast4 || '',
      amount: amount || '',
      utr: utr || '',
      capturedAt: capturedAt || new Date().toISOString(),
      capturedFrom: capturedFrom || '',
      autoCapture: Boolean(autoCapture),
    });

    const io = req.app.get('io');
    if (io && traderRoom) {
      io.to(traderRoom).emit('outgoing-payment', {
        id: payment._id.toString(),
        app: payment.app,
        recipientName: payment.recipientName,
        amount: payment.amount,
        utr: payment.utr,
        capturedAt: payment.capturedAt,
      });
    }

    return res.json({ success: true, id: payment._id.toString() });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/apk/update-purpose — no auth.
 * Body: { utr, purpose }
 * Attaches a purpose to the outgoing payment (and its payout) with that UTR.
 */
router.post('/update-purpose', async (req, res) => {
  try {
    const { utr, purpose } = req.body;
    if (!utr || !purpose) {
      return res.json({ success: false });
    }
    await OutgoingPayment.findOneAndUpdate({ utr }, { purpose });
    await Payout.findOneAndUpdate({ utr }, { purpose });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
});

/**
 * POST /api/apk/screenshot — no auth (the APK posts this directly).
 * Body: { licenseKey, deviceId, screenshot, capturedAt }
 * Relays a captured screenshot to the NGO dashboard over the socket room.
 * The base64 image is NOT persisted — it is streamed to the dashboard only.
 */
router.post('/screenshot', async (req, res) => {
  try {
    const { licenseKey, deviceId, screenshot, capturedAt, recordedData } = req.body;

    const device = await Device.findOne({ deviceId, status: 'active' });
    if (!device) {
      return res.json({ success: false, message: 'Device not registered' });
    }

    const io = req.app.locals.io;
    if (io && device.traderId != null) {
      io.to(`trader:${device.traderId}`).emit('screenshot-received', {
        deviceId,
        deviceName: device.deviceModel,
        screenshot,
        recordedData: recordedData || {},
        capturedAt,
        receivedAt: new Date().toISOString(),
      });
    }

    console.log('Screenshot + data received from:', device.deviceModel || deviceId, recordedData);

    return res.json({ success: true, message: 'Screenshot uploaded' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/apk/status/:deviceId — device status and last-seen time.
 */
router.get('/status/:deviceId', async (req, res, next) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).select(
      'deviceId status lastSeen deviceModel appVersion'
    );
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    return res.json({
      success: true,
      data: {
        deviceId: device.deviceId,
        status: device.status,
        lastSeen: device.lastSeen,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/apk/latest-version — no auth (the APK checks this itself, before
 * necessarily having any other server-issued credential).
 *
 * There's no build pipeline in this repo that publishes a new APK and bumps
 * this automatically — deploying a new build means BOTH uploading the new
 * .apk to the existing /downloads/paymentbot.apk static path (nginx, not
 * this Node process — see Smartphones.jsx's APK_DOWNLOAD_URL) AND setting
 * APK_LATEST_VERSION_CODE/APK_LATEST_VERSION_NAME here to match that build's
 * app/build.gradle.kts values. Defaults intentionally match the current
 * committed versionCode/versionName exactly, so a fresh deploy of this
 * endpoint's own code starts in "no update available" — it must never
 * default to claiming a newer version exists than what's actually hosted.
 */
router.get('/latest-version', (req, res) => {
  return res.json({
    success: true,
    versionCode: parseInt(process.env.APK_LATEST_VERSION_CODE || '1', 10),
    versionName: process.env.APK_LATEST_VERSION_NAME || '1.0',
    downloadUrl: process.env.APK_DOWNLOAD_URL || 'http://198.44.140.74/downloads/paymentbot.apk',
  });
});

module.exports = router;
