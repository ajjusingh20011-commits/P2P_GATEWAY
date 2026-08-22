'use strict';

/**
 * Redesign Section 4 — the "Unrecognized/Unmatched" review queue.
 *
 * When a real, DLT-shaped bank SMS reaches the server (it passed the phone's
 * broad pre-filter, Section 1) but its header resolves to NO bank in the tiered
 * matcher (Section 2), it is NOT silently dropped — it is recorded here, deduped
 * by its DLT entity code, so an admin can review real evidence and promote a
 * genuinely-new bank into the rule set (the primary, evidence-based way the bank
 * list grows — never external guessing).
 *
 * Deliberately holds the sign-off bank name the SMS itself wrote (Section 2), so
 * review reads the bank's own words, not a cryptic code. Also tracks the
 * Section-7 promotion safeguards: occurrence count (needs several before
 * trusting), whether a valid 12-digit reference was seen, and a short-window
 * volume signal for anomaly review.
 *
 * This is a review/observability store ONLY — nothing here settles money or
 * feeds the settlement matcher (that stays Tier-1 exact, unchanged).
 */

const mongoose = require('mongoose');

const unrecognizedSenderSchema = new mongoose.Schema(
  {
    // DLT entity token parsed from the sender (e.g. "BOMBNK" from "JM-BOMBNK-S").
    // The dedup key: one row per distinct unrecognized header.
    code: { type: String, required: true, unique: true, index: true },
    // Most recent full raw sender seen for this code (e.g. "JM-BOMBNK-S").
    lastSender: { type: String, default: '' },
    // The bank's own name from the SMS sign-off ("- Bank of Maharashtra"), if
    // present — what makes review fast and reliable.
    signoffName: { type: String, default: '' },
    // A recent full body, for the reviewer to read the real message.
    sampleBody: { type: String, default: '' },
    lastAmount: { type: String, default: '' },
    lastUtr: { type: String, default: '' },
    // Section 7 red-flag input: a genuine UPI/IMPS reference is exactly 12 digits.
    hasValidUtr: { type: Boolean, default: false },
    // How many times this exact header has been seen (Section 7: require several
    // real occurrences before promoting, never a single message).
    occurrences: { type: Number, default: 0 },
    // Distinct devices that saw it — a real bank is seen across many; a sudden
    // burst from one is a review signal, not auto-trust.
    deviceIds: { type: [String], default: [] },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    // Review lifecycle. 'promoted' rows are what Section 3's runtime rule store
    // will load to make the bank live across devices; 'ignored' are dismissed.
    status: { type: String, enum: ['pending', 'promoted', 'ignored'], default: 'pending', index: true },
    // Set on promote: the confirmed canonical bank name + code the admin approved.
    confirmedName: { type: String, default: '' },
    confirmedCode: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.UnrecognizedSender
  || mongoose.model('UnrecognizedSender', unrecognizedSenderSchema);
