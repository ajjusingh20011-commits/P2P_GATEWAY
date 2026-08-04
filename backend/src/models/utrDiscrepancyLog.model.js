'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class UtrDiscrepancyLog extends Model {
    static associate(db) {
      UtrDiscrepancyLog.belongsTo(db.Order, { foreignKey: 'order_id', as: 'order' });
    }
  }

  UtrDiscrepancyLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      expected_utr: { type: DataTypes.STRING(64), allowNull: true },
      actual_utr: { type: DataTypes.STRING(64), allowNull: false },
      source: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      sequelize,
      modelName: 'UtrDiscrepancyLog',
      tableName: 'utr_discrepancy_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return UtrDiscrepancyLog;
};
