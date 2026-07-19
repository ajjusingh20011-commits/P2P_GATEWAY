'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Settlement extends Model {
    static associate(db) {
      Settlement.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      Settlement.belongsTo(db.Merchant, { foreignKey: 'merchant_id', as: 'merchant' });
    }
  }

  Settlement.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      merchant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      total_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      platform_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      trader_commission: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      net_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      settled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Settlement',
      tableName: 'settlements',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Settlement;
};
