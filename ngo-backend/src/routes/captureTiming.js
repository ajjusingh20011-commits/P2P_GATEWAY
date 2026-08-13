const express = require('express');
const Device = require('../models/Device');
const CaptureTiming = require('../models/CaptureTiming');

/**
 * Diagnostic capture-timing probe — mounted alongside the real APK router on
 * /api/apk, in its own file so the capture path that moves money is untouched
 * by this investigation and so the whole thing can be deleted in one piece.
 *
 * The phone posts here right after it queues the real event, carrying the
 * three timestamps only it can know (embedded, system post, app reaction).
 * The fourth — server received — is stamped on arrival below.
 */
const router = express.Router();

/**
 * POST /api/apk/capture-timing
 * Header: deviceToken
 * Body: { captureSource, origin, embeddedTimeText, embeddedTimeMs,
 *         systemPostTimeMs, appReactionTimeMs, utcTimestamp, bodyPreview, amount }
 */
router.post('/capture-timing', async (req, res) => {
  try {
    const token = req.headers.devicetoken || req.headers['x-device-token'];
    if (!token) {
      return res.status(401).json({ success: false, message: 'deviceToken header is required' });
    }
    const device = await Device.findOne({ deviceToken: token });
    if (!device) {
      return res.status(401).json({ success: false, message: 'Invalid deviceToken' });
    }

    const b = req.body || {};
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const doc = await CaptureTiming.create({
      deviceId: device.deviceId,
      traderId: device.traderId,
      captureSource: String(b.captureSource || ''),
      origin: String(b.origin || ''),
      embeddedTimeText: String(b.embeddedTimeText || ''),
      embeddedTimeMs: num(b.embeddedTimeMs),
      systemPostTimeMs: num(b.systemPostTimeMs),
      appReactionTimeMs: num(b.appReactionTimeMs),
      serverReceivedAt: new Date(),
      utcTimestamp: String(b.utcTimestamp || ''),
      bodyPreview: String(b.bodyPreview || '').slice(0, 300),
      amount: String(b.amount || ''),
    });

    // One line carrying the whole picture, so the gaps are readable straight
    // from the log without querying anything. Seconds, because the reported
    // problem is minutes — millisecond precision here would be false rigour.
    const sec = (a, z) => (a && z ? `${((z - a) / 1000).toFixed(1)}s` : 'n/a');
    const serverMs = doc.serverReceivedAt.getTime();
    console.log(
      `timing[${doc._id}] ${doc.captureSource} ${doc.origin || '(no origin)'} amount=${doc.amount || '-'}\n`
      + `  embedded="${doc.embeddedTimeText || '(none)'}" -> post ${sec(doc.embeddedTimeMs, doc.systemPostTimeMs)}`
      + ` | post -> app ${sec(doc.systemPostTimeMs, doc.appReactionTimeMs)}`
      + ` | app -> server ${sec(doc.appReactionTimeMs, serverMs)}`
      + ` | total ${sec(doc.embeddedTimeMs || doc.systemPostTimeMs, serverMs)}`
    );

    return res.json({ success: true, id: doc._id });
  } catch (err) {
    // Never surface a diagnostic failure to the phone as an error it will
    // retry forever — this endpoint must not be able to disturb capture.
    console.error('capture-timing failed:', err.message);
    return res.json({ success: true, recorded: false });
  }
});

module.exports = router;
