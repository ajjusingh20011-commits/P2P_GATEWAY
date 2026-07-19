'use strict';

/**
 * PAYOUT_REQUESTS — merchant-initiated payouts processed by a trader ("Buy USDT").
 * Isolated from the existing `payouts` (trader withdrawal) table.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'payout_requests',
      {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        uuid: { type: Sequelize.CHAR(36), allowNull: false, unique: true },

        merchant_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'merchants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        assigned_trader_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'traders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },

        amount_inr: { type: Sequelize.DECIMAL(15, 2), allowNull: false },

        payment_method: { type: Sequelize.STRING(50), allowNull: false },
        account_number: { type: Sequelize.STRING(64), allowNull: true },
        upi_id: { type: Sequelize.STRING(191), allowNull: true },
        ifsc_code: { type: Sequelize.STRING(20), allowNull: true },
        recipient_name: { type: Sequelize.STRING(191), allowNull: false },
        bank_name: { type: Sequelize.STRING(191), allowNull: true },

        status: {
          type: Sequelize.ENUM(
            'awaiting_processing',
            'in_processing',
            'awaiting_settlement',
            'settlement_completed',
            'canceled',
            'dispute'
          ),
          allowNull: false,
          defaultValue: 'awaiting_processing',
        },
        priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },

        expires_at: { type: Sequelize.DATE, allowNull: true },
        accepted_at: { type: Sequelize.DATE, allowNull: true },
        transferred_at: { type: Sequelize.DATE, allowNull: true },
        settled_at: { type: Sequelize.DATE, allowNull: true },
        canceled_at: { type: Sequelize.DATE, allowNull: true },
        disputed_at: { type: Sequelize.DATE, allowNull: true },
        dispute_reason: { type: Sequelize.TEXT, allowNull: true },

        base_exchange_rate: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
        trader_payout_percent: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
        effective_payout_rate: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
        trader_credit_usdt: { type: Sequelize.DECIMAL(20, 8), allowNull: true },

        receipt_url: { type: Sequelize.STRING(512), allowNull: true },

        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      },
      { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' }
    );

    await queryInterface.addIndex('payout_requests', ['status'], { name: 'idx_payout_requests_status' });
    await queryInterface.addIndex('payout_requests', ['merchant_id'], { name: 'idx_payout_requests_merchant_id' });
    await queryInterface.addIndex('payout_requests', ['assigned_trader_id'], { name: 'idx_payout_requests_trader_id' });
    await queryInterface.addIndex('payout_requests', ['uuid'], { name: 'idx_payout_requests_uuid' });
    await queryInterface.addIndex('payout_requests', ['expires_at'], { name: 'idx_payout_requests_expires_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payout_requests');
  },
};
