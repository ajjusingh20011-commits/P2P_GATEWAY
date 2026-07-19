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
 * trader is CREDITED USDT at the payout rate:
 *   effective_payout_rate = base − (base × trader_payout_percent / 100)
 *   trader_credit_usdt    = amount_inr / effective_payout_rate
 * The four rate fields are snapshotted at accept and re-used verbatim at settle.
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

/** effective rate + trader credit for an amount, given the payout %. */
function computeRate(amountInr, payoutPercent, baseRate) {
  const percent = Number(payoutPercent) || 0;
  const base = Number(baseRate) || 0;
  const effective = round4(base - (base * percent) / 100);
  const credit = effective > 0 ? round8(Number(amountInr) / effective) : 0;
  return { base_exchange_rate: round4(base), trader_payout_percent: round4(percent), effective_payout_rate: effective, trader_credit_usdt: credit };
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
 * Eligibility: trader active + online + balance_usdt ≥ trader_credit_usdt.
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

    const rate = computeRate(row.amount_inr, trader.payout_commission, base);
    if (Number(trader.balance_usdt) < rate.trader_credit_usdt) {
      throw Object.assign(new Error(`Insufficient USDT balance to back this payout (need ${rate.trader_credit_usdt})`), { status: 422 });
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

async function listForAdmin({ status } = {}) {
  const where = {};
  if (status) where.status = status;
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
 * Settle a request and credit the trader. Transaction + row lock + status guard
 * prevent double settlement. Credits USDT using the frozen snapshot.
 */
async function settleAndCredit(id, { fromStatuses }) {
  return db.sequelize.transaction(async (transaction) => {
    const row = await db.PayoutRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw Object.assign(new Error('Payout request not found'), { status: 404 });
    if (row.status === 'settlement_completed' || row.settled_at) {
      throw Object.assign(new Error('Payout already settled'), { status: 409 });
    }
    if (!fromStatuses.includes(row.status)) {
      throw Object.assign(new Error(`Cannot settle from ${row.status}`), { status: 409 });
    }
    if (!row.assigned_trader_id) throw Object.assign(new Error('No trader assigned'), { status: 409 });

    const credit = Number(row.trader_credit_usdt);
    if (!(credit > 0)) throw Object.assign(new Error('Missing rate snapshot; cannot settle'), { status: 409 });

    await balanceService.adjustBalance(
      row.assigned_trader_id,
      { type: 'deposit', amountUsdt: credit, orderId: null, note: `Payout ${row.uuid} settled @ rate ${row.effective_payout_rate}` },
      { transaction }
    );

    await row.update({ status: 'settlement_completed', settled_at: new Date() }, { transaction });

    const summary = { id: row.id, uuid: row.uuid, trader_id: row.assigned_trader_id, status: row.status, credited_usdt: credit };
    emitToTrader(row.assigned_trader_id, 'payout:settled', summary);
    emitToMerchant(row.merchant_id, 'payout:settled', summary);
    emitToAdmin('payout:settled', summary);
    logger.info(`payout: admin settled ${row.uuid} → credited trader ${row.assigned_trader_id} ${credit} USDT`);
    return row;
  });
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
