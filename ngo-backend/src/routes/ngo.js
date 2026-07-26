const path = require('path');
const fs = require('fs');
const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { ROLES, ACCOUNT_STATUS, ACCOUNT_STATUS_REASON, CONNECTION_TYPE } = require('../config/constants');
const { encrypt } = require('../utils/encryption');
const ledgerService = require('../services/ledgerService');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Ledger = require('../models/Ledger');
const PaytmScraper = require('../services/webScraper')
const SessionStore = require('../services/SessionStore')
const router = express.Router();

router.use(verifyToken, requireRole(ROLES.NGO_STAFF, ROLES.ADMIN));

const CREDENTIAL_FIELDS =
  '-encryptedLoginEmail -encryptedLoginPassword -encryptedLoginPhone';

function resolveNgoId(req) {
  if (req.user.role === ROLES.ADMIN && req.query.ngoId) {
    return req.query.ngoId;
  }
  if (req.user.ngoId) {
    return req.user.ngoId;
  }
  if (req.body.ngoId) {
    return req.body.ngoId;
  }
  return null;
}

function paginate(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumAmounts(entries) {
  return entries.reduce((acc, e) => {
    const n = parseFloat(String(e.amount || '').replace(/,/g, ''));
    return acc + (Number.isNaN(n) ? 0 : n);
  }, 0);
}

router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await Account.find({ ngoId: resolveNgoId(req) })
      .select(CREDENTIAL_FIELDS)
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: accounts });
  } catch (err) {
    return next(err);
  }
});

router.post('/accounts', async (req, res, next) => {
  try {
    const ngoId = resolveNgoId(req);
    const {
      type,
      platform,
      upiId,
      displayName,
      loginEmail,
      loginPassword,
      loginPhone,
    } = req.body;

    if (![CONNECTION_TYPE.APK, CONNECTION_TYPE.WEB].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: 'type must be "apk" or "web"' });
    }

    const doc = {
      ngoId,
      platform,
      upiId,
      displayName,
      connectionType: type,
      // Not connected/verified yet — connect()/verify-otp() (web) or a real
      // APK heartbeat is what actually establishes a live session.
      status: ACCOUNT_STATUS.PENDING,
    };

    if (type === CONNECTION_TYPE.WEB) {
      doc.encryptedLoginEmail = encrypt(loginEmail);
      doc.encryptedLoginPassword = encrypt(loginPassword);
      doc.encryptedLoginPhone = encrypt(loginPhone);
    }

    const account = await Account.create(doc);

    const safe = await Account.findById(account._id).select(CREDENTIAL_FIELDS);
    return res.status(201).json({ success: true, data: safe });
  } catch (err) {
    return next(err);
  }
});

// Toggling isn't just a status flip any more:
//   OFF -> really closes the live session (SessionStore.removeSession — the
//          same cleanup the delete route uses), not just a flag.
//   ON  -> for a web-login account with no live session, triggers
//          initiateLogin (cookie-first — tries saved cookies silently
//          before any OTP) as part of the toggle itself, instead of leaving
//          the account "on" but not actually connected to anything.
// initiateLogin manages status/statusReason on its own (live / paused+
// otp_required / failed) — we let it, and just return the fresh row,
// rather than racing it with our own blind status write.
router.patch('/accounts/:accountId/toggle', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (![ACCOUNT_STATUS.LIVE, ACCOUNT_STATUS.PAUSED].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: 'status must be "live" or "paused"' });
    }

    const existing = await Account.findOne({
      _id: req.params.accountId,
      ngoId: resolveNgoId(req),
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (status === ACCOUNT_STATUS.PAUSED) {
      if (existing.connectionType === CONNECTION_TYPE.WEB) {
        SessionStore.removeSession(existing._id.toString());
      }
      const account = await Account.findByIdAndUpdate(
        existing._id,
        { status: ACCOUNT_STATUS.PAUSED, statusReason: ACCOUNT_STATUS_REASON.MANUAL_PAUSE },
        { new: true }
      ).select(CREDENTIAL_FIELDS);
      return res.json({ success: true, data: account });
    }

    // Turning ON.
    if (existing.connectionType === CONNECTION_TYPE.WEB) {
      const alive = await SessionStore.isSessionAlive(existing._id.toString());
      if (!alive) {
        const io = req.app.locals.io;
        let reconnect;
        try {
          reconnect = await PaytmScraper.initiateLogin(existing, io);
        } catch (err) {
          reconnect = { success: false, needsOTP: false, message: err.message };
        }
        const fresh = await Account.findById(existing._id).select(CREDENTIAL_FIELDS);
        return res.json({ success: true, data: fresh, reconnect });
      }
    }

    // Already-alive web session, or an APK account (no session concept).
    const account = await Account.findByIdAndUpdate(
      existing._id,
      { status: ACCOUNT_STATUS.LIVE, statusReason: null },
      { new: true }
    ).select(CREDENTIAL_FIELDS);
    return res.json({ success: true, data: account });
  } catch (err) {
    return next(err);
  }
});

// Edit account details (title, organization, per-window limits). Separate
// from /toggle, which only flips status. Partial-patch: only supplied fields
// are applied, mirroring traderController.updatePaymentDetail semantics —
// `null` explicitly clears a field (e.g. removes a window cap), `undefined`
// (omitted) leaves it untouched.
router.patch('/accounts/:accountId', async (req, res, next) => {
  try {
    const patch = {};
    const passthrough = [
      'displayName', 'upiId', 'organizationName',
      'minAmount', 'maxAmount',
      'maxPerHour', 'maxPerDay', 'maxPerWeek', 'maxPerMonth',
      'monthlyLimit', 'weeklyLimit', 'dailyLimitAmount', 'hourlyLimitAmount',
      'monthlyStartDate', 'gatewayPaymentDetailId',
    ];
    passthrough.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });

    if (req.body.status !== undefined) {
      if (![ACCOUNT_STATUS.LIVE, ACCOUNT_STATUS.PAUSED].includes(req.body.status)) {
        return res
          .status(400)
          .json({ success: false, message: 'status must be "live" or "paused"' });
      }
      patch.status = req.body.status;
    }

    const account = await Account.findOneAndUpdate(
      { _id: req.params.accountId, ngoId: resolveNgoId(req) },
      patch,
      { new: true }
    ).select(CREDENTIAL_FIELDS);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    return res.json({ success: true, data: account });
  } catch (err) {
    return next(err);
  }
});

// Delete an account. For a web-login account, first tears down any live
// scraper session (closes the Playwright browser, clears its monitor
// interval — SessionStore.removeSession, NOT scraperEngine.js's stopSession,
// which is dead code per the prior fix) and removes its saved session-cookie
// file so orphaned paytm-session-<id>.json files don't pile up.
router.delete('/accounts/:accountId', async (req, res, next) => {
  try {
    const account = await Account.findOne({
      _id: req.params.accountId,
      ngoId: resolveNgoId(req),
    });
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    if (account.connectionType === CONNECTION_TYPE.WEB) {
      SessionStore.removeSession(account._id.toString());
      const sessionFile = path.join(__dirname, `../../paytm-session-${account._id}.json`);
      try {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      } catch (e) { /* best-effort cleanup */ }
    }

    await Account.deleteOne({ _id: account._id });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const { page, limit, skip } = paginate(req);
    const query = { ngoId: resolveNgoId(req) };
    if (req.query.status) {
      query.status = req.query.status;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ scrapedAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(query),
    ]);

    return res.json({
      success: true,
      transactions,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/ledger', async (req, res, next) => {
  try {
    const { page, limit, skip } = paginate(req);
    const query = { ngoId: resolveNgoId(req) };

    const [entries, total] = await Promise.all([
      ledgerService.getLedger(query, { skip, limit }),
      Ledger.countDocuments(query),
    ]);

    return res.json({
      success: true,
      ledger: entries,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const ngoId = resolveNgoId(req);

    const [entries, todayEntries, activeAccounts] = await Promise.all([
      Ledger.find({ ngoId }).select('amount').lean(),
      Ledger.find({ ngoId, createdAt: { $gte: startOfToday() } })
        .select('amount')
        .lean(),
      Account.countDocuments({ ngoId, status: ACCOUNT_STATUS.LIVE }),
    ]);

    return res.json({
      success: true,
      data: {
        totalDonations: sumAmounts(entries),
        todayDonations: sumAmounts(todayEntries),
        totalCount: entries.length,
        activeAccounts,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Start connect / login process
router.post(
  '/accounts/:accountId/connect',
  async (req, res, next) => {
    try {
      const io = req.app.locals.io
      const account = await Account
        .findById(req.params.accountId)

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'Account not found'
        })
      }

      const result = await PaytmScraper
        .initiateLogin(account, io)

      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

// NGO submits OTP
router.post(
  '/accounts/:accountId/verify-otp',
  async (req, res, next) => {
    try {
      const { otp } = req.body
      if (!otp) {
        return res.status(400).json({
          success: false,
          message: 'OTP is required'
        })
      }

      const io = req.app.locals.io
      const account = await Account
        .findById(req.params.accountId)

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'Account not found'
        })
      }

      const result = await PaytmScraper
        .submitOTP(account, otp, io)

      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

// Get session status
router.get(
  '/accounts/:accountId/status',
  async (req, res) => {
    const { accountId } = req.params
    const status = SessionStore
      .getStatus(accountId)
    const isAlive = await SessionStore
      .isSessionAlive(accountId)

    res.json({
      success: true,
      status,
      isAlive
    })
  }
)

// Manual sync
router.post(
  '/accounts/:accountId/sync',
  async (req, res, next) => {
    try {
      const accountId = req.params.accountId
      const session = SessionStore
        .getSession(accountId)

      if (!session || !session.page) {
        return res.status(400).json({
          success: false,
          message: 'No active session.' +
            ' Please reconnect first.'
        })
      }

      const account = await Account
        .findById(accountId)

      const count = await PaytmScraper
        .fetchAndSaveTransactions(
          account, session.page,
          req.app.locals.io
        )

      res.json({
        success: true,
        newTransactions: count,
        message: `${count} new transactions found`
      })
    } catch (err) {
      next(err)
    }
  }
)

module.exports = router;