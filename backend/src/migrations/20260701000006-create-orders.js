'use strict';

/** ORDERS — core payment orders routed from a merchant to a trader. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'orders',
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        uuid: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          unique: true,
        },
        merchant_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'merchants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        trader_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'traders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        payment_detail_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'payment_details', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        amount_inr: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        amount_usdt: {
          type: Sequelize.DECIMAL(20, 8),
          allowNull: true,
        },
        exchange_rate: {
          type: Sequelize.DECIMAL(15, 4),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM(
            'new',
            'assigned',
            'paid',
            'confirmed',
            'expired',
            'disputed',
            'cancelled'
          ),
          allowNull: false,
          defaultValue: 'new',
        },
        customer_ref: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        upi_ref_id: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
        },
      },
      { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }
    );

    // Requested indexes
    await queryInterface.addIndex('orders', ['status'], { name: 'idx_orders_status' });
    await queryInterface.addIndex('orders', ['merchant_id'], { name: 'idx_orders_merchant_id' });
    await queryInterface.addIndex('orders', ['trader_id'], { name: 'idx_orders_trader_id' });
    // Useful for expiry sweeps
    await queryInterface.addIndex('orders', ['expires_at'], { name: 'idx_orders_expires_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('orders');
  },
};
