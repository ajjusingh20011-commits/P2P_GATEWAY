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
      smartphone_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

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
