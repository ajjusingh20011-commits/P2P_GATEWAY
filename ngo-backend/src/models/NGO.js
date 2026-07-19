const crypto = require('crypto');
const mongoose = require('mongoose');
const { NGO_STATUS } = require('../config/constants');

const ngoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(NGO_STATUS),
      default: NGO_STATUS.PENDING,
    },
    // AES-encrypted blob of payment-account credentials.
    encryptedCredentials: { type: String, default: '' },
    // Proxy IP assigned to this NGO for scraping its accounts.
    proxyIp: { type: String, default: '' },
    // Shared secret that donation webhooks must present to post intents.
    webhookSecret: {
      type: String,
      default: () => crypto.randomBytes(24).toString('hex'),
    },
    totalDonations: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NGO', ngoSchema);
