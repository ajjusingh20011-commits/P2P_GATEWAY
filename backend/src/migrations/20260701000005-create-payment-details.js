'use strict';

/** PAYMENT_DETAILS — trader's UPI / bank accounts used to receive payments. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'payment_details',
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
        account_name: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        upi_id: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        bank_name: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        account_type: {
          type: Sequelize.ENUM('gpay', 'phonepe', 'paytm', 'bharat_pe', 'airtel'),
          allowNull: false,
        },
        daily_limit: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        today_used: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        smartphone_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'smartphones', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
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
    await queryInterface.addIndex('payment_details', ['trader_id'], {
      name: 'idx_payment_details_trader_id',
    });
    await queryInterface.addIndex('payment_details', ['is_active'], {
      name: 'idx_payment_details_is_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_details');
  },
};
