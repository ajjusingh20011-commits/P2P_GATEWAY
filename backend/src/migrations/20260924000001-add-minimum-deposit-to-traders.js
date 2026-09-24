'use strict';

/**
 * Per-trader minimum security deposit (base floor, admin-adjustable).
 *
 * minimum_deposit_usd — an amount always excluded from this trader's
 * usable/order-eligible balance (see balanceService.getBalanceLocks and
 * routingEngine.eligibleTraders). Default 200, following the same
 * idempotent add-column pattern as payout_pool_access. No grandfather
 * UPDATE is needed — the column default already applies to existing rows.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('traders');
    if (!table.minimum_deposit_usd) {
      await queryInterface.addColumn('traders', 'minimum_deposit_usd', {
        type: Sequelize.DECIMAL(20, 8), allowNull: false, defaultValue: 200,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('traders');
    if (table.minimum_deposit_usd) await queryInterface.removeColumn('traders', 'minimum_deposit_usd');
  },
};
