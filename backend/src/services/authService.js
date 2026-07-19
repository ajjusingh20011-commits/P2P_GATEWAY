'use strict';

/**
 * authService — password hashing, JWT issuing/verification, and Redis-backed
 * refresh-token storage + access-token blacklist.
 *
 * Token model:
 *   - access token  : short-lived (config.jwt.accessExpiresIn), carries { sub, role, jti }
 *   - refresh token : long-lived  (config.jwt.refreshExpiresIn), carries { sub, jti }
 *   - Redis keys:
 *       refresh:<userId>:<jti> = "1"   (TTL = refresh lifetime)  -> valid refresh tokens
 *       bl:<jti>               = "1"   (TTL = remaining access life) -> blacklisted access tokens
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const { connection, isRedisAvailable } = require('../loaders/redis');

const REFRESH_KEY = (userId, jti) => `refresh:${userId}:${jti}`;
const BLACKLIST_KEY = (jti) => `bl:${jti}`;

/* -------------------------------- passwords ------------------------------- */

async function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptSaltRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/* --------------------------------- tokens --------------------------------- */

function signAccessToken(user, jti) {
  return jwt.sign(
    { sub: user.id, role: user.role, type: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn, jwtid: jti }
  );
}

function signRefreshToken(user, jti) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn, jwtid: jti }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

function ttlFromDecoded(decoded) {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, (decoded.exp || now) - now);
}

/**
 * Issue a fresh access + refresh token pair and persist the refresh jti in Redis.
 */
async function issueTokens(user) {
  const accessJti = uuidv4();
  const refreshJti = uuidv4();

  const accessToken = signAccessToken(user, accessJti);
  const refreshToken = signRefreshToken(user, refreshJti);

  // Persist the refresh jti only when Redis is available. Without Redis the
  // token still works (JWT signature is authoritative); it just can't be
  // server-side revoked.
  if (isRedisAvailable()) {
    const decodedRefresh = jwt.decode(refreshToken);
    await connection.set(REFRESH_KEY(user.id, refreshJti), '1', 'EX', ttlFromDecoded(decodedRefresh));
  }

  return { accessToken, refreshToken };
}

/* ------------------------------ redis helpers ----------------------------- */
// All Redis-backed checks degrade gracefully when Redis is unavailable:
// refresh tokens are treated as valid, and nothing is blacklisted.

async function isRefreshValid(userId, jti) {
  if (!isRedisAvailable()) return true;
  const exists = await connection.exists(REFRESH_KEY(userId, jti));
  return exists === 1;
}

async function revokeRefresh(userId, jti) {
  if (!isRedisAvailable()) return;
  await connection.del(REFRESH_KEY(userId, jti));
}

async function blacklistAccess(jti, decoded) {
  if (!isRedisAvailable()) return;
  const ttl = ttlFromDecoded(decoded);
  if (ttl > 0) await connection.set(BLACKLIST_KEY(jti), '1', 'EX', ttl);
}

async function isAccessBlacklisted(jti) {
  if (!isRedisAvailable()) return false;
  const exists = await connection.exists(BLACKLIST_KEY(jti));
  return exists === 1;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokens,
  isRefreshValid,
  revokeRefresh,
  blacklistAccess,
  isAccessBlacklisted,
};
