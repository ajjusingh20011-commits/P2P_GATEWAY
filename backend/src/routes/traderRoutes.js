'use strict';

/**
 * Trader routes — mounted at /api/trader. All require a trader JWT.
 */

const { Router } = require('express');
const traderController = require('../controllers/traderController');
const payoutController = require('../controllers/payoutController');
const ngoProxyController = require('../controllers/ngoProxyController');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.use(verifyToken, checkRole('trader'));

// Real-trader-authenticated relay to ngo-backend (Web Login accounts,
// smartphone pairing) — see ngoProxyController.js. Replaces the old shared
// ngo_staff login the trader frontend used to authenticate to ngo-backend
// directly with.
router.get('/ngo-socket-token', ngoProxyController.socketToken);
router.all('/ngo-proxy/*', ngoProxyController.forward);

router.get('/dashboard', traderController.dashboard);
router.get('/stats', traderController.stats);
router.get('/commission', traderController.commission);
router.get('/balance-logs', traderController.balanceLogs);
router.get('/orders', traderController.orders);
router.put('/heartbeat', traderController.heartbeat);
router.put('/online-status', traderController.setOnlineStatus);
router.get('/payment-details', traderController.listPaymentDetails);
router.post('/payment-details', traderController.addPaymentDetail);
router.put('/payment-details/:id', traderController.updatePaymentDetail);
router.delete('/payment-details/:id', traderController.deletePaymentDetail);
router.get('/notifications', traderController.notifications);
router.get('/payouts', traderController.listPayouts);
router.post('/payouts', traderController.requestPayout);

// Payout requests ("Buy USDT") — merchant payouts processed by this trader.
router.get('/payout-requests', payoutController.traderList);
router.post('/payout-requests/:id/accept', payoutController.traderAccept);
router.get('/payout-requests/:id/process', payoutController.traderProcess);
router.post('/payout-requests/:id/transferred', payoutController.traderTransferred);
router.post('/payout-requests/:id/cancel', payoutController.traderCancel);
router.get('/payout-cancellations', payoutController.traderCancellations);
router.post('/payout-requests/:id/problem', payoutController.traderProblem);

module.exports = router;
