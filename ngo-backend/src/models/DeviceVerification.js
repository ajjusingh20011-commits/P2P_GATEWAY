const mongoose = require('mongoose');

/**
 * Feature 2 — APK Device Verification via Random Test Payment.
 *
 * A short-lived record correlating "this specific device should see a real
 * payment of this exact amount within the next 5 minutes" — created when a
 * trader starts verifying a newly-linked device (see backend's POST
 * /api/trader/payment-details/:id/verify/start, which mints the random
 * amount + amount-lock and calls this service's internal POST
 * /api/internal/device-verification to create the row).
 *
 * Checked at the point a RawEvent lands in apk.js's POST /event handler —
 * matched on deviceId + amount, not on the trader's whole UPI set the way
 * real settlement (matchingEngineV2) is, since the entire point here is
 * confirming THIS device specifically, not just some device of the
 * trader's. On a match, the row flips to 'verified' and apk.js calls
 * backend's internal POST /api/internal/mark-device-verified to set
 * payment_details.device_verified_at — the real MySQL-side gate
 * routingEngine.eligibleAccountsFor() reads.
 *
 * Expiry: services/jobs/deviceVerificationExpiry.js sweeps 'pending' rows
 * past expiresAt to 'expired', same in-process setInterval pattern as this
 * service's other sweeps (staleClaimSweep etc. on the gateway backend side).
 * A trader retrying after expiry gets a NEW row, same paymentDetailId — this
 * collection is deliberately allowed to accumulate multiple rows per
 * payment detail (one per attempt), not a single mutable slot.
 */
const deviceVerificationSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    // The real trader (MySQL trader.id) — carried for the diagnosis endpoint
    // to scope its Device lookup the same way apk.js's other trader-facing
    // routes do (resolveTraderFilter), so one trader can never probe another's
    // verification attempt by guessing an id.
    traderId: { type: Number, required: true, index: true },
    // MySQL payment_details.id — cross-database reference, not a Mongoose
    // ref, same pattern as Transaction.js's p2pOrderId.
    paymentDetailId: { type: Number, required: true, index: true },
    // String, not Number: matched against RawEvent.amount (also a string —
    // see RawEvent.js), so the comparison at the correlation point is a
    // plain string equality on the same normalized representation, not a
    // float comparison that could drift on paise-level values.
    amount: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'verified', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    verifiedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The correlation check's actual query shape — deviceId + amount + status,
// scanning only unexpired pending rows.
deviceVerificationSchema.index({ deviceId: 1, amount: 1, status: 1 });

module.exports = mongoose.model('DeviceVerification', deviceVerificationSchema);
