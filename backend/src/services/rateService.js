'use strict';

/**
 * rateService — exchange-rate provider (INR per 1 USDT).
 *
 * DEMO / fixed mode (current): returns the `exchange_rate` stored in settings,
 * cached in Redis for 60s.
 *
 * LIVE mode (future): when `exchange_rate_mode` = 'live', this is where a
 * Binance P2P (or other) lookup would go. The hook is stubbed below and simply
 * falls back to the stored rate for now.
 */

const db = require('../models');
const settingsService = require('./settingsService');
const logger = require('../utils/logger');
const { connection, isRedisAvailable } = require('../loaders/redis');

const LIVE_CACHE_KEY = 'rate:live:inr_usdt';
const LIVE_CACHE_TTL_SEC = 60;
const FALLBACK_RATE = 100;

/**
 * Placeholder for a live rate source (e.g. Binance P2P). Cached 60s in Redis.
 * Currently returns null so callers fall back to the fixed setting.
 */
async function fetchLiveRate() {
  if (isRedisAvailable()) {
    try {
      const cached = await connection.get(LIVE_CACHE_KEY);
      if (cached != null) return Number(cached);
    } catch (_) { /* ignore */ }
  }
  // TODO(live): call Binance P2P API here and compute the median INR/USDT price.
  // const rate = await binanceP2P.medianPrice('USDT', 'INR', 'SELL');
  const rate = null;
  if (rate != null && isRedisAvailable()) {
    try { await connection.set(LIVE_CACHE_KEY, String(rate), 'EX', LIVE_CACHE_TTL_SEC); } catch (_) { /* ignore */ }
  }
  return rate;
}

/**
 * Current exchange rate (INR per USDT). Honours the mode setting.
 * @returns {Promise<number>}
 */
async function getExchangeRate() {
  const mode = (await settingsService.get('exchange_rate_mode')) || 'fixed';
  if (mode === 'live') {
    const live = await fetchLiveRate();
    if (live && live > 0) return live;
    logger.warn('rateService: live mode requested but no live rate; using fixed setting');
  }
  const fixed = await settingsService.getNumber('exchange_rate', FALLBACK_RATE);
  return fixed > 0 ? fixed : FALLBACK_RATE;
}

/** Convert an INR amount to USDT at the current rate. */
async function inrToUsdt(amountInr) {
  const rate = await getExchangeRate();
  return { rate, amountUsdt: +(Number(amountInr) / rate).toFixed(8) };
}

/* ----------------------------- rate-margin model -------------------------- */
const round8 = (n) => +Number(n).toFixed(8);
const round4 = (n) => +Number(n).toFixed(4);

/** Base exchange rate (INR per USDT). Prefers `base_exchange_rate`, else the
 *  legacy `exchange_rate`, else the hard fallback. */
async function getBaseRate() {
  const base = await settingsService.getNumber('base_exchange_rate', 0);
  if (base > 0) return base;
  const legacy = await settingsService.getNumber('exchange_rate', FALLBACK_RATE);
  return legacy > 0 ? legacy : FALLBACK_RATE;
}

/**
 * Compute the trader/admin rates and USDT amounts for an order.
 *   trader_rate = base × (1 + trader_margin/100)
 *   admin_rate  = base × (1 + admin_margin/100)
 *   trader_deduction_usdt = amount_inr / trader_rate   (deducted from trader)
 *   admin_receives_usdt   = amount_inr / admin_rate    (platform records)
 *   platform_profit_usdt  = trader_deduction − admin_receives
 * @param {number} amountInr
 * @param {number|object} traderOrId  Trader instance or id (falls back to defaults)
 */
async function calculateOrderRates(amountInr, traderOrId) {
  const base = await getBaseRate();

  let trader = traderOrId;
  if (traderOrId != null && typeof traderOrId !== 'object') {
    trader = await db.Trader.findByPk(traderOrId);
  }
  const traderMargin = Number(trader?.trader_margin ?? (await settingsService.getNumber('trader_default_margin', 4)));
  const adminMargin = Number(trader?.admin_margin ?? (await settingsService.getNumber('admin_default_margin', 5)));

  const traderRate = round4(base + (base * traderMargin) / 100);
  const adminRate = round4(base + (base * adminMargin) / 100);

  const traderDeduction = round8(Number(amountInr) / traderRate);
  const adminReceives = round8(Number(amountInr) / adminRate);
  const platformProfit = round8(traderDeduction - adminReceives);

  return {
    base_rate: base,
    trader_margin: traderMargin,
    admin_margin: adminMargin,
    trader_rate: traderRate,
    admin_rate: adminRate,
    trader_deduction_usdt: traderDeduction,
    admin_receives_usdt: adminReceives,
    platform_profit_usdt: platformProfit,
  };
}

/**
 * Merchant fee is taken from what the admin records (admin_receives_usdt):
 *   merchant_fee      = admin_receives × merchant_payin% / 100
 *   merchant_receives = admin_receives − merchant_fee
 */
function calculateMerchantReceives(adminReceivesUsdt, merchantPayinPercent) {
  const fee = round8((Number(adminReceivesUsdt) * Number(merchantPayinPercent)) / 100);
  const receives = round8(Number(adminReceivesUsdt) - fee);
  return { merchant_fee_usdt: fee, merchant_receives_usdt: receives };
}

/**
 * Full three-way settlement for an order (the canonical model):
 *   admin_rate               = base + (base × merchant_payin% / 100)
 *   merchant_settlement_usdt = amount_inr / admin_rate      → credited to merchant
 *   trader_rate              = base + (base × trader_margin% / 100)
 *   trader_deduction_usdt    = amount_inr / trader_rate     → deducted from trader
 *   platform_revenue_usdt    = trader_deduction − merchant_settlement → platform wallet
 *
 * Rule: trader_margin should be LESS than merchant_payin% (else platform revenue
 * is zero or negative). This is validated when the admin sets the trader rate;
 * here we only warn so a settlement never hard-fails.
 */
async function calculateSettlement(amountInr, traderId, merchantId) {
  const base = await getBaseRate();

  const resolve = async (model, ref) => {
    if (ref == null) return null;
    return typeof ref === 'object' ? ref : model.findByPk(ref);
  };
  const trader = await resolve(db.Trader, traderId);
  const merchant = await resolve(db.Merchant, merchantId);

  const traderMargin = Number(trader?.trader_margin ?? (await settingsService.getNumber('trader_default_margin', 4)));
  const merchantPayin = Number(merchant?.payin_fee_percent ?? (await settingsService.getNumber('admin_default_margin', 5)));

  if (traderMargin >= merchantPayin) {
    logger.warn(`rateService: trader margin ${traderMargin}% >= merchant fee ${merchantPayin}% — platform revenue will be <= 0`);
  }

  const adminRate = round4(base + (base * merchantPayin) / 100);
  const traderRate = round4(base + (base * traderMargin) / 100);
  const merchantSettlement = round8(Number(amountInr) / adminRate);
  const traderDeduction = round8(Number(amountInr) / traderRate);
  const platformRevenue = round8(traderDeduction - merchantSettlement);

  return {
    base_rate: base,
    admin_rate: adminRate,
    merchant_payin_percent: merchantPayin,
    merchant_settlement_usdt: merchantSettlement,
    trader_rate: traderRate,
    trader_margin_percent: traderMargin,
    trader_deduction_usdt: traderDeduction,
    platform_revenue_usdt: platformRevenue,
  };
}

module.exports = {
  getExchangeRate,
  inrToUsdt,
  fetchLiveRate,
  getBaseRate,
  calculateOrderRates,
  calculateMerchantReceives,
  calculateSettlement,
  FALLBACK_RATE,
};
