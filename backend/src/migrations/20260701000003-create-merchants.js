'use strict';

/** MERCHANTS — merchant profile, API credentials & balance, 1:1 with a user. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'merchants',
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        user_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          unique: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        business_name: {
          type: Sequelize.STRING(191),
          allowNull: false,
        },
        webhook_url: {
          type: Sequelize.STRING(512),
          allowNull: true,
        },
        api_key: {
          type: Sequelize.STRING(80),
          allowNull: false,
          unique: true,
        },
        api_secret: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        balance: {
          type: Sequelize.DECIMAL(20, 8),
          allowNull: false,
          defaultValue: 0,
        },
        commission_rate: {
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

    await queryInterface.addIndex('merchants', ['is_active'], { name: 'idx_merchants_is_active' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('merchants');
  },
};
