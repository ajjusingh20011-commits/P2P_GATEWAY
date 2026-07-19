'use strict';

/** NOTIFICATION_LOGS — raw automation notification log for auditing/matching. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'notification_logs',
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
        payment_detail_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'payment_details', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        notification_id: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        amount: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: true,
        },
        currency: {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: 'INR',
        },
        transaction_id: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        payment_method: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        received_at: {
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

    await queryInterface.addIndex('notification_logs', ['trader_id'], {
      name: 'idx_notification_logs_trader_id',
    });
    await queryInterface.addIndex('notification_logs', ['transaction_id'], {
      name: 'idx_notification_logs_transaction_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_logs');
  },
};
