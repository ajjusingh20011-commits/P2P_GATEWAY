const crypto = require('crypto');
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
      index: true,
    },
    // Public, URL-safe identifier used in the checkout link.
    campaignId: {
      type: String,
      unique: true,
      index: true,
      default: () => crypto.randomBytes(8).toString('hex'),
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    targetAmount: { type: Number, default: 0 },
    raisedAmount: { type: Number, default: 0 },
    checkoutUrl: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
