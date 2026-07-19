'use strict';

/**
 * Payment-detection routes — mounted at /api/payment.
 * Engines 1-3 authenticate with a device token; Engine 4 (manual) with a
 * trader JWT.
 */

const { Router } = require('express');
const paymentController = require('../controllers/paymentController');
const { deviceAuth } = require('../middleware/deviceAuth');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.post('/sms', deviceAuth, paymentController.sms);
router.post('/notification', deviceAuth, paymentController.notification);
router.post('/screen', deviceAuth, paymentController.screen);
router.post('/manual', verifyToken, checkRole('trader', 'admin'), paymentController.manual);

module.exports = router;
