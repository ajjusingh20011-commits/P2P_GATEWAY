'use strict';

/**
 * Merchant API-key authentication for server-to-server endpoints
 * (e.g. POST /api/orders/create).
 *
 * Expects headers:
 *   X-API-Key:    merchant public key
 *   X-API-Secret: merchant secret
 *
 * On success attaches req.merchant (with secret loaded).
 */

const db = require('../models');

async function apiKeyAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];

    if (!apiKey || !apiSecret) {
      return res
        .status(401)
        .json({ success: false, message: 'Missing X-API-Key / X-API-Secret headers', code: 'API_KEY_MISSING' });
    }

    const merchant = await db.Merchant.scope('withSecret').findOne({ where: { api_key: apiKey } });
    if (!merchant || merchant.api_secret !== apiSecret) {
      return res.status(401).json({ success: false, message: 'Invalid API credentials', code: 'API_KEY_INVALID' });
    }

    if (!merchant.is_active) {
      return res.status(403).json({ success: false, message: 'Merchant account is inactive', code: 'MERCHANT_INACTIVE' });
    }

    req.merchant = merchant;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { apiKeyAuth };
