'use strict';

/**
 * APK device routes — mounted at /api/device.
 *   POST /register     trader JWT      -> device token
 *   POST /heartbeat    device token    30s ping
 *   POST /sms          device token    Engine 1
 *   POST /notification device token    Engine 2
 *   POST /screen       device token    Engine 3
 */

const { Router } = require('express');
const deviceController = require('../controllers/deviceController');
const { deviceAuth } = require('../middleware/deviceAuth');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.post('/register', verifyToken, checkRole('trader', 'admin'), deviceController.register);
router.post('/heartbeat', deviceAuth, deviceController.heartbeat);
router.post('/sms', deviceAuth, deviceController.sms);
router.post('/notification', deviceAuth, deviceController.notification);
router.post('/screen', deviceAuth, deviceController.screen);

module.exports = router;
