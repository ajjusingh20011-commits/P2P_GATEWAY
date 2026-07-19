'use strict';

/** OFFERS — trader sell offers / rates. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'offers',
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
        currency_pair: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'USDT/INR',
        },
        exchange_rate: {
          type: Sequelize.DECIMAL(15, 4),
          allowNull: false,
        },
        rate_offset_percent: {
          type: Sequelize.DECIMAL(5, 2),
          allowNull: false,
          defaultValue: 0,
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }
    );

    await queryInterface.addIndex('offers', ['trader_id'], { name: 'idx_offers_trader_id' });
    await queryInterface.addIndex('offers', ['is_active'], { name: 'idx_offers_is_active' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('offers');
  },
};
