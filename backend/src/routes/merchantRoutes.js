'use strict';

/**
 * Merchant routes — mounted at /api/merchant. All require a merchant JWT.
 */

const { Router } = require('express');
const merchantController = require('../controllers/merchantController');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.use(verifyToken, checkRole('merchant'));

router.get('/dashboard', merchantController.dashboard);
router.get('/orders', merchantController.orders);
router.post('/orders', merchantController.createOrder);
router.get('/transactions', merchantController.transactions);
router.get('/balance', merchantController.balance);
router.post('/webhook', merchantController.setWebhook);
router.get('/api-credentials', merchantController.getApiCredentials);
router.post('/api-credentials/regenerate', merchantController.regenerateApiCredentials);

module.exports = router;
