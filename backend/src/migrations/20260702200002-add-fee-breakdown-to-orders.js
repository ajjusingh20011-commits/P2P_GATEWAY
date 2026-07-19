'use strict';

/**
 * Persist the per-order fee breakdown computed at confirmation time.
 *   merchant_fee_usdt       — fee taken from the merchant (USDT)
 *   merchant_receives_usdt  — net credited to the merchant (USDT)
 *   trader_commission_usdt  — commission credited to the trader (USDT)
 *   platform_profit_usdt    — merchant_fee - trader_commission (USDT)
 *   confirmed_at            — when the order was confirmed
 *
 * `exchange_rate` and `amount_usdt` already exist on the orders table.
 * Idempotent: each column is only added if missing.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL, DATE } = Sequelize;
    const t = 'orders';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('merchant_fee_usdt', { type: DECIMAL(20, 8), allowNull: true, defaultValue: null });
    await add('merchant_receives_usdt', { type: DECIMAL(20, 8), allowNull: true, defaultValue: null });
    await add('trader_commission_usdt', { type: DECIMAL(20, 8), allowNull: true, defaultValue: null });
    await add('platform_profit_usdt', { type: DECIMAL(20, 8), allowNull: true, defaultValue: null });
    await add('confirmed_at', { type: DATE, allowNull: true, defaultValue: null });
  },

  async down(queryInterface) {
    const t = 'orders';
    for (const c of ['merchant_fee_usdt', 'merchant_receives_usdt', 'trader_commission_usdt', 'platform_profit_usdt', 'confirmed_at']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
