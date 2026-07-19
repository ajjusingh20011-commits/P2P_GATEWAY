'use strict';

/** TRADERS — trader profile & balances, 1:1 with a user. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'traders',
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
        balance_usdt: {
          type: Sequelize.DECIMAL(20, 8),
          allowNull: false,
          defaultValue: 0,
        },
        daily_limit: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        current_daily_used: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        is_online: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        last_heartbeat: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        telegram_chat_id: {
          type: Sequelize.STRING(64),
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

    await queryInterface.addIndex('traders', ['is_online'], { name: 'idx_traders_is_online' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('traders');
  },
};
