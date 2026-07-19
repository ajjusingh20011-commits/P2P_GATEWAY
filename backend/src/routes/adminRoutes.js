'use strict';

/**
 * Admin routes — mounted at /api/admin. All require an admin JWT.
 */

const { Router } = require('express');
const adminController = require('../controllers/adminController');
const payoutController = require('../controllers/payoutController');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = Router();

router.use(verifyToken, checkRole('admin'));

router.get('/dashboard', adminController.dashboard);

router.get('/traders', adminController.listTraders);
router.post('/traders', adminController.createTrader);
router.post('/traders/create', adminController.createTraderFull);
router.put('/traders/:id', adminController.updateTrader);
router.put('/traders/:id/balance', adminController.updateTraderBalance);
router.put('/traders/:id/commission', adminController.updateTraderCommission);
router.put('/traders/:id/online-status', adminController.updateTraderOnlineStatus);
router.put('/traders/:id/suspend', adminController.updateTraderSuspend);
router.delete('/traders/:id', adminController.deleteTrader);

router.get('/merchants', adminController.listMerchants);
router.post('/merchants', adminController.createMerchant);
router.post('/merchants/create', adminController.createMerchantFull);
router.put('/merchants/:id', adminController.updateMerchant);
router.put('/merchants/:id/fees', adminController.updateMerchantFees);

router.get('/orders', adminController.listOrders);
// v2 review/settlement endpoints (registered before the generic :id update).
router.put('/orders/:id/review', adminController.reviewOrder);
router.put('/orders/:id/confirm', adminController.confirmOrderV2);
router.put('/orders/:id/reject', adminController.rejectOrderV2);
router.put('/orders/:id/dispute', adminController.disputeOrderV2);
router.put('/orders/:id', adminController.updateOrder);

router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);

router.get('/disputes', adminController.listDisputes);
router.put('/disputes/:id/resolve', adminController.resolveDispute);

router.get('/settlements', adminController.listSettlements);
router.post('/settlements/trigger', adminController.triggerSettlement);

router.get('/smartphones', adminController.listSmartphones);
router.put('/smartphones/:id/disconnect', adminController.disconnectSmartphone);

// Payout requests ("Buy USDT") — admin settlement/moderation.
router.get('/payout-requests', payoutController.adminList);
router.post('/payout-requests/:id/approve', payoutController.adminApprove);
router.post('/payout-requests/:id/reject', payoutController.adminReject);
router.post('/payout-requests/:id/dispute-resolve', payoutController.adminDisputeResolve);

module.exports = router;
