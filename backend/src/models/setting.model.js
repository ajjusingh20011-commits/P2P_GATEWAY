'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Setting extends Model {}

  Setting.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      value: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Setting',
      tableName: 'settings',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Setting;
};
