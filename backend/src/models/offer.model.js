'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Offer extends Model {
    static associate(db) {
      Offer.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
    }
  }

  Offer.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      currency_pair: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'USDT/INR' },
      exchange_rate: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
      rate_offset_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'Offer',
      tableName: 'offers',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Offer;
};
