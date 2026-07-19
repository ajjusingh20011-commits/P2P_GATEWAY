'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Merchant extends Model {
    static associate(db) {
      Merchant.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
      Merchant.hasMany(db.Order, { foreignKey: 'merchant_id', as: 'orders' });
      Merchant.hasMany(db.Settlement, { foreignKey: 'merchant_id', as: 'settlements' });
    }
  }

  Merchant.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      business_name: { type: DataTypes.STRING(191), allowNull: false },
      webhook_url: { type: DataTypes.STRING(512), allowNull: true },
      api_key: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      api_secret: { type: DataTypes.STRING(255), allowNull: false },
      balance: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      commission_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // Fee configuration + settled USDT balance.
      payin_fee_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 5.0 },
      payout_fee_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 },
      balance_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      daily_limit_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 1000000 },
    },
    {
      sequelize,
      modelName: 'Merchant',
      tableName: 'merchants',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      defaultScope: { attributes: { exclude: ['api_secret'] } },
      scopes: { withSecret: { attributes: {} } },
    }
  );

  return Merchant;
};
