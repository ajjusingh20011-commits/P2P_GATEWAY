'use strict';

/** SMARTPHONES — trader's connected devices running the APK. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'smartphones',
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
        device_name: {
          type: Sequelize.STRING(191),
          allowNull: true,
        },
        device_id: {
          type: Sequelize.STRING(191),
          allowNull: false,
          unique: true,
        },
        connection_type: {
          type: Sequelize.ENUM('sms', 'notification', 'screen_scraper', 'manual', 'hybrid'),
          allowNull: false,
          defaultValue: 'notification',
        },
        last_ping: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        is_online: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        auth_token: {
          type: Sequelize.STRING(255),
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

    await queryInterface.addIndex('smartphones', ['trader_id'], { name: 'idx_smartphones_trader_id' });
    await queryInterface.addIndex('smartphones', ['is_online'], { name: 'idx_smartphones_is_online' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('smartphones');
  },
};
