'use strict';

/**
 * reset-demo.js — wipe all demo data and seed a single clean trader + merchant.
 *
 * Run:  node src/seeders/reset-demo.js
 *
 * Deletes every trader (except the admin account), every merchant, and all
 * payment details / orders / transactions / notification logs (plus the other
 * per-trader/per-merchant child rows so no foreign keys dangle). Then creates:
 *
 *   TRADER    trader@demo.com   / Demo@123456   (Demo Trader,  4% / 2%, 1000 USDT, offline)
 *   MERCHANT  merchant@demo.com / Demo@123456   (Demo Store,   payin 5% / payout 2%)
 *
 * No UPI / payment details are created — the trader adds those manually.
 */

require('dotenv').config();

const { connectDatabase, sequelize } = require('../loaders/database');
const db = require('../models');
const authService = require('../services/authService');
const { apiKey: genApiKey, apiSecret: genApiSecret } = require('../utils/ids');

async function wipe() {
  // Disable FK checks so we can clear child + parent tables without ordering.
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const truncate = { where: {}, truncate: false, force: true };
    await db.Transaction.destroy(truncate);
    await db.Dispute.destroy(truncate);
    await db.NotificationLog.destroy(truncate);
    await db.BalanceLog.destroy(truncate);
    await db.Payout.destroy(truncate);
    await db.Offer.destroy(truncate);
    await db.Settlement.destroy(truncate);
    await db.Order.destroy(truncate);
    await db.PaymentDetail.destroy(truncate);
    await db.Smartphone.destroy(truncate);
    await db.Trader.destroy(truncate);
    await db.Merchant.destroy(truncate);
    // Remove all non-admin user accounts (traders + merchants).
    await db.User.destroy({ where: { role: ['trader', 'merchant'] }, force: true });
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
  console.log('✓ Wiped traders, merchants, payment details, orders, transactions, notifications.');
}

async function seed() {
  const password_hash = await authService.hashPassword('Demo@123456');

  // ---- ONE TRADER ----
  const traderUser = await db.User.create({
    email: 'trader@demo.com',
    password_hash,
    role: 'trader',
    status: 'active',
  });
  const trader = await db.Trader.create({
    user_id: traderUser.id,
    balance_usdt: 1000,
    daily_limit: 0, // 0 = unlimited (keeps the demo frictionless)
    current_daily_used: 0,
    commission_rate: 4.0,
    payout_commission: 2.0,
    rate_label: 'My Rate',
    is_online: false, // starts OFFLINE — trader toggles on from their panel
  });
  await db.BalanceLog.create({
    trader_id: trader.id,
    type: 'deposit',
    amount_usdt: 1000,
    balance_after: 1000,
    note: 'Initial demo deposit',
  });
  console.log(`✓ Trader created:   trader@demo.com   / Demo@123456   (id ${trader.id}, 1000 USDT, offline)`);

  // ---- ONE MERCHANT ----
  const merchantUser = await db.User.create({
    email: 'merchant@demo.com',
    password_hash,
    role: 'merchant',
    status: 'active',
  });
  const merchant = await db.Merchant.create({
    user_id: merchantUser.id,
    business_name: 'Demo Store',
    api_key: genApiKey(),
    api_secret: genApiSecret(),
    balance: 0,
    balance_usdt: 0,
    payin_fee_percent: 5.0,
    payout_fee_percent: 2.0,
    is_active: true,
  });
  console.log(`✓ Merchant created: merchant@demo.com / Demo@123456   (id ${merchant.id}, Demo Store, 5%/2%)`);
}

(async () => {
  try {
    await connectDatabase();
    require('../models'); // ensure models are registered against the connection
    await wipe();
    await seed();
    console.log('\n✅ Demo reset complete. 1 trader + 1 merchant. No UPI accounts yet.');
    process.exit(0);
  } catch (err) {
    console.error('❌ reset-demo failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
