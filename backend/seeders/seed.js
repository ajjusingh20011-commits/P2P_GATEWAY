/**
 * Standalone seeder — `node seeders/seed.js`.
 *
 * Convenience alternative to the sequelize-cli seeder: connects, ensures tables
 * exist (sequelize.sync), and inserts the demo dataset via the models. Safe to
 * re-run — it no-ops if the admin user already exists.
 *
 *   admin@p2p.com     / Admin@123456
 *   trader1@p2p.com   / Trader@123456   (2 active UPI accounts)
 *   trader2@p2p.com   / Trader@123456   (2 active UPI accounts)
 *   merchant@p2p.com  / Merchant@123456 (API key + secret)
 */

require('dotenv').config();

const crypto = require('crypto');
const { sequelize, connectDatabase } = require('../src/loaders/database');
const db = require('../src/models');
const authService = require('../src/services/authService');
const { apiKey, apiSecret } = require('../src/utils/ids');
const logger = require('../src/utils/logger');

async function seed() {
  await connectDatabase();
  await sequelize.sync(); // create tables if they don't exist yet

  const existing = await db.User.findOne({ where: { email: 'admin@p2p.com' } });
  if (existing) {
    logger.info('Seed skipped: demo data already present.');
    return;
  }

  await sequelize.transaction(async (t) => {
    // Admin
    await db.User.create(
      { email: 'admin@p2p.com', password_hash: await authService.hashPassword('Admin@123456'), role: 'admin', status: 'active' },
      { transaction: t }
    );

    // Traders + profiles
    const makeTrader = async (email, balance) => {
      const user = await db.User.create(
        { email, password_hash: await authService.hashPassword('Trader@123456'), role: 'trader', status: 'active' },
        { transaction: t }
      );
      return db.Trader.create(
        { user_id: user.id, balance_usdt: balance, daily_limit: 500000 },
        { transaction: t }
      );
    };
    const t1 = await makeTrader('trader1@p2p.com', 1000);
    const t2 = await makeTrader('trader2@p2p.com', 1500);

    // 2 active UPI accounts per trader
    await db.PaymentDetail.bulkCreate(
      [
        { trader_id: t1.id, account_name: 'Trader One GPay', upi_id: 'traderone.gpay@okaxis', bank_name: 'Axis Bank', account_type: 'gpay', daily_limit: 200000, is_active: true },
        { trader_id: t1.id, account_name: 'Trader One PhonePe', upi_id: 'traderone@ybl', bank_name: 'Yes Bank', account_type: 'phonepe', daily_limit: 200000, is_active: true },
        { trader_id: t2.id, account_name: 'Trader Two Paytm', upi_id: 'tradertwo@paytm', bank_name: 'Paytm Bank', account_type: 'paytm', daily_limit: 250000, is_active: true },
        { trader_id: t2.id, account_name: 'Trader Two BharatPe', upi_id: 'tradertwo@bharatpe', bank_name: 'ICICI Bank', account_type: 'bharat_pe', daily_limit: 250000, is_active: true },
      ],
      { transaction: t }
    );

    // Merchant + profile with API credentials
    const mUser = await db.User.create(
      { email: 'merchant@p2p.com', password_hash: await authService.hashPassword('Merchant@123456'), role: 'merchant', status: 'active' },
      { transaction: t }
    );
    const key = apiKey();
    const secret = apiSecret();
    await db.Merchant.create(
      { user_id: mUser.id, business_name: 'Test Store', api_key: key, api_secret: secret, commission_rate: 2.0, is_active: true },
      { transaction: t }
    );

    logger.info('Seeded demo data.');
    logger.info(`Merchant API key:    ${key}`);
    logger.info(`Merchant API secret: ${secret}  (shown once)`);
  });
}

seed()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed failed', err);
    process.exit(1);
  });
