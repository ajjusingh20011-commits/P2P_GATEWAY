const mongoose = require('mongoose');

/**
 * Item 4 (APK reliability audit) — field crash visibility. Not real Firebase
 * Crashlytics (that needs a real Firebase project + google-services.json,
 * both external account actions), this is the honest working equivalent:
 * the APK's CrashHandler persists crashes locally and best-effort uploads
 * them here via the same offline-first queue every payment event uses, so
 * a crash in the field is actually visible to the dev team instead of
 * silently vanishing with the process.
 */
const crashLogSchema = new mongoose.Schema(
  {
    deviceId: { type: String, default: '', index: true },
    traderId: { type: Number, default: null, index: true },
    stackTrace: { type: String, default: '' },
    deviceInfo: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    occurredAt: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CrashLog', crashLogSchema);
