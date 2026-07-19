'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Dispute extends Model {
    static associate(db) {
      Dispute.belongsTo(db.Order, { foreignKey: 'order_id', as: 'order' });
      Dispute.belongsTo(db.User, { foreignKey: 'raised_by', as: 'raisedByUser' });
    }
  }

  Dispute.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      raised_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: false },
      evidence_url: { type: DataTypes.STRING(512), allowNull: true },
      status: {
        type: DataTypes.ENUM('open', 'reviewing', 'resolved'),
        allowNull: false,
        defaultValue: 'open',
      },
      resolution: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Dispute',
      tableName: 'disputes',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Dispute;
};
