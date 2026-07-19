'use strict';

/**
 * authController — HTTP handlers for the auth endpoints.
 * Thin layer: validates input, delegates to authService, shapes the response.
 */

const Joi = require('joi');

const db = require('../models');
const authService = require('../services/authService');
const twoFactorService = require('../services/twoFactorService');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
  // optional: the panel can assert which role it expects to authenticate
  role: Joi.string().valid('admin', 'trader', 'merchant').optional(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

/** Strip sensitive fields before sending a user to the client. */
function publicUser(user) {
  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
  };
}

/* ------------------------------- POST /login ------------------------------ */
async function login(req, res, next) {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message });
    }

    // include password_hash (excluded by default scope)
    const user = await db.User.scope('withSecret').findOne({ where: { email: value.email } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const ok = await authService.verifyPassword(value.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (value.role && value.role !== user.role) {
      return res.status(403).json({ success: false, message: 'Account is not a ' + value.role });
    }

    if (user.status !== 'active') {
      return res
        .status(403)
        .json({ success: false, message: `Account is ${user.status}. Contact support.` });
    }

    // Step 1 done. If 2FA is enabled, don't issue full tokens yet — hand back a
    // short-lived temp token and require the TOTP step.
    if (user.two_fa_enabled) {
      const tempToken = twoFactorService.issueTempToken(user);
      return res.json({
        success: true,
        data: { requires_2fa: true, temp_token: tempToken, role: user.role },
      });
    }

    const { accessToken, refreshToken } = await authService.issueTokens(user);

    return res.json({
      success: true,
      data: { user: publicUser(user), accessToken, refreshToken, requires_2fa: false },
    });
  } catch (err) {
    return next(err);
  }
}

/* --------------------- POST /2fa/validate (login step 2) ------------------ */
const validate2faSchema = Joi.object({
  temp_token: Joi.string().required(),
  totp_code: Joi.string().required(),
});

async function validate2fa(req, res, next) {
  try {
    const { error, value } = validate2faSchema.validate(req.body);
    if (error) return res.status(422).json({ success: false, message: error.details[0].message });

    let decoded;
    try {
      decoded = twoFactorService.verifyTempToken(value.temp_token);
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Invalid or expired 2FA session' });
    }

    const user = await db.User.scope('withSecret').findByPk(decoded.sub);
    if (!user || !user.two_fa_enabled) {
      return res.status(401).json({ success: false, message: '2FA not enabled for this account' });
    }

    // Accept a valid TOTP code OR a one-time backup code.
    let okCode = twoFactorService.verifyToken(user.totp_secret, value.totp_code);
    if (!okCode) {
      const remaining = twoFactorService.consumeBackupCode(user.backup_codes, value.totp_code);
      if (remaining != null) {
        await user.update({ backup_codes: remaining });
        okCode = true;
      }
    }
    if (!okCode) return res.status(401).json({ success: false, message: 'Invalid 2FA code' });

    const { accessToken, refreshToken } = await authService.issueTokens(user);
    return res.json({ success: true, data: { user: publicUser(user), accessToken, refreshToken } });
  } catch (err) {
    return next(err);
  }
}

/* ----------------------- GET /2fa/setup (authenticated) ------------------- */
async function setup2fa(req, res, next) {
  try {
    const user = await db.User.scope('withSecret').findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { base32, otpauthUrl } = twoFactorService.generateSecret(user.email);
    // Persist the (not-yet-enabled) secret so verify-setup can check it.
    await user.update({ totp_secret: base32 });
    const qr = await twoFactorService.qrDataUrl(otpauthUrl);

    return res.json({
      success: true,
      data: { qr_code: qr, secret: base32, otpauth_url: otpauthUrl, already_enabled: user.two_fa_enabled },
    });
  } catch (err) {
    return next(err);
  }
}

/* ----------------------- POST /2fa/verify-setup --------------------------- */
const verifySetupSchema = Joi.object({ token: Joi.string().required() });

async function verifySetup2fa(req, res, next) {
  try {
    const { error, value } = verifySetupSchema.validate(req.body);
    if (error) return res.status(422).json({ success: false, message: error.details[0].message });

    const user = await db.User.scope('withSecret').findByPk(req.user.id);
    if (!user || !user.totp_secret) {
      return res.status(400).json({ success: false, message: 'Run 2FA setup first' });
    }
    if (!twoFactorService.verifyToken(user.totp_secret, value.token)) {
      return res.status(401).json({ success: false, message: 'Invalid code — try again' });
    }

    const backupCodes = twoFactorService.generateBackupCodes(8);
    await user.update({
      two_fa_enabled: true,
      backup_codes: twoFactorService.hashBackupCodes(backupCodes),
    });

    return res.json({ success: true, data: { enabled: true, backup_codes: backupCodes } });
  } catch (err) {
    return next(err);
  }
}

/* -------------------------- POST /2fa/disable ----------------------------- */
const disable2faSchema = Joi.object({
  totp_code: Joi.string().required(),
  password: Joi.string().required(),
});

async function disable2fa(req, res, next) {
  try {
    const { error, value } = disable2faSchema.validate(req.body);
    if (error) return res.status(422).json({ success: false, message: error.details[0].message });

    const user = await db.User.scope('withSecret').findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const passOk = await authService.verifyPassword(value.password, user.password_hash);
    if (!passOk) return res.status(401).json({ success: false, message: 'Incorrect password' });
    if (!twoFactorService.verifyToken(user.totp_secret, value.totp_code)) {
      return res.status(401).json({ success: false, message: 'Invalid 2FA code' });
    }

    await user.update({ two_fa_enabled: false, totp_secret: null, backup_codes: null });
    return res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------ GET /2fa/status --------------------------- */
async function status2fa(req, res, next) {
  try {
    const user = await db.User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: { two_fa_enabled: user.two_fa_enabled } });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------ POST /logout ------------------------------ */
async function logout(req, res, next) {
  try {
    // Blacklist the current access token for its remaining lifetime.
    if (req.user?.jti) {
      await authService.blacklistAccess(req.user.jti, { exp: req.user.exp });
    }

    // Best-effort refresh-token revocation if the client provided one.
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      try {
        const decoded = authService.verifyRefreshToken(refreshToken);
        await authService.revokeRefresh(decoded.sub, decoded.jti);
      } catch (_) {
        /* ignore malformed/expired refresh tokens on logout */
      }
    }

    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------ POST /refresh ----------------------------- */
async function refresh(req, res, next) {
  try {
    const { error, value } = refreshSchema.validate(req.body);
    if (error) {
      return res.status(422).json({ success: false, message: error.details[0].message });
    }

    let decoded;
    try {
      decoded = authService.verifyRefreshToken(value.refreshToken);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const valid = await authService.isRefreshValid(decoded.sub, decoded.jti);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
    }

    const user = await db.User.findByPk(decoded.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'User no longer active' });
    }

    // Rotate: revoke the used refresh token and issue a fresh pair.
    await authService.revokeRefresh(decoded.sub, decoded.jti);
    const { accessToken, refreshToken } = await authService.issueTokens(user);

    return res.json({ success: true, data: { accessToken, refreshToken } });
  } catch (err) {
    return next(err);
  }
}

/* --------------------------------- GET /me -------------------------------- */
async function me(req, res, next) {
  try {
    const user = await db.User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const data = publicUser(user);

    // Enrich with role-specific profile fields so the panels can show the real
    // balance / commission without a second request.
    if (user.role === 'trader') {
      const trader = await db.Trader.findOne({ where: { user_id: user.id } });
      data.balance_usdt = trader ? Number(trader.balance_usdt) : 0;
      data.commission_rate = trader ? Number(trader.commission_rate) : 0;
      data.is_online = trader ? !!trader.is_online : false;
    } else if (user.role === 'merchant') {
      const merchant = await db.Merchant.findOne({ where: { user_id: user.id } });
      data.business_name = merchant ? merchant.business_name : null;
      data.balance_usdt = merchant ? Number(merchant.balance_usdt) : 0;
    }

    return res.json({ success: true, data: { user: data } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  logout,
  refresh,
  me,
  validate2fa,
  setup2fa,
  verifySetup2fa,
  disable2fa,
  status2fa,
};
