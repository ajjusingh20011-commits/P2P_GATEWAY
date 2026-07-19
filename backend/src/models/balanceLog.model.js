'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class BalanceLog extends Model {
    static associate(db) {
      BalanceLog.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      BalanceLog.belongsTo(db.Order, { foreignKey: 'order_id', as: 'order' });
    }
  }

  BalanceLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      type: { type: DataTypes.ENUM('deposit', 'deduction', 'commission'), allowNull: false },
      amount_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      balance_after: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      note: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: 'BalanceLog',
      tableName: 'balance_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return BalanceLog;
};
