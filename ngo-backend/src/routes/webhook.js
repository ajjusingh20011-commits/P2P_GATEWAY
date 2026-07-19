const express = require('express');
const NGO = require('../models/NGO');
const Webhook = require('../models/Webhook');
const matchingEngine = require('../services/matchingEngine');
const { WEBHOOK_EXPIRY_MINUTES } = require('../config/constants');

const router = express.Router();

/**
 * Public donation-intent webhook. A campaign/checkout page posts a pending
 * intent here (authenticated by the NGO's webhookSecret); the matching engine
 * later pairs it with real money movement and commits it to the ledger.
 */

/**
 * POST /api/webhook/donate
 * Body: { ngoId, donorName, donorEmail, donorPhone, amount, purpose,
 *         campaignId, secret }
 */
router.post('/donate', async (req, res, next) => {
  try {
    const {
      ngoId,
      donorName,
      donorEmail,
      donorPhone,
      amount,
      purpose,
      campaignId,
      secret,
    } = req.body;

    if (!ngoId || !amount || !secret) {
      return res.status(400).json({
        success: false,
        message: 'ngoId, amount and secret are required',
      });
    }

    // Verify the shared webhook secret for this NGO.
    const ngo = await NGO.findById(ngoId).select('webhookSecret');
    if (!ngo) {
      return res.status(404).json({ success: false, message: 'NGO not found' });
    }
    if (secret !== ngo.webhookSecret) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
    }

    const webhook = await Webhook.create({
      ngoId,
      donorName,
      donorEmail,
      donorPhone,
      amount,
      purpose,
      campaignId,
      expiresAt: new Date(Date.now() + WEBHOOK_EXPIRY_MINUTES * 60 * 1000),
    });

    // Try an immediate match in case a transaction already landed.
    const io = req.app.get('io');
    const ledgerEntry = await matchingEngine.matchWebhook(webhook, io);

    if (io) {
      io.to(String(ngoId)).emit('donation_intent', webhook);
    }

    return res.status(201).json({
      success: true,
      webhookId: webhook._id,
      matched: Boolean(ledgerEntry),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/webhook/:id — status of a donation intent.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook not found' });
    }
    return res.json({ success: true, data: webhook });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
