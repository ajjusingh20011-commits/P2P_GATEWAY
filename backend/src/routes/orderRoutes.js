'use strict';

/**
 * Order routes — mounted at /api/orders.
 *   POST /create        merchant API key
 *   GET  /:id           public (checkout reads this)
 *   POST /:id/confirm    public (customer confirms → paid)
 *   POST /:id/paid       public (customer confirms → paid)
 *   POST /:id/expire     trader/admin/internal
 *   POST /:id/trader-confirm  trader (own order, under_review only)
 *   POST /:id/reopen-for-review  trader (own order, cancelled/failed only, requires UTR)
 *   POST /:id/dispute    any authenticated user
 *   GET  /              authenticated (role-scoped list)
 */

const { Router } = require('express');
const orderController = require('../controllers/orderController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { verifyInternalService } = require('../middleware/internalAuth');

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
// Public (checkout page): customer-initiated cancel, pending/checkout_open
// only. Distinct from the authenticated /:id/cancel below (trader/admin).
router.post('/:id/cancel-checkout', orderController.cancelCheckout);
// Internal callback: NGO backend -> P2P backend once it verifies a payment.
//
// Was unauthenticated and publicly reachable on the production API host, and
// flips an order to `success` — confirmed live. Now requires the same signed
// service token as /api/internal/* (middleware/internalAuth.js).
//
// Locking this down cannot break real settlement: it has no reachable caller.
// Its only caller is ngo-backend's matchingEngine.notifyP2PBackend, which
// returns immediately unless webhook.orderId is set, and nothing populates
// that field any more — the checkout -> ngo-backend bridge that used to was
// retired on 2026-08-06 (see claimPaid's comment), and the sole Webhook
// creation site never sets it. Real settlement runs through matchingEngineV2
// via POST /api/internal/match-settlement instead. The token is nonetheless
// sent by notifyP2PBackend, so the path works if it is ever revived.
router.post('/verify-payment', verifyInternalService, orderController.verifyPayment);
router.post('/:id/cancel', verifyToken, checkRole('trader', 'admin'), orderController.cancel);
router.post('/:id/expire', verifyToken, checkRole('trader', 'admin'), orderController.expire);
router.post('/:id/trader-confirm', verifyToken, checkRole('trader'), orderController.traderConfirm);
router.post('/:id/reopen-for-review', verifyToken, checkRole('trader'), orderController.reopenForReview);
router.post('/:id/dispute', verifyToken, orderController.dispute);

module.exports = router;
