'use strict';

/**
 * Adds `organization_name` to `payment_details` and back-fills any per-detail
 * limit columns that may be missing (so this migration is safe to run whether
 * or not the earlier 20260701999999 limits migration has already applied).
 *
 * Every addColumn is guarded against the column already existing, making the
 * whole migration idempotent.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL, INTEGER, DATEONLY, BOOLEAN, STRING } = Sequelize;
    const t = 'payment_details';

    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn(t, name, spec);
    };

    // Organisation / display name (the truly new column).
    await add('organization_name', { type: STRING(255), allowNull: true, defaultValue: null });

    // Per-transaction amount bounds.
    await add('min_amount', { type: DECIMAL(15, 2), allowNull: false, defaultValue: 100 });
    await add('max_amount', { type: DECIMAL(15, 2), allowNull: false, defaultValue: 100000 });

    // Max transaction COUNT per rolling window.
    await add('max_per_hour', { type: INTEGER, allowNull: false, defaultValue: 50 });
    await add('max_per_day', { type: INTEGER, allowNull: false, defaultValue: 200 });
    await add('max_per_week', { type: INTEGER, allowNull: false, defaultValue: 1000 });
    await add('max_per_month', { type: INTEGER, allowNull: false, defaultValue: 4000 });

    // Optional per-window AMOUNT caps (null = no cap).
    await add('monthly_limit', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await add('weekly_limit', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await add('daily_limit_amount', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await add('hourly_limit_amount', { type: DECIMAL(15, 2), allowNull: true, defaultValue: null });
    await add('monthly_start_date', { type: DATEONLY, allowNull: true, defaultValue: null });

    // Trader-facing activation flag.
    await add('is_active_detail', { type: BOOLEAN, allowNull: false, defaultValue: true });
  },

  async down(queryInterface) {
    // Only drop the column this migration introduced; the limit columns are
    // owned by 20260701999999 and dropped by that migration's down().
    const table = await queryInterface.describeTable('payment_details');
    if (table.organization_name) {
      await queryInterface.removeColumn('payment_details', 'organization_name');
    }
  },
};
