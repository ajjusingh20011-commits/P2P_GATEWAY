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
const axios = require('axios');
const { internalAuthHeaders } = require('./ngoServiceAuth');

// ngo-backend holds the devices; the P2P backend arms them for capture on
// pickup and clears them when a payout leaves processing.
const NGO_BASE = process.env.NGO_BACKEND_URL || 'http://localhost:3000';

const round8 = (n) => +Number(n).toFixed(8);
const round4 = (n) => +Number(n).toFixed(4);

// How long a trader has to complete the transfer after accepting.
const DEFAULT_EXPIRY_MINUTES = 40; // pickup -> transfer window; adjustable via payout_expiry_minutes
const DEFAULT_MAX_CONCURRENT = 3;  // payouts a trader may hold in processing; adjustable via max_concurrent_payouts
const DEFAULT_DISPUTE_HOURS = 3;   // how long a dispute sits before auto-returning to the pool; adjustable via payout_dispute_hours

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
 * Feature 2 — arm EVERY device the trader owns to capture payout evidence for
 * this order. A trader may process a payout on any of their paired phones and
 * Device.activePayout is a single slot, so all their devices are armed at
 * pickup; whichever phone they actually use is already capturing, and the
 * server matches the uploaded evidence to the right order by content later.
 *
 * Best-effort: the money side has already committed, so a briefly-unreachable
 * ngo-backend must not fail the pickup — but a failure means capture won't
 * auto-start, so it is logged loudly.
 */
async function armTraderDevicesForPayout(traderId, row) {
  try {
    await axios.post(
      `${NGO_BASE}/api/internal/set-active-payout-for-trader`,
      {
        traderId,
        orderId: row.uuid,
        payeeName: row.recipient_name || '',
        accountNumber: row.account_number || row.upi_id || '',
        ifsc: row.ifsc_code || '',
        amount: row.amount_inr != null ? String(row.amount_inr) : '',
      },
      { timeout: 5000, headers: internalAuthHeaders() }
    );
  } catch (err) {
    logger.warn(`payout: could not arm devices for trader ${traderId} order ${row.uuid} — evidence capture will not auto-start: ${err.message}`);
  }
}

/**
 * Feature 2 — clear the active-payout arming for this order across the trader's
 * devices, once the payout leaves in_processing (transferred / expired /
 * canceled). Targeted to this orderId so it never wipes an arming the trader
 * has since taken for a different order. Best-effort, same reasoning as above.
 */
async function clearTraderDevicesPayout(traderId, orderUuid) {
  if (!traderId || !orderUuid) return;
  try {
    await axios.post(
      `${NGO_BASE}/api/internal/set-active-payout-for-trader`,
      { traderId, orderId: orderUuid, clear: true },
      { timeout: 5000, headers: internalAuthHeaders() }
    );
  } catch (err) {
    logger.warn(`payout: could not clear device arming for trader ${traderId} order ${orderUuid}: ${err.message}`);
  }
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
    // Only traders an admin has allocated to the payout pool may see it
    // (Feature 2 access layer). Not allocated -> the pool is empty for them.
    const trader = await db.Trader.findByPk(traderId, { attributes: ['payout_pool_access'] });
    if (!trader || !trader.payout_pool_access) return [];
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
  // The pool count is 0 for a trader not allocated to it — so the tab matches
  // the (empty) list they actually see.
  const accessTrader = await db.Trader.findByPk(traderId, { attributes: ['payout_pool_access'] });
  const canSeePool = !!(accessTrader && accessTrader.payout_pool_access);
  const [awaiting, inProc, awaitSettle, completed, canceled, dispute] = await Promise.all([
    canSeePool
      ? db.PayoutRequest.count({ where: { status: 'awaiting_processing', assigned_trader_id: null } })
      : Promise.resolve(0),
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
  const maxConcurrent = await settingsService.getNumber('max_concurrent_payouts', DEFAULT_MAX_CONCURRENT);

  const row = await db.sequelize.transaction(async (transaction) => {
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
    // NOTE: deliberately does NOT check trader.is_online. That flag exists for
    // one thing — routingEngine.eligibleTraders(), which PUSHES incoming
    // deposit orders at a trader, so it needs to know they're present. A payout
    // is the opposite direction and is PULLED: the trader is looking at the
    // queue and clicking Accept, which is itself proof of presence. Gating on
    // is_online here just meant a trader who had switched off new deposits
    // could not process money they owed out. Every check that actually
    // protects this operation is independent of it and still runs: the user
    // must be active (above), the request must still be unassigned and
    // awaiting_processing (above), both balances must cover the payout
    // (below), and the row locks guard against a double accept.

    // Feature 2 access layer — the trader must be allocated to the payout pool,
    // and within their admin-set daily payout amount cap (both under the trader
    // row lock, so race-safe per trader).
    if (!trader.payout_pool_access) {
      throw Object.assign(new Error('You are not allocated to the payout pool'), { status: 403 });
    }
    const dailyLimit = Number(trader.payout_daily_limit) || 0;
    if (dailyLimit > 0) {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const usedToday = (await db.PayoutRequest.sum('amount_inr', {
        where: {
          assigned_trader_id: traderId,
          accepted_at: { [Op.gte]: startToday },
          status: { [Op.in]: ['in_processing', 'awaiting_settlement', 'settlement_completed'] },
        },
        transaction,
      })) || 0;
      if (Number(usedToday) + Number(row.amount_inr) > dailyLimit) {
        throw Object.assign(new Error(`This payout would exceed your daily payout limit of ₹${dailyLimit}`), { status: 422 });
      }
    }

    // Hard cap on how many payouts a trader may hold in 'in_processing' at once
    // (admin-adjustable, max_concurrent_payouts). Race-safe: the trader row is
    // locked above, so two concurrent accepts by the same trader serialize and
    // the second sees the first's committed count.
    const activeCount = await db.PayoutRequest.count({
      where: { assigned_trader_id: traderId, status: 'in_processing' },
      transaction,
    });
    if (activeCount >= maxConcurrent) {
      throw Object.assign(new Error(`You can hold at most ${maxConcurrent} payouts in processing at once — finish one first`), { status: 409 });
    }

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

  // After the money side commits, arm the trader's devices to capture evidence
  // for this order (best-effort — see armTraderDevicesForPayout). This is the
  // accept() -> set-active-payout wiring the capture chain was missing.
  await armTraderDevicesForPayout(traderId, row);
  return row;
}

/** in_processing → awaiting_settlement (trader confirms they sent the money). */
async function transferred(traderId, id, { receipt_url } = {}) {
  const row = await getForTrader(traderId, id);
  if (row.status !== 'in_processing') throw Object.assign(new Error(`Cannot mark transferred from ${row.status}`), { status: 409 });

  await row.update({ status: 'awaiting_settlement', transferred_at: new Date(), receipt_url: receipt_url || row.receipt_url });
  // The capture window for this order is over — stop the trader's devices
  // capturing for it (the evidence bundle upload is triggered by this click).
  await clearTraderDevicesPayout(traderId, row.uuid);
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
    let expired = null;
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
      expired = { traderId: fresh.assigned_trader_id, uuid: fresh.uuid };
    });
    // Order timed out — stop the trader's devices capturing for it (outside the
    // txn: it's a best-effort cross-service call, not part of the DB write).
    // eslint-disable-next-line no-await-in-loop
    if (expired) await clearTraderDevicesPayout(expired.traderId, expired.uuid);
  }
  if (n) logger.info(`payout: expiry sweep moved ${n} request(s) to dispute`);
  return { expired: n };
}

/**
 * Return payouts that have sat in `dispute` longer than payout_dispute_hours
 * back to the global pool for a different trader to pick up. Resets the row to
 * awaiting_processing and clears the accept-time state (assigned trader, timer,
 * dispute markers); the rate is re-snapshotted on the next accept(). Only
 * touches still-disputed rows, so it can never disturb one an admin has since
 * resolved.
 *
 * NOTE: "a different trader" is not yet enforced — the returned request is open
 * to the whole pool, including the trader who let it lapse. Excluding that
 * trader needs a remembered previous-trader id and belongs with the per-trader
 * pool-access layer (still to build).
 */
async function returnDisputesToPool() {
  const hours = await settingsService.getNumber('payout_dispute_hours', DEFAULT_DISPUTE_HOURS);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db.PayoutRequest.findAll({
    where: { status: 'dispute', disputed_at: { [Op.lt]: cutoff } },
    limit: 200,
  });
  let n = 0;
  for (const row of rows) {
    let returned = null;
    // eslint-disable-next-line no-await-in-loop
    await db.sequelize.transaction(async (transaction) => {
      const fresh = await db.PayoutRequest.findByPk(row.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!fresh || fresh.status !== 'dispute') return; // admin resolved it in the meantime
      const prevTrader = fresh.assigned_trader_id;
      await fresh.update(
        {
          status: 'awaiting_processing',
          assigned_trader_id: null,
          accepted_at: null,
          expires_at: null,
          disputed_at: null,
          dispute_reason: null,
        },
        { transaction }
      );
      returned = { uuid: fresh.uuid, prevTrader };
      n += 1;
    });
    if (returned) {
      // The order is no longer this trader's — stop any of their devices still
      // armed for it, and put it back in every trader's pool view.
      // eslint-disable-next-line no-await-in-loop
      if (returned.prevTrader) await clearTraderDevicesPayout(returned.prevTrader, returned.uuid);
      broadcast('payout:returned-to-pool', { uuid: returned.uuid });
      emitToAdmin('payout:returned-to-pool', { uuid: returned.uuid });
    }
  }
  if (n) logger.info(`payout: returned ${n} stale dispute(s) to the global pool`);
  return { returned: n };
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
  returnDisputesToPool,
};
