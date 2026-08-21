'use strict';

/**
 * PayoutReceipt — the GLOBAL single-use lock for a payment receipt.
 *
 * Once a captured success screen has been cross-matched and used for ANY payout,
 * its receipt identity (the UTR, or a well-formed transaction id) is recorded
 * here with a UNIQUE index. A later capture carrying the same receipt id — for
 * the same payout or a different one — collides on that index and is rejected as
 * "Invalid Receipt (already used)". This is the server-authoritative, cross-
 * payout reuse guard (the per-payout device lock is only a local nicety).
 *
 * Only a WELL-FORMED receipt id is ever stored (see payoutMatch.receiptKey /
 * isWellFormedReceiptId): a mis-parsed short token must never burn a real
 * receipt, so thin screens without a solid UTR simply aren't globally locked —
 * they still pass through the content match (amount + account last-4).
 */

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class PayoutReceipt extends Model {}

  PayoutReceipt.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      // The locked identity — UTR or well-formed txn id. Globally unique.
      receipt_id: { type: DataTypes.STRING(191), allowNull: false, unique: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      // The payout it was first matched to (uuid; for a tie, the first candidate).
      order_uuid: { type: DataTypes.CHAR(36), allowNull: true },
      amount_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    },
    {
      sequelize,
      modelName: 'PayoutReceipt',
      tableName: 'payout_receipts',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return PayoutReceipt;
};
