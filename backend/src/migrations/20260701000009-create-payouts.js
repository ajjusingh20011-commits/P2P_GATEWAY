'use strict';

/** PAYOUTS — trader buy-USDT / withdrawal requests. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'payouts',
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        trader_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'traders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        amount_inr: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        amount_usdt: {
          type: Sequelize.DECIMAL(20, 8),
          allowNull: true,
        },
        payment_method: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM(
            'awaiting',
            'processing',
            'settlement',
            'completed',
            'cancelled',
            'dispute'
          ),
          allowNull: false,
          defaultValue: 'awaiting',
        },
        priority: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        accepted_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        completed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }
    );

    await queryInterface.addIndex('payouts', ['trader_id'], { name: 'idx_payouts_trader_id' });
    await queryInterface.addIndex('payouts', ['status'], { name: 'idx_payouts_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payouts');
  },
};
