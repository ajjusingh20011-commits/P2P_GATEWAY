'use strict';

/**
 * Auth routes — mounted at /api/auth (see app.js).
 *
 *   POST /login    public   -> email + password -> tokens + user
 *   POST /logout   private  -> blacklist access token, revoke refresh
 *   POST /refresh  public   -> exchange refresh token for a new token pair
 *   GET  /me       private  -> current authenticated user
 */

const { Router } = require('express');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = Router();

router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', verifyToken, authController.logout);
router.get('/me', verifyToken, authController.me);

// Two-factor authentication.
router.post('/2fa/validate', authController.validate2fa); // public (login step 2)
router.get('/2fa/setup', verifyToken, authController.setup2fa);
router.post('/2fa/verify-setup', verifyToken, authController.verifySetup2fa);
router.post('/2fa/disable', verifyToken, authController.disable2fa);
router.get('/2fa/status', verifyToken, authController.status2fa);

module.exports = router;
