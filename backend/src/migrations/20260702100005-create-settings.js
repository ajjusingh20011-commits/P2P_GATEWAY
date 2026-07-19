'use strict';

/**
 * settings — simple key/value store for platform configuration
 * (exchange rate, mode, platform name, order limits, …).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, DATE, fn } = Sequelize;

    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('settings');
    if (!exists) {
      await queryInterface.createTable('settings', {
        id: { type: INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        key: { type: STRING(100), allowNull: false, unique: true },
        value: { type: STRING(500), allowNull: true },
        created_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
        updated_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
      });
    }

    // Seed default settings (INSERT IGNORE so re-runs are harmless).
    const defaults = [
      ['exchange_rate', '100'],
      ['exchange_rate_mode', 'fixed'],
      ['platform_name', 'PayGateway'],
      ['order_expiry_minutes', '10'],
      ['min_order_amount', '100'],
      ['max_order_amount', '500000'],
    ];
    for (const [key, value] of defaults) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.sequelize.query(
        'INSERT IGNORE INTO settings (`key`, `value`, `created_at`, `updated_at`) VALUES (?, ?, NOW(), NOW())',
        { replacements: [key, value] }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settings');
  },
};
