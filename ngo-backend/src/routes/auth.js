const express = require('express');
const authService = require('../services/authService');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

/**
 * POST /api/auth/register
 * Body: { name, email, password, role?, ngoId? }
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role, ngoId } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'name, email and password are required' });
    }
    const { user, token } = await authService.register({ name, email, password, role, ngoId });
    return res.status(201).json({ success: true, data: { user, token } });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'email and password are required' });
    }
    const { user, token } = await authService.login({ email, password });
    return res.json({ success: true, data: { user, token } });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/auth/me — returns the authenticated user's profile.
 */
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, data: { user } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
