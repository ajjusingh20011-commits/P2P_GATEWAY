'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Smartphone extends Model {
    static associate(db) {
      Smartphone.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      Smartphone.hasMany(db.PaymentDetail, { foreignKey: 'smartphone_id', as: 'paymentDetails' });
      Smartphone.hasMany(db.Transaction, { foreignKey: 'smartphone_id', as: 'transactions' });
    }
  }

  Smartphone.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      device_name: { type: DataTypes.STRING(191), allowNull: true },
      device_id: { type: DataTypes.STRING(191), allowNull: false, unique: true },
      connection_type: {
        type: DataTypes.ENUM('sms', 'notification', 'screen_scraper', 'manual', 'hybrid'),
        allowNull: false,
        defaultValue: 'notification',
      },
      last_ping: { type: DataTypes.DATE, allowNull: true },
      is_online: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      auth_token: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Smartphone',
      tableName: 'smartphones',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      defaultScope: { attributes: { exclude: ['auth_token'] } },
    }
  );

  return Smartphone;
};
