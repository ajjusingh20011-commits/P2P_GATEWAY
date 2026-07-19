'use strict';

/**
 * PayoutRequest — merchant-initiated payout (a.k.a. trader "Buy USDT").
 *
 * A merchant asks the platform to send INR to a recipient. The request enters a
 * global pool (awaiting_processing); any eligible trader can accept it, pays the
 * recipient out-of-band, marks it transferred, and the admin settles it by
 * crediting the trader USDT at the payout rate.
 *
 * This is a SEPARATE table from `payouts` (which is the trader's own USDT
 * withdrawal flow) so neither feature affects the other.
 *
 * Status flow (enforced in payoutService):
 *   awaiting_processing → in_processing → awaiting_settlement → settlement_completed
 *   in_processing       → canceled | dispute
 *   awaiting_settlement → dispute
 *   awaiting_processing → canceled
 *   dispute             → settlement_completed | canceled
 */

const { Model, DataTypes } = require('sequelize');

const STATUSES = [
  'awaiting_processing',
  'in_processing',
  'awaiting_settlement',
  'settlement_completed',
  'canceled',
  'dispute',
];

module.exports = (sequelize) => {
  class PayoutRequest extends Model {
    static associate(db) {
      PayoutRequest.belongsTo(db.Merchant, { foreignKey: 'merchant_id', as: 'merchant' });
      PayoutRequest.belongsTo(db.Trader, { foreignKey: 'assigned_trader_id', as: 'assignedTrader' });
    }
  }

  PayoutRequest.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },

      merchant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      assigned_trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      amount_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: false },

      // Recipient payout details.
      payment_method: { type: DataTypes.STRING(50), allowNull: false }, // e.g. bank/imps, upi
      account_number: { type: DataTypes.STRING(64), allowNull: true },
      upi_id: { type: DataTypes.STRING(191), allowNull: true },
      ifsc_code: { type: DataTypes.STRING(20), allowNull: true },
      recipient_name: { type: DataTypes.STRING(191), allowNull: false },
      bank_name: { type: DataTypes.STRING(191), allowNull: true },

      status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'awaiting_processing' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Lifecycle timestamps.
      expires_at: { type: DataTypes.DATE, allowNull: true },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      transferred_at: { type: DataTypes.DATE, allowNull: true },
      settled_at: { type: DataTypes.DATE, allowNull: true },
      canceled_at: { type: DataTypes.DATE, allowNull: true },
      disputed_at: { type: DataTypes.DATE, allowNull: true },
      dispute_reason: { type: DataTypes.TEXT, allowNull: true },

      // Rate snapshot (frozen at accept, re-used at settlement).
      base_exchange_rate: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
      trader_payout_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      effective_payout_rate: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
      trader_credit_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },

      receipt_url: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      sequelize,
      modelName: 'PayoutRequest',
      tableName: 'payout_requests',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  PayoutRequest.STATUSES = STATUSES;
  return PayoutRequest;
};
