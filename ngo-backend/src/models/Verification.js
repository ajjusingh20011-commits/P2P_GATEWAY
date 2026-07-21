const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  verifyId: { type: String, required: true, unique: true },
  ngoId: { type: String, required: true },
  orderId: { type: String, default: '' },
  amount: { type: String, required: true },
  purpose: { type: String, default: '' },
  donorClickedAt: { type: String },
  status: {
    type: String,
    enum: ['pending', 'matched', 'failed'],
    default: 'pending',
  },
  transactionId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Verification', verificationSchema);
