'use strict';

/** SETTLEMENTS — periodic settlement between a trader and a merchant. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'settlements',
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
          onDelete: 'RESTRICT',
        },
        merchant_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'merchants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        total_amount: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: false,
          defaultValue: 0,
        },
        platform_fee: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: false,
          defaultValue: 0,
        },
        trader_commission: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: false,
          defaultValue: 0,
        },
        net_amount: {
          type: Sequelize.DECIMAL(20, 2),
          allowNull: false,
          defaultValue: 0,
        },
        status: {
          type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
          allowNull: false,
          defaultValue: 'pending',
        },
        settled_at: {
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

    await queryInterface.addIndex('settlements', ['trader_id'], {
      name: 'idx_settlements_trader_id',
    });
    await queryInterface.addIndex('settlements', ['merchant_id'], {
      name: 'idx_settlements_merchant_id',
    });
    await queryInterface.addIndex('settlements', ['status'], { name: 'idx_settlements_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settlements');
  },
};
