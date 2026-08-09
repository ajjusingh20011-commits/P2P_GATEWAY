'use strict';

/**
 * payoutService — merchant-initiated payout requests ("Buy USDT" for traders).
 *
 * Lifecycle (all transitions enforced here, never trusted from the client):
 *   awaiting_processing → in_processing → awaiting_settlement → settlement_completed
 *   in_processing       → canceled | dispute
 *   awaiting_settlement → dispute
 *   awaiting_processing → canceled
 *   dispute             → settlement_completed | canceled
 *
 * Money: the trader pays the recipient INR out-of-band; on admin settlement the
 * trader is CREDITED USDT and the merchant is DEBITED USDT — the SUBTRACTIVE/
 * ADDITIVE two-sided fee model (mirrors the pay-in subtractive model in
 * rateService.calculateSettlement):
 *   base_usdt           = amount_inr / base_exchange_rate
 *   trader_credit_usdt    = base_usdt + (base_usdt × trader_payout_percent / 100)
 *   merchant_liability_usdt = base_usdt + (base_usdt × merchant_payout_percent / 100)
 *   platform_profit_usdt  = merchant_liability_usdt − trader_credit_usdt
 * `effective_payout_rate` is still returned (derived from trader_credit_usdt)
 * purely for display/back-compat — it no longer drives the math.
 * All seven rate/fee fields are snapshotted at accept and re-used verbatim at
 * settle, same pattern as before.
 *
 * Isolated from the order/pay-in flow and from the trader-withdrawal `payouts`
 * table — nothing here touches those.
 */

const { Op } = require('sequelize');

const db = require('../models');
const logger = require('../utils/logger');
const settingsService = require('./settingsService');
const balanceService = require('./balanceService');
const {
  emitToAdmin,
  emitToMerchant,
  emitToTrader,
  broadcast,
} = require('../websocket');

const round8 = (n) => +Number(n).toFixed(8);
const round4 = (n) => +Number(n).toFixed(4);

// How long a trader has to complete the transfer after accepting.
const DEFAULT_EXPIRY_MINUTES = 15;

// Recipient fields hidden from traders in the global awaiting pool — only
// revealed once a trader has accepted (and thus owns) the request.
const SENSITIVE = ['account_number', 'upi_id', 'ifsc_code', 'recipient_name', 'bank_name'];

function sanitizePool(row) {
  const j = row.toJSON();
  for (const k of SENSITIVE) delete j[k];
  return j;
}

async function expiryMinutes() {
  return settingsService.getNumber('payout_expiry_minutes', DEFAULT_EXPIRY_MINUTES);
}

/**
 * Trader credit + merchant liability for an amount, given both sides' payout %.
 *   base_usdt               = amount_inr / base_exchange_rate
 *   trader_credit_usdt        = base_usdt + (base_usdt × trader_payout_percent / 100)
 *   merchant_liability_usdt = base_usdt + (base_usdt × merchant_payout_percent / 100)
 *   platform_profit_usdt    = merchant_liability_usdt − trader_credit_usdt
 * `effective_payout_rate` is derived from trader_credit_usdt for display/back-compat
 * only (division no longer drives the math).
 */
function computeRate(amountInr, traderPayoutPercent, merchantPayoutPercent, baseRate) {
  const traderPercent = Number(traderPayoutPercent) || 0;
  const merchantPercent = Number(merchantPayoutPercent) || 0;
  const base = Number(baseRate) || 0;
  const baseUsdt = base > 0 ? round8(Number(amountInr) / base) : 0;

  const traderCredit = round8(baseUsdt + (baseUsdt * traderPercent) / 100);
  const merchantLiability = round8(baseUsdt + (baseUsdt * merchantPercent) / 100);
  const platformProfit = round8(merchantLiability - traderCredit);
  const effective = traderCredit > 0 ? round4(Number(amountInr) / traderCredit) : round4(base);

  return {
    base_exchange_rate: round4(base),
    trader_payout_percent: round4(traderPercent),
    merchant_payout_percent: round4(merchantPercent),
    effective_payout_rate: effective,
    trader_credit_usdt: traderCredit,
    merchant_liability_usdt: merchantLiability,
    platform_profit_usdt: platformProfit,
  };
}

/* ------------------------------- merchant --------------------------------- */

async function createRequest(merchantId, data) {
  const row = await db.PayoutRequest.create({
    merchant_id: merchantId,
    amount_inr: data.amount_inr,
    payment_method: data.payment_method,
    account_number: data.account_number || null,
    upi_id: data.upi_id || null,
    ifsc_code: data.ifsc_code || null,
    recipient_name: data.recipient_name,
    bank_name: data.bank_name || null,
    priority: data.priority || 0,
    status: 'awaiting_processing',
  });

  // Tell admins + every trader panel a new request is in the pool.
  const summary = { id: row.id, uuid: row.uuid, amount_inr: row.amount_inr, payment_method: row.payment_method, status: row.status };
  emitToAdmin('payout:created', summary);
  broadcast('payout:created', summary);
  logger.info(`payout: merchant ${merchantId} created request ${row.uuid} (${row.amount_inr} INR)`);
  return row;
}

async function listForMerchant(merchantId, { status } = {}) {
  const where = { merchant_id: merchantId };
  if (status) where.status = status;
  return db.PayoutRequest.findAll({ where, order: [['created_at', 'DESC']] });
}

/* -------------------------------- trader ---------------------------------- */

/**
 * awaiting_processing → the GLOBAL pool (sanitised, recipient details hidden).
 * any other status → only this trader's own assigned requests.
 */
async function listForTrader(traderId, { status } = {}) {
  if (!status || status === 'awaiting_processing') {
    const rows = await db.PayoutRequest.findAll({
      where: { status: 'awaiting_processing', assigned_trader_id: null },
      order: [['priority', 'DESC'], ['created_at', 'ASC']],
    });
    return rows.map(sanitizePool);
  }
  const rows = await db.PayoutRequest.findAll({
    where: { assigned_trader_id: traderId, status },
    order: [['updated_at', 'DESC']],
  });
  return rows.map((r) => r.toJSON());
}

/** Count per tab for the trader (awaiting is global; rest are this trader's). */
async function traderCounts(traderId) {
  const [awaiting, inProc, awaitSettle, completed, canceled, dispute] = await Promise.all([
    db.PayoutRequest.count({ where: { status: 'awaiting_processing', assigned_trader_id: null } }),
    db.PayoutRequest.count({ where: { status: 'in_processing', assigned_trader_id: traderId } }),
    db.PayoutRequest.count({ where: { status: 'awaiting_settlement', assigned_trader_id: traderId } }),
    db.PayoutRequest.count({ where: { status: 'settlement_completed', assigned_trader_id: traderId } }),
    db.PayoutRequest.count({ where: { status: 'canceled', assigned_trader_id: traderId } }),
    db.PayoutRequest.count({ where: { status: 'dispute', assigned_trader_id: traderId } }),
  ]);
  return {
    awaiting_processing: awaiting,
    in_processing: inProc,
    awaiting_settlement: awaitSettle,
    settlement_completed: completed,
    canceled,
    dispute,
  };
}

/** Full detail for the processing modal — must belong to this trader. */
async function getForTrader(traderId, id) {
  const row = await db.PayoutRequest.findOne({ where: { id, assigned_trader_id: traderId } });
  if (!row) throw Object.assign(new Error('Payout request not found'), { status: 404 });
  return row;
}

/**
 * Accept a pooled request. Concurrency-safe: locks the row and only proceeds if
 * still awaiting + unassigned, so two traders can never grab the same one.
 * Eligibility: trader active + online + balance_usdt ≥ trader_credit_usdt, AND
 * merchant balance_usdt ≥ merchant_liability_usdt.
 *
 * The merchant check here is a fail-fast UX gate (mirrors the trader check) —
 * it is re-checked, and is the BINDING gate, inside settleAndCredit()'s own
 * locked transaction right before the actual debit, since the merchant's
 * balance can still move between accept and settle (e.g. other payouts
 * accepted against the same merchant in the meantime).
 */
async function accept(traderId, id) {
  const base = await settingsService.getNumber('base_exchange_rate', 100);
  const mins = await expiryMinutes();

  return db.sequelize.transaction(async (transaction) => {
    const row = await db.PayoutRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw Object.assign(new Error('Payout request not found'), { status: 404 });
    if (row.status !== 'awaiting_processing' || row.assigned_trader_id != null) {
      throw Object.assign(new Error('This request is no longer available'), { status: 409 });
    }

    const trader = await db.Trader.findByPk(traderId, {
      include: [{ model: db.User, as: 'user', attributes: ['status'] }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!trader) throw Object.assign(new Error('Trader not found'), { status: 404 });
    if (trader.user && trader.user.status !== 'active') throw Object.assign(new Error('Trader account is not active'), { status: 403 });
    if (!trader.is_online) throw Object.assign(new Error('Go online to accept payout requests'), { status: 403 });

    const merchant = await db.Merchant.findByPk(row.merchant_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!merchant) throw Object.assign(new Error('Merchant not found'), { status: 404 });

    const rate = computeRate(row.amount_inr, trader.payout_commission, merchant.payout_fee_percent, base);
    if (Number(trader.balance_usdt) < rate.trader_credit_usdt) {
      throw Object.assign(new Error(`Insufficient USDT balance to back this payout (need ${rate.trader_credit_usdt})`), { status: 422 });
    }
    if (Number(merchant.balance_usdt) < rate.merchant_liability_usdt) {
      throw Object.assign(new Error(`Merchant has insufficient balance for this payout (need ${rate.merchant_liability_usdt} USDT)`), { status: 422 });
    }

    const now = new Date();
    await row.update(
      {
        assigned_trader_id: traderId,
        status: 'in_processing',
        accepted_at: now,
        expires_at: new Date(now.getTime() + mins * 60 * 1000),
        ...rate,
      },
      { transaction }
    );

    const summary = { id: row.id, uuid: row.uuid, trader_id: traderId, status: row.status };
    broadcast('payout:accepted', summary); // other trader panels drop it from the pool
    emitToAdmin('payout:accepted', summary);
    emitToMerchant(row.merchant_id, 'payout:accepted', summary);
    emitToTrader(traderId, 'payout:accepted', summary);
    logger.info(`payout: trader ${traderId} accepted ${row.uuid}`);
    return row;
  });
}

/** in_processing → awaiting_settlement (trader confirms they sent the money). */
async function transferred(traderId, id, { receipt_url } = {}) {
  const row = await getForTrader(traderId, id);
  if (row.status !== 'in_processing') throw Object.assign(new Error(`Cannot mark transferred from ${row.status}`), { status: 409 });

  await row.update({ status: 'awaiting_settlement', transferred_at: new Date(), receipt_url: receipt_url || row.receipt_url });
  const summary = { id: row.id, uuid: row.uuid, trader_id: traderId, status: row.status };
  emitToAdmin('payout:transferred', summary);
  emitToMerchant(row.merchant_id, 'payout:transferred', summary);
  logger.info(`payout: trader ${traderId} marked ${row.uuid} transferred`);
  return row;
}

/** in_processing → canceled (trader backs out before transferring). */
async function cancelByTrader(traderId, id) {
  const row = await getForTrader(traderId, id);
  if (row.status !== 'in_processing') throw Object.assign(new Error(`Cannot cancel from ${row.status}`), { status: 409 });

  await row.update({ status: 'canceled', canceled_at: new Date() });
  const summary = { id: row.id, uuid: row.uuid, trader_id: traderId, status: row.status };
  broadcast('payout:canceled', summary);
  emitToAdmin('payout:canceled', summary);
  emitToMerchant(row.merchant_id, 'payout:canceled', summary);
  logger.info(`payout: trader ${traderId} canceled ${row.uuid}`);
  return row;
}

/** in_processing → dispute (trader hit a problem). */
async function problem(traderId, id, { reason } = {}) {
  const row = await getForTrader(traderId, id);
  if (row.status !== 'in_processing') throw Object.assign(new Error(`Cannot dispute from ${row.status}`), { status: 409 });

  await row.update({ status: 'dispute', disputed_at: new Date(), dispute_reason: reason || 'Trader reported a problem' });
  const summary = { id: row.id, uuid: row.uuid, trader_id: traderId, status: row.status, reason: row.dispute_reason };
  emitToAdmin('payout:disputed', summary);
  emitToMerchant(row.merchant_id, 'payout:disputed', summary);
  emitToTrader(traderId, 'payout:disputed', summary);
  logger.info(`payout: trader ${traderId} disputed ${row.uuid}`);
  return row;
}

/* --------------------------------- admin ---------------------------------- */

async function listForAdmin({ status, merchant_id } = {}) {
  const where = {};
  if (status) where.status = status;
  // Merchant-scoped view (Merchant Detail's Payouts tab — Phase 6).
  if (merchant_id) where.merchant_id = merchant_id;
  return db.PayoutRequest.findAll({
    where,
    include: [
      { model: db.Merchant, as: 'merchant', attributes: ['id', 'business_name'] },
      { model: db.Trader, as: 'assignedTrader', attributes: ['id'] },
    ],
    order: [['created_at', 'DESC']],
  });
}

async function adminCounts() {
  const statuses = db.PayoutRequest.STATUSES;
  const entries = await Promise.all(
    statuses.map((s) => db.PayoutRequest.count({ where: { status: s } }).then((c) => [s, c]))
  );
  return Object.fromEntries(entries);
}

/**
 * Settle a request: credit the trader AND debit the merchant. Transaction +
 * row lock + status guard prevent double settlement. Both amounts come from
 * the frozen accept-time snapshot, mirroring how balanceService.settleOrder()
 * moves both sides of a pay-in order in one transaction.
 *
 * The merchant balance check here is the BINDING gate (re-checked from the
 * fail-fast check already done at accept time) — it happens inside this same
 * locked transaction, immediately before the debit, so it can't race with
 * another payout settling against the same merchant concurrently.
 */
async function settleAndCredit(id, { fromStatuses }) {
  let platformProfit = 0;
  const row = await db.sequelize.transaction(async (transaction) => {
    const r = await db.PayoutRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!r) throw Object.assign(new Error('Payout request not found'), { status: 404 });
    if (r.status === 'settlement_completed' || r.settled_at) {
      throw Object.assign(new Error('Payout already settled'), { status: 409 });
    }
    if (!fromStatuses.includes(r.status)) {
      throw Object.assign(new Error(`Cannot settle from ${r.status}`), { status: 409 });
    }
    if (!r.assigned_trader_id) throw Object.assign(new Error('No trader assigned'), { status: 409 });

    const credit = Number(r.trader_credit_usdt);
    if (!(credit > 0)) throw Object.assign(new Error('Missing rate snapshot; cannot settle'), { status: 409 });

    const liability = Number(r.merchant_liability_usdt);
    if (!(liability > 0)) throw Object.assign(new Error('Missing merchant liability snapshot; cannot settle'), { status: 409 });

    const merchant = await db.Merchant.findByPk(r.merchant_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!merchant) throw Object.assign(new Error('Merchant not found'), { status: 404 });
    if (Number(merchant.balance_usdt) < liability) {
      throw Object.assign(new Error(`Merchant has insufficient balance to settle this payout (need ${liability} USDT)`), { status: 422 });
    }

    await balanceService.adjustBalance(
      r.assigned_trader_id,
      { type: 'deposit', amountUsdt: credit, orderId: null, note: `Payout ${r.uuid} settled @ rate ${r.effective_payout_rate}` },
      { transaction }
    );

    const newMerchantBal = round8(Number(merchant.balance_usdt) - liability);
    await merchant.update({ balance_usdt: newMerchantBal }, { transaction });

    await r.update({ status: 'settlement_completed', settled_at: new Date() }, { transaction });

    platformProfit = Number(r.platform_profit_usdt) || 0;

    const summary = {
      id: r.id, uuid: r.uuid, trader_id: r.assigned_trader_id, status: r.status,
      credited_usdt: credit, merchant_debited_usdt: liability,
    };
    emitToTrader(r.assigned_trader_id, 'payout:settled', summary);
    emitToMerchant(r.merchant_id, 'payout:settled', summary);
    emitToAdmin('payout:settled', summary);
    logger.info(
      `payout: admin settled ${r.uuid} → credited trader ${r.assigned_trader_id} ${credit} USDT, ` +
      `debited merchant ${r.merchant_id} ${liability} USDT, platform profit ${platformProfit} USDT`
    );
    return r;
  });

  // Accumulate into the SAME platform revenue wallet pay-in orders already
  // accumulate into (balanceService.settleOrder) — one shared platform-wide
  // revenue number across both flows. Done outside the transaction since
  // settings live in their own table + cache, same pattern as pay-in.
  try {
    const current = await settingsService.getNumber('platform_revenue_usdt', 0);
    await settingsService.set('platform_revenue_usdt', round8(current + platformProfit));
  } catch (err) {
    logger.warn(`payout: could not accumulate platform revenue: ${err.message}`);
  }

  return row;
}

/** Approve: awaiting_settlement → settlement_completed (+ credit). */
async function approve(id) {
  return settleAndCredit(id, { fromStatuses: ['awaiting_settlement'] });
}

/**
 * Reject: awaiting_processing → canceled, or awaiting_settlement → dispute
 * (a transferred payout can't just be voided — it needs review).
 */
async function reject(id, { reason } = {}) {
  const row = await db.PayoutRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Payout request not found'), { status: 404 });

  if (row.status === 'awaiting_processing') {
    await row.update({ status: 'canceled', canceled_at: new Date() });
    const summary = { id: row.id, uuid: row.uuid, status: row.status };
    broadcast('payout:canceled', summary);
    emitToMerchant(row.merchant_id, 'payout:canceled', summary);
    logger.info(`payout: admin rejected (canceled) ${row.uuid}`);
    return row;
  }
  if (row.status === 'awaiting_settlement') {
    await row.update({ status: 'dispute', disputed_at: new Date(), dispute_reason: reason || 'Rejected by admin — under review' });
    const summary = { id: row.id, uuid: row.uuid, trader_id: row.assigned_trader_id, status: row.status };
    emitToAdmin('payout:disputed', summary);
    emitToMerchant(row.merchant_id, 'payout:disputed', summary);
    if (row.assigned_trader_id) emitToTrader(row.assigned_trader_id, 'payout:disputed', summary);
    logger.info(`payout: admin rejected (disputed) ${row.uuid}`);
    return row;
  }
  throw Object.assign(new Error(`Cannot reject from ${row.status}`), { status: 409 });
}

/**
 * Resolve a dispute: action 'settle' → credit + complete; action 'void' → cancel.
 */
async function disputeResolve(id, { action, reason } = {}) {
  const row = await db.PayoutRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Payout request not found'), { status: 404 });
  if (row.status !== 'dispute') throw Object.assign(new Error(`Cannot resolve from ${row.status}`), { status: 409 });

  if (action === 'settle') {
    return settleAndCredit(id, { fromStatuses: ['dispute'] });
  }
  // void
  await row.update({ status: 'canceled', canceled_at: new Date(), dispute_reason: reason || row.dispute_reason });
  const summary = { id: row.id, uuid: row.uuid, status: row.status };
  emitToAdmin('payout:canceled', summary);
  emitToMerchant(row.merchant_id, 'payout:canceled', summary);
  if (row.assigned_trader_id) emitToTrader(row.assigned_trader_id, 'payout:canceled', summary);
  logger.info(`payout: admin voided disputed ${row.uuid}`);
  return row;
}

/* --------------------------------- job ------------------------------------ */

/**
 * Move in_processing requests whose timer elapsed to dispute. Only touches
 * in_processing rows, so it can never overwrite a completed/settled payout.
 */
async function checkExpired() {
  const now = new Date();
  const rows = await db.PayoutRequest.findAll({
    where: { status: 'in_processing', expires_at: { [Op.lt]: now } },
    limit: 200,
  });
  let n = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await db.sequelize.transaction(async (transaction) => {
      const fresh = await db.PayoutRequest.findByPk(row.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!fresh || fresh.status !== 'in_processing') return; // raced with transferred/cancel
      await fresh.update(
        { status: 'dispute', disputed_at: new Date(), dispute_reason: 'Transfer not confirmed before timer expired' },
        { transaction }
      );
      const summary = { id: fresh.id, uuid: fresh.uuid, trader_id: fresh.assigned_trader_id, status: fresh.status };
      emitToAdmin('payout:expired', summary);
      emitToAdmin('payout:disputed', summary);
      if (fresh.assigned_trader_id) emitToTrader(fresh.assigned_trader_id, 'payout:expired', summary);
      emitToMerchant(fresh.merchant_id, 'payout:disputed', summary);
      n += 1;
    });
  }
  if (n) logger.info(`payout: expiry sweep moved ${n} request(s) to dispute`);
  return { expired: n };
}

module.exports = {
  computeRate,
  createRequest,
  listForMerchant,
  listForTrader,
  traderCounts,
  getForTrader,
  accept,
  transferred,
  cancelByTrader,
  problem,
  listForAdmin,
  adminCounts,
  approve,
  reject,
  disputeResolve,
  checkExpired,
};
