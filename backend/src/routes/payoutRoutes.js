'use strict';

/**
 * Payout-request routes (merchant-facing) — mounted at /api/payout-requests.
 * Trader + admin payout endpoints live under /api/trader and /api/admin
 * respectively (see traderRoutes.js / adminRoutes.js), reusing those role guards.
 */

const { Router } = require('express');
const payoutController = require('../controllers/payoutController');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.use(verifyToken, checkRole('merchant'));

router.post('/', payoutController.create);
router.get('/my', payoutController.listMine);

module.exports = router;
