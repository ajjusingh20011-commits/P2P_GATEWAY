'use strict';

/**
 * WebhookLog — one row per merchant webhook, acting as BOTH the durable retry
 * queue and the delivery audit trail. See the migration for why this exists
 * (the previous retry guarantee depended on the host's Redis version).
 *
 * Lifecycle:
 *   pending    — queued, `next_attempt_at` says when it is due
 *   delivering — a worker has claimed this row for one attempt (claim is an
 *                atomic conditional UPDATE, so the inline send and the sweep
 *                can never deliver the same row twice)
 *   delivered  — a 2xx was received; `delivered_at` set
 *   failed     — `max_attempts` exhausted; terminal, never retried again
 *
 * `payload` is the exact body that was signed and sent, so `signature` can
 * always be re-verified from this row alone.
 */

const { Model, DataTypes } = require('sequelize');

const STATUSES = ['pending', 'delivering', 'delivered', 'failed'];

module.exports = (sequelize) => {
  class WebhookLog extends Model {
    static associate(db) {
      WebhookLog.belongsTo(db.Merchant, { foreignKey: 'merchant_id', as: 'merchant' });
      WebhookLog.belongsTo(db.Order, { foreignKey: 'order_id', as: 'order' });
    }
  }

  WebhookLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      merchant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      order_uuid: { type: DataTypes.CHAR(36), allowNull: true },
      event: { type: DataTypes.STRING(50), allowNull: false },
      // Resolved at enqueue time: the order's own callback_url when it has one,
      // else the merchant's registered webhook_url. Stored so an audit shows
      // where we actually sent it, not where we would send it today.
      target_url: { type: DataTypes.STRING(512), allowNull: false },
      payload: { type: DataTypes.TEXT, allowNull: false },
      signature: { type: DataTypes.STRING(64), allowNull: false },
      status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'pending' },
      attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 5 },
      last_status_code: { type: DataTypes.INTEGER, allowNull: true },
      last_error: { type: DataTypes.STRING(500), allowNull: true },
      next_attempt_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'WebhookLog',
      tableName: 'webhook_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  WebhookLog.STATUSES = STATUSES;

  return WebhookLog;
};
