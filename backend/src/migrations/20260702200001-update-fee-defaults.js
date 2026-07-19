'use strict';

/**
 * Update the DEFAULT fee/commission rates for NEW accounts (per spec):
 *   merchants.payin_fee_percent   3.00 -> 5.00
 *   merchants.payout_fee_percent  1.00 -> 2.00
 *   traders.commission_rate       2.00 -> 4.00
 *   traders.payout_commission     0.50 -> 2.00
 *
 * Only the column DEFAULT changes — existing rows keep their current values.
 * Admin can still override any account individually.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL } = Sequelize;
    await queryInterface.changeColumn('merchants', 'payin_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 5.0 });
    await queryInterface.changeColumn('merchants', 'payout_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 });
    await queryInterface.changeColumn('traders', 'commission_rate', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 4.0 });
    await queryInterface.changeColumn('traders', 'payout_commission', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 });
  },

  async down(queryInterface, Sequelize) {
    const { DECIMAL } = Sequelize;
    await queryInterface.changeColumn('merchants', 'payin_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 3.0 });
    await queryInterface.changeColumn('merchants', 'payout_fee_percent', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 1.0 });
    await queryInterface.changeColumn('traders', 'commission_rate', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 });
    await queryInterface.changeColumn('traders', 'payout_commission', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 0.5 });
  },
};
