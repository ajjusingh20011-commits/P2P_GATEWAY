const mongoose = require('mongoose');
const { WEBHOOK_STATUS, WEBHOOK_EXPIRY_MINUTES } = require('../config/constants');

const webhookSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
      index: true,
    },
    donorName: { type: String, default: '' },
    donorEmail: { type: String, default: '' },
    donorPhone: { type: String, default: '' },
    amount: { type: String, required: true },
    purpose: { type: String, default: '' },
    campaignId: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(WEBHOOK_STATUS),
      default: WEBHOOK_STATUS.PENDING,
      index: true,
    },
    // Donation intents remain open for matching for 2 hours by default.
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + WEBHOOK_EXPIRY_MINUTES * 60 * 1000),
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Webhook', webhookSchema);
