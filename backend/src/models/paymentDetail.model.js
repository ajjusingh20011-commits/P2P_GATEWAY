'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class PaymentDetail extends Model {
    static associate(db) {
      PaymentDetail.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      PaymentDetail.belongsTo(db.Smartphone, { foreignKey: 'smartphone_id', as: 'smartphone' });
      PaymentDetail.hasMany(db.Order, { foreignKey: 'payment_detail_id', as: 'orders' });
      PaymentDetail.hasMany(db.NotificationLog, {
        foreignKey: 'payment_detail_id',
        as: 'notificationLogs',
      });
    }
  }

  PaymentDetail.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      account_name: { type: DataTypes.STRING(191), allowNull: true },
      upi_id: { type: DataTypes.STRING(191), allowNull: true },
      bank_name: { type: DataTypes.STRING(191), allowNull: true },
      organization_name: { type: DataTypes.STRING(255), allowNull: true },
      account_type: {
        type: DataTypes.ENUM('gpay', 'phonepe', 'paytm', 'bharat_pe', 'airtel'),
        allowNull: false,
      },
      daily_limit: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
      today_used: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // LEGACY/DEAD: points at the MySQL `Smartphone` model, which nothing
      // real populates (the actual APK only ever calls ngo-backend's
      // /api/apk/* routes — see ngo_device_id below). Superseded by
      // ngo_device_id. Still read/written in a few places (grepped and
      // reported separately) — do not drop the column until those are
      // migrated or confirmed unreachable.
      smartphone_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      // Real ngo-backend Device (Mongo _id, as a string) this detail is
      // paired to — the actual APK/heartbeat pipeline. Distinct from the
      // legacy smartphone_id above, which points at a dead MySQL model.
      ngo_device_id: { type: DataTypes.STRING(191), allowNull: true },

      // Per-transaction amount bounds.
      min_amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
      max_amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 500000 },

      // Max transaction COUNT per rolling window.
      max_per_hour: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      max_per_day: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
      max_per_week: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5000 },
      max_per_month: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20000 },

      // Optional per-window AMOUNT caps (null = no cap for that window).
      monthly_limit: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      weekly_limit: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      daily_limit_amount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      hourly_limit_amount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      monthly_start_date: { type: DataTypes.DATEONLY, allowNull: true },

      // Trader-facing activation toggle (distinct from admin `is_active`).
      is_active_detail: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // Is the underlying connection (APK device / Web Login session) actually
      // alive? Mirrored from ngo-backend by jobs/connectionLiveness.js so the
      // routing decision never has to make a cross-service call. Three-state:
      // null = nothing linked (routing unaffected), true = alive, false = dead
      // (routing skips it). See the migration for why null is not `false`.
      connection_alive: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: null },
      connection_checked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },

      // RETAINED BUT INERT. Was the trader's "I confirm this account's
      // payments by hand" opt-in, and used to keep an account with no linked
      // connection eligible for routing. That is no longer allowed for the
      // connection-based platforms this system serves: pickEligibleAccount now
      // requires connection_alive === true and nothing else, and the UI that
      // set this flag is gone. Column kept rather than dropped so existing
      // rows are not rewritten; nothing reads it for routing.
      manually_confirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // When this account last ENTERED the live pool. The success score is
      // scoped to the current session and resets here, so an account that fell
      // below the routing threshold recovers by being toggled off and on.
      // NULL = never entered; scores nothing and is exempt from the threshold.
      live_session_started_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },

      // The EXACT session boundary: orders with a higher id belong to the
      // current session. `live_session_started_at` is only for display —
      // both it and orders.created_at are second-granular DATETIMEs, so an
      // order created in the same second as a toggle-on landed on an
      // ambiguous side and a score reset did not reliably clear. Order ids
      // are monotonic, so this partitions exactly, with no clock involved.
      live_session_start_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'PaymentDetail',
      tableName: 'payment_details',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return PaymentDetail;
};
