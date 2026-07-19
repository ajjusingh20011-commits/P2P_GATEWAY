'use strict';

/**
 * Sequelize model registry.
 * Registers all models against the shared connection and wires associations.
 */

const { sequelize } = require('../loaders/database');

const db = { sequelize };

// Register models
db.User = require('./user.model')(sequelize);
db.Trader = require('./trader.model')(sequelize);
db.Merchant = require('./merchant.model')(sequelize);
db.Smartphone = require('./smartphone.model')(sequelize);
db.PaymentDetail = require('./paymentDetail.model')(sequelize);
db.Order = require('./order.model')(sequelize);
db.Transaction = require('./transaction.model')(sequelize);
db.NotificationLog = require('./notificationLog.model')(sequelize);
db.Payout = require('./payout.model')(sequelize);
db.PayoutRequest = require('./payoutRequest.model')(sequelize);
db.Offer = require('./offer.model')(sequelize);
db.Settlement = require('./settlement.model')(sequelize);
db.Dispute = require('./dispute.model')(sequelize);
db.BalanceLog = require('./balanceLog.model')(sequelize);
db.Setting = require('./setting.model')(sequelize);

// Wire associations
Object.values(db).forEach((model) => {
  if (model && typeof model.associate === 'function') {
    model.associate(db);
  }
});

module.exports = db;
