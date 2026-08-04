'use strict';

/**
 * Payout fee model becomes two-sided (subtractive-additive, mirrors the
 * pay-in subtractive model added for orders):
 *   payout_requests.merchant_payout_percent — merchant's payout fee % snapshot
 *   payout_requests.merchant_liability_usdt — USDT debited from the merchant at settlement
 *   payout_requests.platform_profit_usdt    — merchant_liability_usdt - trader_credit_usdt
 *
 * Snapshotted at accept-time, same as the existing rate-snapshot columns
 * (base_exchange_rate, trader_payout_percent, effective_payout_rate,
 * trader_credit_usdt), and re-used verbatim at settlement.
 *
 * Idempotent: each column is only added if missing.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL } = Sequelize;
    const t = 'payout_requests';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('merchant_payout_percent', { type: DECIMAL(5, 2), allowNull: true });
    await add('merchant_liability_usdt', { type: DECIMAL(20, 8), allowNull: true });
    await add('platform_profit_usdt', { type: DECIMAL(20, 8), allowNull: true });
  },

  async down(queryInterface) {
    const t = 'payout_requests';
    for (const c of ['merchant_payout_percent', 'merchant_liability_usdt', 'platform_profit_usdt']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
