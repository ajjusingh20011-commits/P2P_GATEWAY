'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Payout extends Model {
    static associate(db) {
      Payout.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
    }
  }

  Payout.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      amount_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
      amount_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      payment_method: { type: DataTypes.STRING(50), allowNull: true },
      status: {
        type: DataTypes.ENUM(
          'awaiting',
          'processing',
          'settlement',
          'completed',
          'cancelled',
          'dispute'
        ),
        allowNull: false,
        defaultValue: 'awaiting',
      },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Payout',
      tableName: 'payouts',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Payout;
};
