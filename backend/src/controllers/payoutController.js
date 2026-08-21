'use strict';

/**
 * payoutController — merchant/trader/admin endpoints for the payout-request
 * ("Buy USDT") system. All business rules + status transitions live in
 * payoutService; this layer validates input and resolves the caller's profile.
 */

const Joi = require('joi');

const db = require('../models');
const { ok, created, fail, asyncHandler } = require('../utils/http');
const payoutService = require('../services/payoutService');

async function currentMerchant(req, res) {
  const merchant = await db.Merchant.findOne({ where: { user_id: req.user.id } });
  if (!merchant) {
    fail(res, 404, 'Merchant profile not found');
    return null;
  }
  return merchant;
}

async function currentTrader(req, res) {
  const trader = await db.Trader.findOne({ where: { user_id: req.user.id } });
  if (!trader) {
    fail(res, 404, 'Trader profile not found');
    return null;
  }
  return trader;
}

// Wrap a service call so thrown {status,message} errors become clean responses.
function handleErr(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ success: false, message: err.message });
}

/* ------------------------------- merchant --------------------------------- */

const createSchema = Joi.object({
  amount_inr: Joi.number().positive().required(),
  payment_method: Joi.string().max(50).required(),
  recipient_name: Joi.string().max(191).required(),
  account_number: Joi.string().max(64).allow('', null),
  upi_id: Joi.string().max(191).allow('', null),
  ifsc_code: Joi.string().max(20).allow('', null),
  bank_name: Joi.string().max(191).allow('', null),
  priority: Joi.number().integer().min(0).default(0),
});

const create = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;
  const { error, value } = createSchema.validate(req.body);
  if (error) return fail(res, 422, error.details[0].message);
  const row = await payoutService.createRequest(merchant.id, value);
  return created(res, { payout_request: row });
});

const listMine = asyncHandler(async (req, res) => {
  const merchant = await currentMerchant(req, res);
  if (!merchant) return undefined;
  const rows = await payoutService.listForMerchant(merchant.id, { status: req.query.status });
  return ok(res, { payout_requests: rows });
});

/* -------------------------------- trader ---------------------------------- */

const traderList = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const [rows, counts] = await Promise.all([
    payoutService.listForTrader(trader.id, { status: req.query.status }),
    payoutService.traderCounts(trader.id),
  ]);
  return ok(res, { payout_requests: rows, counts });
});

const traderAccept = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  try {
    const row = await payoutService.accept(trader.id, req.params.id);
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

// Full detail for the processing modal (ownership enforced in the service).
const traderProcess = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  try {
    const row = await payoutService.getForTrader(trader.id, req.params.id);
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

const transferredSchema = Joi.object({
  receipt_url: Joi.string().max(512).allow('', null),
  // BUG 2 — "capture didn't work, send for review" fallback (bank payouts).
  unverified: Joi.boolean().truthy('true').falsy('false').default(false),
  evidence_note: Joi.string().max(1000).allow('', null),
});

const traderTransferred = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const { value } = transferredSchema.validate(req.body || {});
  try {
    const row = await payoutService.transferred(trader.id, req.params.id, {
      receipt_url: value.receipt_url,
      unverified: value.unverified,
      evidence_note: value.evidence_note,
    });
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

const cancelSchema = Joi.object({
  reason_code: Joi.string().max(64).required(),
  reason_note: Joi.string().max(1000).allow('', null),
  proof_url: Joi.string().max(512).allow('', null),
});

const traderCancel = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const { error, value } = cancelSchema.validate(req.body || {});
  if (error) return fail(res, 422, error.details[0].message);
  try {
    const row = await payoutService.cancelByTrader(trader.id, req.params.id, value);
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

// BUG 6 — the trader's "Canceled" tab is now their cancellation history (their
// cancels re-pool the payout, so there is no 'canceled' payout row to list).
const traderCancellations = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  try {
    const rows = await payoutService.listCancellations({ traderId: trader.id });
    return ok(res, { cancellations: rows });
  } catch (err) {
    return handleErr(res, err);
  }
});

const problemSchema = Joi.object({ reason: Joi.string().max(500).allow('', null) });

const traderProblem = asyncHandler(async (req, res) => {
  const trader = await currentTrader(req, res);
  if (!trader) return undefined;
  const { value } = problemSchema.validate(req.body || {});
  try {
    const row = await payoutService.problem(trader.id, req.params.id, { reason: value.reason });
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

/* --------------------------------- admin ---------------------------------- */

const adminList = asyncHandler(async (req, res) => {
  const [rows, counts] = await Promise.all([
    payoutService.listForAdmin({ status: req.query.status, merchant_id: req.query.merchant_id }),
    payoutService.adminCounts(),
  ]);
  return ok(res, { payout_requests: rows, counts });
});

const adminApprove = asyncHandler(async (req, res) => {
  try {
    const row = await payoutService.approve(req.params.id);
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

const adminReject = asyncHandler(async (req, res) => {
  try {
    const row = await payoutService.reject(req.params.id, { reason: req.body?.reason });
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

const disputeResolveSchema = Joi.object({
  action: Joi.string().valid('settle', 'void', 'return_to_pool').required(),
  reason_code: Joi.string().max(64).allow('', null),
  reason_note: Joi.string().max(1000).allow('', null),
  proof_url: Joi.string().max(512).allow('', null),
  // Back-compat: older callers send `reason` as free text.
  reason: Joi.string().max(1000).allow('', null),
});

const adminDisputeResolve = asyncHandler(async (req, res) => {
  const { error, value } = disputeResolveSchema.validate(req.body || {});
  if (error) return fail(res, 422, error.details[0].message);
  try {
    const row = await payoutService.disputeResolve(req.params.id, {
      action: value.action,
      reason_code: value.reason_code,
      reason_note: value.reason_note || value.reason,
      proof_url: value.proof_url,
      adminUserId: req.user && req.user.id,
    });
    return ok(res, { payout_request: row });
  } catch (err) {
    return handleErr(res, err);
  }
});

// BUG 6 — admin cancelled-history: every cancellation/void/return-to-pool.
const adminCancellations = asyncHandler(async (req, res) => {
  try {
    const rows = await payoutService.listCancellations({});
    return ok(res, { cancellations: rows });
  } catch (err) {
    return handleErr(res, err);
  }
});

module.exports = {
  // merchant
  create,
  listMine,
  // trader
  traderList,
  traderAccept,
  traderProcess,
  traderTransferred,
  traderCancel,
  traderCancellations,
  traderProblem,
  // admin
  adminList,
  adminApprove,
  adminReject,
  adminDisputeResolve,
  adminCancellations,
};
