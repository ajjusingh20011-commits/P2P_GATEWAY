'use strict';

/**
 * Tier-1 audit trail (matching engine v2): the receiver-side event had a
 * UTR, but it didn't match (or there was nothing to match against on) the
 * order's donor_submitted_utr. Settlement proceeds anyway (receiver-side is
 * trusted) — this table exists purely so those cases can be reviewed later.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('utr_discrepancy_logs')) return;

    await queryInterface.createTable('utr_discrepancy_logs', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      order_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
      },
      expected_utr: { type: Sequelize.STRING(64), allowNull: true },
      actual_utr: { type: Sequelize.STRING(64), allowNull: false },
      source: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('utr_discrepancy_logs', ['order_id'], {
      name: 'idx_utr_discrepancy_logs_order_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('utr_discrepancy_logs');
  },
};
