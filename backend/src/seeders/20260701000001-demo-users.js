'use strict';

/**
 * Demo accounts for local development (run via `npm run seed`).
 *
 *   admin@p2p.com     / Admin@123456      (admin)
 *   trader1@p2p.com   / Trader@123456     (trader, 2 active UPI accounts)
 *   trader2@p2p.com   / Trader@123456     (trader, 2 active UPI accounts)
 *   merchant@p2p.com  / Merchant@123456   (merchant, API key + secret)
 *
 * Fixed primary keys are used so profile FKs link deterministically on a fresh
 * database. Do NOT run against a populated `users` table.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;
const hash = (plain) => bcrypt.hashSync(plain, SALT_ROUNDS);

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // ---- Users ----
    await queryInterface.bulkInsert('users', [
      { id: 1, uuid: crypto.randomUUID(), email: 'admin@p2p.com', password_hash: hash('Admin@123456'), role: 'admin', status: 'active', created_at: now, updated_at: now },
      { id: 2, uuid: crypto.randomUUID(), email: 'trader1@p2p.com', password_hash: hash('Trader@123456'), role: 'trader', status: 'active', created_at: now, updated_at: now },
      { id: 3, uuid: crypto.randomUUID(), email: 'trader2@p2p.com', password_hash: hash('Trader@123456'), role: 'trader', status: 'active', created_at: now, updated_at: now },
      { id: 4, uuid: crypto.randomUUID(), email: 'merchant@p2p.com', password_hash: hash('Merchant@123456'), role: 'merchant', status: 'active', created_at: now, updated_at: now },
    ]);

    // ---- Traders (profiles) ----
    await queryInterface.bulkInsert('traders', [
      { id: 1, user_id: 2, balance_usdt: 1000, daily_limit: 500000, current_daily_used: 0, is_online: false, created_at: now },
      { id: 2, user_id: 3, balance_usdt: 1500, daily_limit: 500000, current_daily_used: 0, is_online: false, created_at: now },
    ]);

    // ---- Payment details (2 active UPI accounts per trader) ----
    await queryInterface.bulkInsert('payment_details', [
      { id: 1, trader_id: 1, account_name: 'Trader One GPay', upi_id: 'traderone.gpay@okaxis', bank_name: 'Axis Bank', account_type: 'gpay', daily_limit: 200000, today_used: 0, is_active: true, created_at: now },
      { id: 2, trader_id: 1, account_name: 'Trader One PhonePe', upi_id: 'traderone@ybl', bank_name: 'Yes Bank', account_type: 'phonepe', daily_limit: 200000, today_used: 0, is_active: true, created_at: now },
      { id: 3, trader_id: 2, account_name: 'Trader Two Paytm', upi_id: 'tradertwo@paytm', bank_name: 'Paytm Bank', account_type: 'paytm', daily_limit: 250000, today_used: 0, is_active: true, created_at: now },
      { id: 4, trader_id: 2, account_name: 'Trader Two BharatPe', upi_id: 'tradertwo@bharatpe', bank_name: 'ICICI Bank', account_type: 'bharat_pe', daily_limit: 250000, today_used: 0, is_active: true, created_at: now },
    ]);

    // ---- Merchant (profile with API credentials) ----
    await queryInterface.bulkInsert('merchants', [
      {
        id: 1,
        user_id: 4,
        business_name: 'Test Store',
        webhook_url: null,
        api_key: 'pk_live_' + crypto.randomBytes(16).toString('hex'),
        api_secret: 'sk_live_' + crypto.randomBytes(24).toString('hex'),
        balance: 0,
        commission_rate: 2.0,
        is_active: true,
        created_at: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    const { Op } = Sequelize;
    await queryInterface.bulkDelete('merchants', { user_id: { [Op.in]: [4] } });
    await queryInterface.bulkDelete('payment_details', { trader_id: { [Op.in]: [1, 2] } });
    await queryInterface.bulkDelete('traders', { user_id: { [Op.in]: [2, 3] } });
    await queryInterface.bulkDelete('users', {
      email: { [Op.in]: ['admin@p2p.com', 'trader1@p2p.com', 'trader2@p2p.com', 'merchant@p2p.com'] },
    });
  },
};
