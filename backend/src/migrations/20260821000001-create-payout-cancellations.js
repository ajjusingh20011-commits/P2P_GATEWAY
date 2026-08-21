'use strict';

/**
 * payout_cancellations — audit log of trader cancels, admin voids, and admin
 * return-to-pool actions on merchant payout requests. See the model for why
 * this can't live on the payout_requests row (re-pooled payouts keep no
 * canceled state). Powers cancelled-history + the accountability trail.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, CHAR, STRING, TEXT, DECIMAL, ENUM, DATE, fn } = Sequelize;

    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('payout_cancellations');
    if (exists) return;

    await queryInterface.createTable('payout_cancellations', {
      id: { type: INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      payout_request_id: { type: INTEGER.UNSIGNED, allowNull: false },
      payout_uuid: { type: CHAR(36), allowNull: false },
      merchant_id: { type: INTEGER.UNSIGNED, allowNull: true },
      amount_inr: { type: DECIMAL(15, 2), allowNull: true },
      actor_type: { type: ENUM('trader', 'admin'), allowNull: false },
      actor_id: { type: INTEGER.UNSIGNED, allowNull: true },
      reason_code: { type: STRING(64), allowNull: false },
      reason_note: { type: TEXT, allowNull: true },
      proof_url: { type: STRING(512), allowNull: true },
      outcome: { type: ENUM('returned_to_pool', 'terminal_canceled'), allowNull: false },
      created_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
      updated_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
    });

    await queryInterface.addIndex('payout_cancellations', ['payout_request_id']);
    await queryInterface.addIndex('payout_cancellations', ['actor_type', 'actor_id']);
    await queryInterface.addIndex('payout_cancellations', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payout_cancellations');
  },
};
