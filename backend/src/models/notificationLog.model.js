'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class NotificationLog extends Model {
    static associate(db) {
      NotificationLog.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      NotificationLog.belongsTo(db.PaymentDetail, {
        foreignKey: 'payment_detail_id',
        as: 'paymentDetail',
      });
    }
  }

  NotificationLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      payment_detail_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      notification_id: { type: DataTypes.STRING(191), allowNull: true },
      amount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
      transaction_id: { type: DataTypes.STRING(191), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      payment_method: { type: DataTypes.STRING(50), allowNull: true },
      received_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'NotificationLog',
      tableName: 'notification_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return NotificationLog;
};
