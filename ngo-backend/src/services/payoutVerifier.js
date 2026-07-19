const crypto = require('crypto');
const OverlayCapture = require('../models/OverlayCapture');
const Payout = require('../models/Payout');
const DebitSMS = require('../models/DebitSMS');

/**
 * Reconciles a captured DEBIT SMS with a pending overlay capture. When all four
 * verification layers pass (amount, last-4, time window, legit sender), it
 * records a hash-chained, verified Payout and marks both source records matched.
 *
 * @param {Object} debitData a saved DebitSMS document (has _id, ngoId, amount,
 *   last4Digits, receivedAt, utr, isVerifiedBank)
 * @returns {Promise<Object|null>} the created Payout, or null if no match
 */
async function matchDebitWithOverlay(debitData) {
  // Find a recent overlay capture for the same NGO within 10 minutes of the SMS.
  const timeWindow = new Date(
    new Date(debitData.receivedAt).getTime() - 10 * 60 * 1000
  );

  const overlay = await OverlayCapture.findOne({
    ngoId: debitData.ngoId,
    amount: debitData.amount,
    last4Digits: debitData.last4Digits,
    capturedAt: { $gte: timeWindow.toISOString() },
    verificationStatus: 'pending',
  });

  if (!overlay) {
    console.log('No matching overlay found');
    return null;
  }

  // Verify all layers.
  const amountMatch = overlay.amount === debitData.amount;
  const last4Match = overlay.last4Digits === debitData.last4Digits;

  const overlayTime = new Date(overlay.capturedAt);
  const smsTime = new Date(debitData.receivedAt);
  const timeDiff = Math.abs(smsTime - overlayTime) / 1000 / 60;
  const timeMatch = timeDiff <= 10;

  const senderLegit = Boolean(debitData.isVerifiedBank);

  const overallVerified = amountMatch && last4Match && timeMatch && senderLegit;

  if (!overallVerified) {
    return null;
  }

  // Build the payout record, then hash-chain it. (The hash is computed over the
  // record's own fields, so it is derived AFTER the data object exists.)
  const lastPayout = await Payout.findOne({}).sort({ createdAt: -1 });
  const prevHash = (lastPayout && lastPayout.hash) || '0000000000';

  const payoutData = {
    ngoId: debitData.ngoId,
    recipientName: overlay.recipientName,
    recipientUPI: overlay.recipientUPI,
    recipientAccount: overlay.recipientAccount,
    amount: debitData.amount,
    utr: debitData.utr,
    last4Digits: debitData.last4Digits,
    paymentApp: overlay.paymentApp,
    overlayId: overlay._id.toString(),
    debitSmsId: debitData._id.toString(),
    verificationLayers: {
      amountMatch,
      last4Match,
      timeMatch,
      senderLegit,
    },
    overallVerified: true,
    prevHash,
  };

  const hash = crypto
    .createHash('sha256')
    .update(prevHash + JSON.stringify(payoutData))
    .digest('hex');

  const payout = await Payout.create({ ...payoutData, hash });

  // Mark the overlay verified and link it to this SMS.
  await OverlayCapture.findByIdAndUpdate(overlay._id, {
    verificationStatus: 'verified',
    debitSmsId: debitData._id.toString(),
  });

  // Mark the debit SMS matched and link it to the overlay.
  await DebitSMS.findByIdAndUpdate(debitData._id, {
    matched: true,
    overlayId: overlay._id.toString(),
  });

  console.log('PAYOUT VERIFIED:', payout._id);
  return payout;
}

module.exports = { matchDebitWithOverlay };
