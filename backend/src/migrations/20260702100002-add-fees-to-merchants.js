'use strict';

/**
 * Adds merchant fee / balance columns.
 *   payin_fee_percent  — % fee charged on pay-ins (default 3.00)
 *   payout_fee_percent — % fee charged on payouts (default 1.00)
 *   balance_usdt       — merchant's settled balance in USDT
 *   daily_limit_inr    — max INR volume per day (0 = unlimited)
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL } = Sequelize;
    const t = 'merchants';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('payin_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 3.0 });
    await add('payout_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 1.0 });
    await add('balance_usdt', { type: DECIMAL(20, 8), allowNull: false, defaultValue: 0 });
    await add('daily_limit_inr', { type: DECIMAL(15, 2), allowNull: false, defaultValue: 1000000 });
  },

  async down(queryInterface) {
    const t = 'merchants';
    for (const c of ['payin_fee_percent', 'payout_fee_percent', 'balance_usdt', 'daily_limit_inr']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
