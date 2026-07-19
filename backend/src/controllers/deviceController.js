'use strict';

/**
 * deviceController — APK device registration + heartbeat.
 *
 *   POST /api/device/register    (trader auth)   register a phone -> device token
 *   POST /api/device/heartbeat   (device auth)   30s ping -> mark online
 *   POST /api/device/sms         (device auth)   -> paymentController.sms (Engine 1)
 *   POST /api/device/notification(device auth)   -> paymentController.notification (Engine 2)
 *   POST /api/device/screen      (device auth)   -> paymentController.screen (Engine 3)
 *
 * The sms/notification/screen handlers are shared with paymentController.
 */

const db = require('../models');
const { ok, created, fail, asyncHandler } = require('../utils/http');
const { deviceToken } = require('../utils/ids');
const { emitToAdmin } = require('../websocket');
const paymentController = require('./paymentController');

/* ---------------------------- POST /register ------------------------------ */
const register = asyncHandler(async (req, res) => {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) return fail(res, 404, 'Trader profile not found');

  const { device_id, device_name, connection_type } = req.body || {};
  if (!device_id) return fail(res, 422, 'device_id is required');

  const token = deviceToken();

  // Re-register (same device_id) rotates the token; otherwise create.
  const existing = await db.Smartphone.unscoped().findOne({ where: { device_id } });
  let device;
  if (existing) {
    await existing.update({
      auth_token: token,
      device_name: device_name || existing.device_name,
      connection_type: connection_type || existing.connection_type,
      trader_id: trader.id,
      is_online: true,
      last_ping: new Date(),
    });
    device = existing;
  } else {
    device = await db.Smartphone.create({
      trader_id: trader.id,
      device_id,
      device_name: device_name || 'Unknown device',
      connection_type: connection_type || 'notification',
      auth_token: token,
      is_online: true,
      last_ping: new Date(),
    });
  }

  return created(res, {
    device: { id: device.id, device_id: device.device_id, device_name: device.device_name },
    device_token: token,
  });
});

/* --------------------------- POST /heartbeat ------------------------------ */
const heartbeat = asyncHandler(async (req, res) => {
  const device = req.device;
  await device.update({ is_online: true, last_ping: new Date() });

  // Keep the owning trader marked online too.
  if (device.trader_id) {
    await db.Trader.update({ is_online: true, last_heartbeat: new Date() }, { where: { id: device.trader_id } });
  }

  emitToAdmin('device:heartbeat', { device_id: device.id, trader_id: device.trader_id });
  return ok(res, { device_id: device.id, online: true, ts: new Date().toISOString() });
});

module.exports = {
  register,
  heartbeat,
  // Detection endpoints reuse the payment controller (device-authed).
  sms: paymentController.sms,
  notification: paymentController.notification,
  screen: paymentController.screen,
};
