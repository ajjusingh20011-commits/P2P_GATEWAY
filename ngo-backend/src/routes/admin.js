const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { ROLES, NGO_STATUS, DEVICE_STATUS } = require('../config/constants');
const ngoService = require('../services/ngoService');
const proxyManager = require('../services/proxyManager');
const ledgerService = require('../services/ledgerService');
const NGO = require('../models/NGO');
const Ledger = require('../models/Ledger');
const Device = require('../models/Device');
const bankRuntimeRules = require('../services/bankRuntimeRules');
const unrecognizedSenderReview = require('../services/unrecognizedSenderReview');
const { cleanAmountString } = require('../utils/amountHelper');

const router = express.Router();

// Every admin route requires a valid token AND the admin role.
router.use(verifyToken, requireRole(ROLES.ADMIN));

// Section 3 — load admin-promoted bank codes into the matcher's runtime overlay
// at startup + periodically (this route module is required at server boot). A
// promote also refreshes on demand below, so a confirmed bank goes live at once.
bankRuntimeRules.startRuntimeRulesRefresh();

function paginate(req, defaultLimit = 50) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumAmounts(entries) {
  return entries.reduce((acc, e) => {
    // BUG-54: shared cleaner, not an ad hoc .replace(/,/g, '') — see amountHelper.js.
    const n = parseFloat(cleanAmountString(e.amount));
    return acc + (Number.isNaN(n) ? 0 : n);
  }, 0);
}

/**
 * GET /api/admin/ngos — all NGOs, each with donation count + amount.
 */
router.get('/ngos', async (req, res, next) => {
  try {
    const ngos = await ngoService.listNGOs();

    // Per-NGO donation rollup from the ledger.
    const rollup = await Ledger.aggregate([
      {
        $group: {
          _id: '$ngoId',
          count: { $sum: 1 },
          amount: {
            $sum: {
              $convert: {
                input: { $replaceAll: { input: '$amount', find: ',', replacement: '' } },
                to: 'double',
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]);
    const statsById = new Map(rollup.map((r) => [String(r._id), r]));

    const data = ngos.map((ngo) => {
      const s = statsById.get(String(ngo._id)) || { count: 0, amount: 0 };
      return {
        ...ngo.toObject(),
        stats: { donationCount: s.count, donationAmount: s.amount },
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/ngos — create a new NGO (webhookSecret auto-generated),
 * assign a proxy, and return the created NGO (including its secret).
 */
router.post('/ngos', async (req, res, next) => {
  try {
    const { name, email, phone, description } = req.body;
    if (!name || !email) {
      return res
        .status(400)
        .json({ success: false, message: 'name and email are required' });
    }

    const ngo = await ngoService.createNGO({ name, email, phone, description });

    const proxyIp = proxyManager.assignProxy(ngo._id.toString());
    if (proxyIp) {
      ngo.proxyIp = proxyIp;
      await ngo.save();
    }

    return res.status(201).json({ success: true, data: ngo });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/admin/ngos/:ngoId/status — set NGO status.
 * Body: { status } — active / inactive / pending
 */
router.patch('/ngos/:ngoId/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!Object.values(NGO_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${Object.values(NGO_STATUS).join(', ')}`,
      });
    }

    const ngo = await NGO.findByIdAndUpdate(
      req.params.ngoId,
      { status },
      { new: true }
    );
    if (!ngo) {
      return res.status(404).json({ success: false, message: 'NGO not found' });
    }

    return res.json({ success: true, data: ngo });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/stats — platform-wide totals.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [totalNGOs, allEntries, todayEntries, activeDevices] = await Promise.all([
      NGO.countDocuments(),
      Ledger.find().select('amount').lean(),
      Ledger.find({ createdAt: { $gte: startOfToday() } })
        .select('amount')
        .lean(),
      Device.countDocuments({ status: DEVICE_STATUS.ACTIVE }),
    ]);

    return res.json({
      success: true,
      data: {
        totalNGOs,
        totalDonations: allEntries.length,
        totalAmount: sumAmounts(allEntries),
        todayAmount: sumAmounts(todayEntries),
        activeDevices,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/ledger?page=&limit= — all ledger entries across all NGOs.
 */
router.get('/ledger', async (req, res, next) => {
  try {
    const { page, limit, skip } = paginate(req, 50);

    const [entries, total] = await Promise.all([
      ledgerService.getLedger({}, { skip, limit }),
      Ledger.countDocuments(),
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

/* ---------------------------------------------------------------------------
 * Redesign Section 4 — Unrecognized bank-sender review queue.
 *
 * Real DLT-shaped bank SMS whose header the tiered matcher can't place land
 * here (deduped by entity code) instead of being lost. Review reads the bank's
 * own sign-off name; promoting a genuinely-new bank is the evidence-based way
 * the list grows. Promote/ignore only record the decision — making a promoted
 * bank LIVE across devices is Section 3 (runtime rule store), which will load
 * status:'promoted' rows.
 * ------------------------------------------------------------------------- */

// GET /api/admin/unrecognized-senders?status=pending — the review queue,
// most-seen first (occurrences is the Section-7 "seen several times" signal).
// Shared logic in services/unrecognizedSenderReview (also used by the gateway-
// proxied admin panel via internal.js).
router.get('/unrecognized-senders', async (req, res, next) => {
  try {
    const { limit, skip } = paginate(req);
    const { queue, total } = await unrecognizedSenderReview.listQueue({ status: req.query.status, limit, skip });
    return res.json({ success: true, queue, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/unrecognized-senders/:code/promote
// Body: { confirmedName, confirmedCode? } — confirm a genuinely-new bank; goes
// live immediately (Section 3 overlay reload, inside the service).
router.post('/unrecognized-senders/:code/promote', async (req, res, next) => {
  try {
    const r = await unrecognizedSenderReview.promote(req.params.code, {
      confirmedName: req.body && req.body.confirmedName,
      confirmedCode: req.body && req.body.confirmedCode,
      reviewedBy: (req.user && (req.user.email || req.user.id)) || 'admin',
    });
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    if (r.notFound) return res.status(404).json({ success: false, message: 'Unrecognized sender not found' });
    return res.json({ success: true, promoted: r.row });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/unrecognized-senders/:code/ignore — dismiss (non-bank / noise).
router.post('/unrecognized-senders/:code/ignore', async (req, res, next) => {
  try {
    const r = await unrecognizedSenderReview.ignore(req.params.code, {
      reviewedBy: (req.user && (req.user.email || req.user.id)) || 'admin',
    });
    if (r.notFound) return res.status(404).json({ success: false, message: 'Unrecognized sender not found' });
    return res.json({ success: true, ignored: r.row.code });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
