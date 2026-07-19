'use strict';

/**
 * Adds per-detail limit configuration to `payment_details`:
 *   - per-transaction min/max amount
 *   - max transaction COUNT per hour/day/week/month
 *   - optional per-window AMOUNT caps + monthly window start
 *   - a trader-facing activation flag (is_active_detail)
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL, INTEGER, DATEONLY, BOOLEAN } = Sequelize;
    const t = 'payment_details';

    await queryInterface.addColumn(t, 'min_amount', { type: DECIMAL(15, 2), allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn(t, 'max_amount', { type: DECIMAL(15, 2), allowNull: false, defaultValue: 500000 });
    await queryInterface.addColumn(t, 'max_per_hour', { type: INTEGER, allowNull: false, defaultValue: 100 });
    await queryInterface.addColumn(t, 'max_per_day', { type: INTEGER, allowNull: false, defaultValue: 1000 });
    await queryInterface.addColumn(t, 'max_per_week', { type: INTEGER, allowNull: false, defaultValue: 5000 });
    await queryInterface.addColumn(t, 'max_per_month', { type: INTEGER, allowNull: false, defaultValue: 20000 });
    await queryInterface.addColumn(t, 'monthly_limit', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await queryInterface.addColumn(t, 'weekly_limit', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await queryInterface.addColumn(t, 'daily_limit_amount', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await queryInterface.addColumn(t, 'hourly_limit_amount', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await queryInterface.addColumn(t, 'monthly_start_date', { type: DATEONLY, allowNull: true, defaultValue: null });
    await queryInterface.addColumn(t, 'is_active_detail', { type: BOOLEAN, allowNull: false, defaultValue: true });
  },

  async down(queryInterface) {
    const t = 'payment_details';
    const cols = [
      'min_amount', 'max_amount', 'max_per_hour', 'max_per_day', 'max_per_week', 'max_per_month',
      'monthly_limit', 'weekly_limit', 'daily_limit_amount', 'hourly_limit_amount',
      'monthly_start_date', 'is_active_detail',
    ];
    for (const c of cols) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
