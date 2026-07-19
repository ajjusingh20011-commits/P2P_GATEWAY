const mongoose = require('mongoose');
const { RAW_EVENT_TYPE, CATEGORY } = require('../config/constants');

const rawEventSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(RAW_EVENT_TYPE),
      required: true,
    },
    sender: { type: String, default: '' },
    body: { type: String, default: '' },
    category: {
      type: String,
      enum: Object.values(CATEGORY),
      default: CATEGORY.OTHER,
    },
    amount: { type: String, default: '' },
    utcTimestamp: { type: String, default: '' },
    processed: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RawEvent', rawEventSchema);
