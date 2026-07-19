'use strict';

/**
 * twoFactorService — TOTP 2FA using speakeasy + qrcode.
 *
 * Flow:
 *   generateSecret()  → { base32, otpauth_url }           (setup)
 *   qrDataUrl(url)    → data:image/png;base64,…           (setup QR)
 *   verifyToken(secret, token) → boolean                  (verify-setup / login)
 *   generateBackupCodes() / hashBackupCodes() / consumeBackupCode()
 *
 * Secrets and backup codes live on the users table (totp_secret, backup_codes).
 * Backup codes are stored hashed; a temp login token is a short-lived JWT.
 */

const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');

const config = require('../config');

const ISSUER = config.appName || 'PayGateway';
const TEMP_TOKEN_TTL = '5m';

/** Create a new TOTP secret + otpauth URL for the given account label. */
function generateSecret(email) {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${ISSUER} (${email})`,
    issuer: ISSUER,
  });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url };
}

/** Render an otpauth URL to a base64 PNG data URL for the frontend. */
async function qrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

/** Verify a 6-digit TOTP token against a base32 secret (±1 step window). */
function verifyToken(base32Secret, token) {
  if (!base32Secret || !token) return false;
  return speakeasy.totp.verify({
    secret: base32Secret,
    encoding: 'base32',
    token: String(token).replace(/\s/g, ''),
    window: 1,
  });
}

/** Generate N human-friendly backup codes (plain, shown once). */
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

const hashCode = (code) => crypto.createHash('sha256').update(String(code).toUpperCase().trim()).digest('hex');

/** Hash an array of backup codes for storage (JSON string). */
function hashBackupCodes(codes) {
  return JSON.stringify(codes.map(hashCode));
}

/**
 * Check a backup code against the stored (hashed) list. If it matches, returns
 * the remaining hashed list (JSON string) with that code removed; else null.
 */
function consumeBackupCode(storedJson, code) {
  if (!storedJson) return null;
  let hashes;
  try { hashes = JSON.parse(storedJson); } catch (_) { return null; }
  const target = hashCode(code);
  const idx = hashes.indexOf(target);
  if (idx === -1) return null;
  hashes.splice(idx, 1);
  return JSON.stringify(hashes);
}

/** Short-lived token that proves step-1 (password) succeeded, pending TOTP. */
function issueTempToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, twofa: 'pending' }, config.jwt.accessSecret, {
    expiresIn: TEMP_TOKEN_TTL,
  });
}

function verifyTempToken(token) {
  const decoded = jwt.verify(token, config.jwt.accessSecret);
  if (decoded.twofa !== 'pending') throw new Error('Not a 2FA temp token');
  return decoded;
}

module.exports = {
  generateSecret,
  qrDataUrl,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  issueTempToken,
  verifyTempToken,
};
