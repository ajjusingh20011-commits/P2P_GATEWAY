'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Transaction extends Model {
    static associate(db) {
      Transaction.belongsTo(db.Order, { foreignKey: 'order_id', as: 'order' });
      Transaction.belongsTo(db.Smartphone, { foreignKey: 'smartphone_id', as: 'smartphone' });
    }
  }

  Transaction.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      smartphone_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      engine_used: {
        type: DataTypes.ENUM('sms', 'notification', 'screen_scraper', 'manual'),
        allowNull: false,
      },
      raw_data: { type: DataTypes.TEXT, allowNull: true },
      amount_detected: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
      utr_number: { type: DataTypes.STRING(64), allowNull: true },
      sender_name: { type: DataTypes.STRING(191), allowNull: true },
      sender_upi: { type: DataTypes.STRING(191), allowNull: true },
      confidence_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      is_merged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'Transaction',
      tableName: 'transactions',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Transaction;
};
