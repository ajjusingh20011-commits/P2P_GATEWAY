'use strict';

/**
 * Order routes — mounted at /api/orders.
 *   POST /create        merchant API key
 *   GET  /:id           public (checkout reads this)
 *   POST /:id/confirm    public (customer confirms → paid)
 *   POST /:id/paid       public (customer confirms → paid)
 *   POST /:id/expire     trader/admin/internal
 *   POST /:id/dispute    any authenticated user
 *   GET  /              authenticated (role-scoped list)
 */

const { Router } = require('express');
const orderController = require('../controllers/orderController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

const router = Router();

router.post('/create', apiKeyAuth, orderController.create);
router.get('/', verifyToken, orderController.list);
router.get('/:id', orderController.getOne);
router.get('/:id/checkout', orderController.checkout);
router.post('/:id/new-upi', orderController.newUpi);
// Public (checkout page): mark checkout opened + claim paid.
router.put('/:id/checkout-opened', orderController.checkoutOpened);
router.post('/:id/claim-paid', orderController.claimPaid);
// Public backward-compat aliases (old checkout confirm routes → claim-paid).
router.post('/:id/paid', orderController.markPaid);
router.post('/:id/confirm', orderController.confirm);
router.post('/:id/customer-confirm', orderController.markPaid);
router.post('/:id/cancel', verifyToken, checkRole('trader', 'admin'), orderController.cancel);
router.post('/:id/expire', verifyToken, checkRole('trader', 'admin'), orderController.expire);
router.post('/:id/dispute', verifyToken, orderController.dispute);

module.exports = router;
