'use strict';

const { Model, DataTypes } = require('sequelize');

// v2 order lifecycle.
const STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review', 'success', 'failed', 'rejected', 'disputed'];
// "Active" = the order is live and holds its trader/account (drives the
// same-amount lock + routing eligibility). Terminal = done.
const ACTIVE_STATUSES = ['pending', 'checkout_open', 'claimed_paid', 'under_review'];
// Statuses an admin can still settle/act on (customer has claimed payment).
const REVIEWABLE_STATUSES = ['claimed_paid', 'under_review'];

module.exports = (sequelize) => {
  class Order extends Model {
    static associate(db) {
      Order.belongsTo(db.Merchant, { foreignKey: 'merchant_id', as: 'merchant' });
      Order.belongsTo(db.Trader, { foreignKey: 'trader_id', as: 'trader' });
      Order.belongsTo(db.PaymentDetail, { foreignKey: 'payment_detail_id', as: 'paymentDetail' });
      Order.belongsTo(db.User, { foreignKey: 'reviewed_by', as: 'reviewer' });
      Order.hasMany(db.Transaction, { foreignKey: 'order_id', as: 'transactions' });
      Order.hasMany(db.Dispute, { foreignKey: 'order_id', as: 'disputes' });
    }
  }

  Order.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
      merchant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      trader_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      payment_detail_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      amount_inr: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
      amount_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      exchange_rate: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
      status: {
        type: DataTypes.ENUM(...STATUSES),
        allowNull: false,
        defaultValue: 'pending',
      },
      customer_ref: { type: DataTypes.STRING(100), allowNull: false },
      upi_ref_id: { type: DataTypes.STRING(191), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },

      // ---- Order System v2 ----
      gateway_order_id: { type: DataTypes.STRING(50), allowNull: true, unique: true },
      merchant_order_id: { type: DataTypes.STRING(100), allowNull: true },
      deposit_type: { type: DataTypes.ENUM('FTD', 'STD'), allowNull: false, defaultValue: 'STD' },
      callback_url: { type: DataTypes.STRING(500), allowNull: true },
      redirect_url: { type: DataTypes.STRING(500), allowNull: true },
      confirmation_type: { type: DataTypes.ENUM('utr', 'screenshot', 'no_proof'), allowNull: true },
      screenshot_path: { type: DataTypes.STRING(500), allowNull: true },
      claimed_paid_at: { type: DataTypes.DATE, allowNull: true },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      reviewed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      rejected_at: { type: DataTypes.DATE, allowNull: true },
      rejection_reason: { type: DataTypes.STRING(500), allowNull: true },

      // Customer-provided payment reference (entered on the checkout page).
      utr_number: { type: DataTypes.STRING(50), allowNull: true },
      customer_confirmed_at: { type: DataTypes.DATE, allowNull: true },

      // Per-order fee breakdown, filled at confirmation time (USDT).
      merchant_fee_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      merchant_receives_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      trader_commission_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      platform_profit_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      confirmed_at: { type: DataTypes.DATE, allowNull: true },

      // Rate-margin breakdown (filled at confirmation time).
      trader_rate: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      admin_rate: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      trader_deduction_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      admin_receives_usdt: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Order',
      tableName: 'orders',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  Order.STATUSES = STATUSES;
  Order.ACTIVE_STATUSES = ACTIVE_STATUSES;
  Order.REVIEWABLE_STATUSES = REVIEWABLE_STATUSES;
  return Order;
};
