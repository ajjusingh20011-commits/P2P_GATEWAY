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
 * Full three-way settlement for an order — the SUBTRACTIVE fee model:
 *   base_usdt         = amount_inr / base_rate
 *   merchant_receives = base_usdt − (base_usdt × merchant_payin% / 100)   → credited to merchant
 *   trader_deduction  = base_usdt − (base_usdt × trader_margin% / 100)   → deducted from trader
 *   platform_revenue  = trader_deduction − merchant_receives             → platform wallet
 *   merchant_fee_usdt = base_usdt × merchant_payin% / 100                → real amount subtracted from base_usdt
 *
 * Both percentages are taken off the SAME base_usdt (no more admin_rate/trader_rate
 * divisor pair) — merchant_payin% and trader_margin% each independently shrink the
 * base amount, and the platform pockets the difference.
 *
 * Rule: trader_margin should be LESS than merchant_payin% (else platform revenue
 * is zero or negative). This is validated when the admin sets the trader rate;
 * here we only warn so a settlement never hard-fails.
 *
 * `trader_rate`/`admin_rate` are still returned (derived from the resulting USDT
 * amounts) purely for display/back-compat with existing readers of order.trader_rate
 * / order.admin_rate — they no longer drive the math.
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

  const baseUsdt = base > 0 ? round8(Number(amountInr) / base) : 0;
  const merchantFee = round8((baseUsdt * merchantPayin) / 100);
  const merchantSettlement = round8(baseUsdt - merchantFee);
  const traderDeduction = round8(baseUsdt - (baseUsdt * traderMargin) / 100);
  const platformRevenue = round8(traderDeduction - merchantSettlement);

  // Derived, informational rates — the equivalent INR/USDT price implied by the
  // resulting amounts, for anything still displaying order.trader_rate/admin_rate.
  const traderRate = traderDeduction > 0 ? round4(Number(amountInr) / traderDeduction) : round4(base);
  const adminRate = merchantSettlement > 0 ? round4(Number(amountInr) / merchantSettlement) : round4(base);

  return {
    base_rate: base,
    base_usdt: baseUsdt,
    admin_rate: adminRate,
    merchant_payin_percent: merchantPayin,
    merchant_settlement_usdt: merchantSettlement,
    merchant_fee_usdt: merchantFee,
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
  calculateSettlement,
  FALLBACK_RATE,
};
