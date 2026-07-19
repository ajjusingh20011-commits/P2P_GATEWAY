'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(db) {
      User.hasOne(db.Trader, { foreignKey: 'user_id', as: 'trader' });
      User.hasOne(db.Merchant, { foreignKey: 'user_id', as: 'merchant' });
      User.hasMany(db.Dispute, { foreignKey: 'raised_by', as: 'disputes' });
    }
  }

  User.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
      email: { type: DataTypes.STRING(191), allowNull: false, unique: true, validate: { isEmail: true } },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.ENUM('admin', 'trader', 'merchant'), allowNull: false },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'suspended', 'pending'),
        allowNull: false,
        defaultValue: 'pending',
      },

      // Two-factor authentication (TOTP).
      totp_secret: { type: DataTypes.STRING(255), allowNull: true },
      two_fa_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      backup_codes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      // Never expose secrets by default; totp_secret/backup_codes only via withSecret.
      defaultScope: { attributes: { exclude: ['password_hash', 'totp_secret', 'backup_codes'] } },
      scopes: { withSecret: { attributes: { include: ['password_hash', 'totp_secret', 'backup_codes'] } } },
    }
  );

  return User;
};
