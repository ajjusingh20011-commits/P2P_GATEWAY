/**
 * API route aggregator.
 * Mount feature routers here as they are implemented.
 * Business logic is not implemented yet — these are placeholders.
 */

const { Router } = require('express');

const router = Router();

router.get('/', (req, res) => res.json({ message: 'P2P UPI Gateway API v1' }));

// TODO: mount feature routers, e.g.
// router.use('/auth', require('./auth.routes'));
// router.use('/admin', require('./admin.routes'));
// router.use('/traders', require('./trader.routes'));
// router.use('/merchants', require('./merchant.routes'));
// router.use('/orders', require('./order.routes'));
// router.use('/payments', require('./payment.routes'));
// router.use('/webhooks', require('./webhook.routes'));

module.exports = router;
