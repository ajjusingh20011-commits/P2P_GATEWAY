'use strict';

/** DISPUTES — disputes raised against an order. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'disputes',
      {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        raised_by: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        reason: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        evidence_url: {
          type: Sequelize.STRING(512),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('open', 'reviewing', 'resolved'),
          allowNull: false,
          defaultValue: 'open',
        },
        resolution: {
          type: Sequelize.TEXT,
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

    await queryInterface.addIndex('disputes', ['order_id'], { name: 'idx_disputes_order_id' });
    await queryInterface.addIndex('disputes', ['status'], { name: 'idx_disputes_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('disputes');
  },
};
