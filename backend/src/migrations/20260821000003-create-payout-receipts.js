'use strict';

/**
 * payout_receipts — the GLOBAL single-use lock for a payment receipt (UTR / txn
 * id). A unique index on receipt_id is the lock: a second capture carrying the
 * same well-formed receipt id can never be reused for any payout. See the model.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, CHAR, STRING, DECIMAL, DATE, fn } = Sequelize;

    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('payout_receipts');
    if (exists) return;

    await queryInterface.createTable('payout_receipts', {
      id: { type: INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      receipt_id: { type: STRING(191), allowNull: false },
      trader_id: { type: INTEGER.UNSIGNED, allowNull: true },
      order_uuid: { type: CHAR(36), allowNull: true },
      amount_inr: { type: DECIMAL(15, 2), allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
      updated_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
    });

    // Unique index IS the lock (createTable's `unique: true` covers it, but make
    // it explicit + named so a duplicate insert reliably throws 1062).
    await queryInterface.addIndex('payout_receipts', ['receipt_id'], { unique: true, name: 'payout_receipts_receipt_id_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payout_receipts');
  },
};
