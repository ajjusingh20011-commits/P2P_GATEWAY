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
      // Duplicate-capture investigation — notification identity + raw post time.
      // Two rows with the same notifKey are the SAME notification (a redelivery
      // after a listener rebind), not a second GPay post; a rawPostTimeMs of 0
      // means the systemPostTimeMs above is our wall-clock fallback, not GPay's.
      notifKey: String(b.notifKey || ''),
      // Raw (not via num()) so a legitimate 0 survives — for rawPostTimeMs, 0 IS
      // the signal (getPostTime() returned <=0, so systemPostTimeMs is our
      // fallback wall clock, not GPay's post time).
      notifId: Number.isFinite(Number(b.notifId)) ? Number(b.notifId) : null,
      notifTag: String(b.notifTag || ''),
      groupKey: String(b.groupKey || ''),
      rawPostTimeMs: Number.isFinite(Number(b.rawPostTimeMs)) ? Number(b.rawPostTimeMs) : null,
      // Paytm Business investigation (temporary) — see the model's doc comment.
      isGroupSummary: typeof b.isGroupSummary === 'boolean' ? b.isGroupSummary : null,
      extrasDump: String(b.extrasDump || ''),
      resolvedTitle: String(b.resolvedTitle || ''),
      resolvedText: String(b.resolvedText || ''),
      resolvedBigText: String(b.resolvedBigText || ''),
      resolvedSubText: String(b.resolvedSubText || ''),
      resolvedSummaryText: String(b.resolvedSummaryText || ''),
      // BUG-57 confirmation signal (temporary) — see the model's doc comment.
      customViewAttempted: typeof b.customViewAttempted === 'boolean' ? b.customViewAttempted : null,
      customViewSucceeded: typeof b.customViewSucceeded === 'boolean' ? b.customViewSucceeded : null,
      customViewExtractedText: String(b.customViewExtractedText || ''),
      customViewError: String(b.customViewError || ''),
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
      + ` | total ${sec(doc.embeddedTimeMs || doc.systemPostTimeMs, serverMs)}\n`
      + `  key=${doc.notifKey || '(none)'} rawPost=${doc.rawPostTimeMs == null ? '(none)' : doc.rawPostTimeMs}`
      + ` groupKey=${doc.groupKey || '(none)'} isGroupSummary=${doc.isGroupSummary == null ? '(n/a)' : doc.isGroupSummary}\n`
      + `  extrasDump=${doc.extrasDump || '(empty)'}\n`
      + `  customView: attempted=${doc.customViewAttempted == null ? '(n/a)' : doc.customViewAttempted}`
      + ` succeeded=${doc.customViewSucceeded == null ? '(n/a)' : doc.customViewSucceeded}`
      + ` error=${doc.customViewError || '(none)'}`
      + ` extractedText=${doc.customViewExtractedText || '(empty)'}`
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
