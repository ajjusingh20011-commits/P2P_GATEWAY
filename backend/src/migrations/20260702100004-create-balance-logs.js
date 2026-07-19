'use strict';

/**
 * balance_logs — an append-only ledger of every change to a trader's USDT
 * balance (deposits, deductions, commission credits), optionally tied to an order.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, DECIMAL, ENUM, STRING, DATE, fn } = Sequelize;

    // Idempotent: skip if the table already exists.
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('balance_logs');
    if (exists) return;

    await queryInterface.createTable('balance_logs', {
      id: { type: INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: {
        type: INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'traders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: { type: ENUM('deposit', 'deduction', 'commission'), allowNull: false },
      amount_usdt: { type: DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      balance_after: { type: DECIMAL(20, 8), allowNull: true },
      order_id: { type: INTEGER.UNSIGNED, allowNull: true },
      note: { type: STRING(255), allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
    });

    await queryInterface.addIndex('balance_logs', ['trader_id']);
    await queryInterface.addIndex('balance_logs', ['order_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('balance_logs');
  },
};
