'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Trader extends Model {
    static associate(db) {
      Trader.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
      Trader.hasMany(db.PaymentDetail, { foreignKey: 'trader_id', as: 'paymentDetails' });
      Trader.hasMany(db.Smartphone, { foreignKey: 'trader_id', as: 'smartphones' });
      Trader.hasMany(db.Order, { foreignKey: 'trader_id', as: 'orders' });
      Trader.hasMany(db.Payout, { foreignKey: 'trader_id', as: 'payouts' });
      Trader.hasMany(db.Offer, { foreignKey: 'trader_id', as: 'offers' });
      Trader.hasMany(db.Settlement, { foreignKey: 'trader_id', as: 'settlements' });
      Trader.hasMany(db.NotificationLog, { foreignKey: 'trader_id', as: 'notificationLogs' });
      Trader.hasMany(db.BalanceLog, { foreignKey: 'trader_id', as: 'balanceLogs' });
    }
  }

  Trader.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
      balance_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      daily_limit: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
      current_daily_used: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
      is_online: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      last_heartbeat: { type: DataTypes.DATE, allowNull: true },
      telegram_chat_id: { type: DataTypes.STRING(64), allowNull: true },

      // Commission / "My Rate" configuration (set by admin).
      commission_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 4.0 },
      payout_commission: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 },
      rate_label: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'My Rate' },

      // Rate-margin system: trader_margin = "My Rate" % over base; admin_margin =
      // admin profit % over base. Platform profit is the spread between them.
      trader_margin: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 4.0 },
      admin_margin: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 5.0 },

      // Deposit types this trader accepts: any of ['FTD','STD'].
      deposit_types: { type: DataTypes.JSON, allowNull: true, defaultValue: ['FTD', 'STD'] },
    },
    {
      sequelize,
      modelName: 'Trader',
      tableName: 'traders',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Trader;
};
