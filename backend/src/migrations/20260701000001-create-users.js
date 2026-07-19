'use strict';

/** USERS — platform accounts (admin / trader / merchant). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'users',
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
        email: {
          type: Sequelize.STRING(191),
          allowNull: false,
          unique: true,
        },
        password_hash: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        role: {
          type: Sequelize.ENUM('admin', 'trader', 'merchant'),
          allowNull: false,
        },
        status: {
          type: Sequelize.ENUM('active', 'inactive', 'suspended', 'pending'),
          allowNull: false,
          defaultValue: 'pending',
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

    await queryInterface.addIndex('users', ['role'], { name: 'idx_users_role' });
    await queryInterface.addIndex('users', ['status'], { name: 'idx_users_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
