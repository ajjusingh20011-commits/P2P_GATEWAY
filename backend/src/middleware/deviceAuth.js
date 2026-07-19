'use strict';

/**
 * APK device authentication for the payment-detection endpoints.
 *
 * Expects header:
 *   X-Device-Token: token returned by POST /api/device/register
 *
 * On success attaches req.device (Smartphone, with auth_token loaded).
 */

const db = require('../models');

async function deviceAuth(req, res, next) {
  try {
    const token = req.headers['x-device-token'] || req.body?.device_token;
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: 'Missing X-Device-Token header', code: 'DEVICE_TOKEN_MISSING' });
    }

    // auth_token is excluded by defaultScope, so query unscoped.
    const device = await db.Smartphone.unscoped().findOne({ where: { auth_token: token } });
    if (!device) {
      return res.status(401).json({ success: false, message: 'Invalid device token', code: 'DEVICE_TOKEN_INVALID' });
    }

    req.device = device;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { deviceAuth };
