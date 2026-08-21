'use strict';

/**
 * PayoutCancellation — an audit record for every trader-cancel, admin-void, or
 * admin return-to-pool of a merchant payout request.
 *
 * Why a separate table: a trader cancel (and an admin "return to pool") sends
 * the payout BACK to the global pool (status → awaiting_processing), so the
 * payout_requests row itself keeps no "canceled" state — and its fields get
 * overwritten on the next pickup. This log is therefore the only durable record
 * of who cancelled/returned a payout, why, and with what proof. It powers the
 * trader/admin "cancelled history" view and the accountability trail on these
 * financial actions.
 *
 * outcome:
 *   returned_to_pool — the payout went back to awaiting_processing (trader
 *     cancel, or admin "return to pool" on a dispute).
 *   terminal_canceled — the payout was permanently canceled (admin void of a
 *     dispute, or admin reject of an awaiting_processing request).
 */

const { Model, DataTypes } = require('sequelize');

const OUTCOMES = ['returned_to_pool', 'terminal_canceled'];
const ACTORS = ['trader', 'admin'];

module.exports = (sequelize) => {
  class PayoutCancellation extends Model {
    static associate(db) {
      PayoutCancellation.belongsTo(db.PayoutRequest, { foreignKey: 'payout_request_id', as: 'payoutRequest' });
    }
  }

  PayoutCancellation.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      payout_request_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      // Denormalised so the history view renders without a join even if the
      // payout row later moves on to a new trader/settlement.
      payout_uuid: { type: DataTypes.CHAR(36), allowNull: false },
      merchant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      amount_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: true },

      actor_type: { type: DataTypes.ENUM(...ACTORS), allowNull: false },
      // trader.id for a trader cancel; the admin User.id for an admin action.
      actor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      reason_code: { type: DataTypes.STRING(64), allowNull: false },
      reason_note: { type: DataTypes.TEXT, allowNull: true },
      // Optional supporting proof — a URL, same no-file-upload convention as
      // PayoutRequest.receipt_url.
      proof_url: { type: DataTypes.STRING(512), allowNull: true },

      outcome: { type: DataTypes.ENUM(...OUTCOMES), allowNull: false },
    },
    {
      sequelize,
      modelName: 'PayoutCancellation',
      tableName: 'payout_cancellations',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  PayoutCancellation.OUTCOMES = OUTCOMES;
  PayoutCancellation.ACTORS = ACTORS;
  return PayoutCancellation;
};
