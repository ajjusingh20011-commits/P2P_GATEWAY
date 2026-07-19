const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Authentication service: registration, login and token issuance.
 */

const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      ngoId: user.ngoId ? user.ngoId.toString() : null,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * Registers a new user. Password hashing is handled by the User model hook.
 * @returns {Promise<{user: Object, token: string}>}
 */
async function register({ name, email, password, role, ngoId }) {
  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }

  const user = await User.create({ name, email, password, role, ngoId });
  return { user, token: signToken(user) };
}

/**
 * Validates credentials and returns a signed token on success.
 * @returns {Promise<{user: Object, token: string}>}
 */
async function login({ email, password }) {
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !user.isActive) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  const ok = await user.comparePassword(password);
  if (!ok) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  return { user, token: signToken(user) };
}

module.exports = { register, login, signToken };
