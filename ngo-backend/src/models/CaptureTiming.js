const mongoose = require('mongoose');

/**
 * Diagnostic-only: the four timestamps that describe how long a captured
 * payment took to reach us, and where the time went.
 *
 * Written by POST /api/apk/capture-timing (routes/captureTiming.js), which the
 * phone calls alongside the real capture upload. Deliberately a separate
 * collection and a separate request rather than extra fields on RawEvent: this
 * is a temporary investigation into the reported 10-14 minute gap, and it
 * should be removable without touching the capture path that moves money.
 *
 * Joined back to the real RawEvent on (deviceId, utcTimestamp) — utcTimestamp
 * is the notification's own post time, formatted identically by the same
 * TimeFormatter on both uploads, so it identifies the same capture.
 */
const captureTimingSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    traderId: { type: Number, default: null, index: true },
    /** "NOTIFICATION" or "SMS" — the two capture paths under comparison. */
    captureSource: { type: String, default: '' },
    /** Android package for notifications; the SMS sender address for SMS. */
    origin: { type: String, default: '' },

    // ---- the four timestamps ----
    /**
     * 1. Embedded — the time written INSIDE the message text ("at 11:05 pm"),
     * which is what the trader reads and compares against. Stored raw as well
     * as parsed: the raw string is evidence, the epoch is only our reading of
     * it, and a parse that guesses wrong must not be able to masquerade as
     * data.
     */
    embeddedTimeText: { type: String, default: '' },
    embeddedTimeMs: { type: Number, default: null },
    /**
     * 2. System post — Android's own record of when the notification was
     * posted (StatusBarNotification.getPostTime), or for SMS the telephony
     * layer's received timestamp (SmsMessage.getTimestampMillis). Independent
     * of our code entirely.
     */
    systemPostTimeMs: { type: Number, default: null },
    /**
     * 3. App reaction — wall clock at the instant our callback actually ran
     * (onNotificationPosted / SMSReceiver.onReceive). The gap from 2 to 3 is
     * the OS holding the event back from us.
     */
    appReactionTimeMs: { type: Number, default: null },
    /** 4. Server received — stamped here, on arrival. */
    serverReceivedAt: { type: Date, default: Date.now },

    /** The join key back to RawEvent, and enough text to identify the event. */
    utcTimestamp: { type: String, default: '', index: true },
    bodyPreview: { type: String, default: '' },
    amount: { type: String, default: '' },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CaptureTiming', captureTimingSchema);
