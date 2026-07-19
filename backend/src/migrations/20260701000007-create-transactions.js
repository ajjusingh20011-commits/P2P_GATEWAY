'use strict';

/** TRANSACTIONS — payment confirmations detected/reported by the APK engines. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'transactions',
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        smartphone_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'smartphones', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        engine_used: {
          type: Sequelize.ENUM('sms', 'notification', 'screen_scraper', 'manual'),
          allowNull: false,
        },
        raw_data: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        amount_detected: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        utr_number: {
          type: Sequelize.STRING(64),
          allowNull: true,
        },
        sender_name: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        sender_upi: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        confidence_score: {
          type: Sequelize.DECIMAL(5, 2),
          allowNull: true,
        },
        is_merged: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }
    );

    // Requested index
    await queryInterface.addIndex('transactions', ['utr_number'], {
      name: 'idx_transactions_utr_number',
    });
    await queryInterface.addIndex('transactions', ['order_id'], {
      name: 'idx_transactions_order_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('transactions');
  },
};
