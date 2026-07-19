'use strict';

/**
 * Demo test data — 3 traders (each with 2 UPIs) + 3 merchants, all @test.com,
 * password Test@123456, with explicit fee/commission rates and starting
 * balances for exercising the complete order flow.
 *
 * Idempotent: existing accounts (by email) are skipped, so it is safe to re-run.
 * Run directly:   node src/seeders/demo-test-seed.js
 * Undo:           node src/seeders/demo-test-seed.js --down
 */

const db = require('../models');
const authService = require('../services/authService');
const { apiKey: genApiKey, apiSecret: genApiSecret } = require('../utils/ids');

const PASSWORD = 'Test@123456';

const TRADERS = [
  {
    email: 'trader1@test.com', name: 'Trader One',
    commission_rate: 4.0, payout_commission: 2.0, balance_usdt: 1000,
    upis: [
      { account_name: 'Trader One', upi_id: 'trader1gpay@okicici', account_type: 'gpay', bank_name: 'ICICI Bank' },
      { account_name: 'Trader One', upi_id: 'trader1phone@ybl', account_type: 'phonepe', bank_name: 'Yes Bank' },
    ],
  },
  {
    email: 'trader2@test.com', name: 'Trader Two',
    commission_rate: 3.5, payout_commission: 1.5, balance_usdt: 500,
    upis: [
      { account_name: 'Trader Two', upi_id: 'trader2paytm@paytm', account_type: 'paytm', bank_name: 'SBI' },
      { account_name: 'Trader Two', upi_id: 'trader2bharat@upi', account_type: 'bharat_pe', bank_name: 'HDFC Bank' },
    ],
  },
  {
    email: 'trader3@test.com', name: 'Trader Three',
    commission_rate: 4.5, payout_commission: 2.5, balance_usdt: 2000,
    upis: [
      { account_name: 'Trader Three', upi_id: 'trader3airtel@airtel', account_type: 'airtel', bank_name: 'Airtel Payments Bank' },
      { account_name: 'Trader Three', upi_id: 'trader3gpay@okaxis', account_type: 'gpay', bank_name: 'Axis Bank' },
    ],
  },
];

const MERCHANTS = [
  { email: 'merchant1@test.com', business_name: 'Shop One', payin_fee_percent: 5.0, payout_fee_percent: 2.0 },
  { email: 'merchant2@test.com', business_name: 'Store Two', payin_fee_percent: 4.0, payout_fee_percent: 1.5 },
  { email: 'merchant3@test.com', business_name: 'Business Three', payin_fee_percent: 6.0, payout_fee_percent: 2.5 },
];

async function up() {
  const password_hash = await authService.hashPassword(PASSWORD);

  for (const t of TRADERS) {
    const existing = await db.User.findOne({ where: { email: t.email } });
    if (existing) { console.log(`↷ skip trader ${t.email} (exists)`); continue; }

    const result = await db.sequelize.transaction(async (transaction) => {
      const user = await db.User.create(
        { email: t.email, password_hash, role: 'trader', status: 'active' }, { transaction }
      );
      const trader = await db.Trader.create(
        {
          user_id: user.id, balance_usdt: t.balance_usdt, daily_limit: 0,
          commission_rate: t.commission_rate, payout_commission: t.payout_commission, is_online: false,
        }, { transaction }
      );
      for (const u of t.upis) {
        // eslint-disable-next-line no-await-in-loop
        await db.PaymentDetail.create(
          { trader_id: trader.id, ...u, is_active: true, is_active_detail: true, min_amount: 100, max_amount: 100000 },
          { transaction }
        );
      }
      if (t.balance_usdt > 0) {
        await db.BalanceLog.create(
          { trader_id: trader.id, type: 'deposit', amount_usdt: t.balance_usdt, balance_after: t.balance_usdt, note: 'Demo seed deposit' },
          { transaction }
        );
      }
      return trader;
    });
    console.log(`✓ trader ${t.email}  commission=${t.commission_rate}%  balance=${t.balance_usdt} USDT  (id ${result.id}, 2 UPIs)`);
  }

  for (const m of MERCHANTS) {
    const existing = await db.User.findOne({ where: { email: m.email } });
    if (existing) { console.log(`↷ skip merchant ${m.email} (exists)`); continue; }

    const api_key = genApiKey();
    const api_secret = genApiSecret();
    const result = await db.sequelize.transaction(async (transaction) => {
      const user = await db.User.create(
        { email: m.email, password_hash, role: 'merchant', status: 'active' }, { transaction }
      );
      return db.Merchant.create(
        {
          user_id: user.id, business_name: m.business_name, api_key, api_secret,
          payin_fee_percent: m.payin_fee_percent, payout_fee_percent: m.payout_fee_percent, is_active: true,
        }, { transaction }
      );
    });
    console.log(`✓ merchant ${m.email}  "${m.business_name}"  payin=${m.payin_fee_percent}%  payout=${m.payout_fee_percent}%  (id ${result.id}, api_key ${api_key})`);
  }
}

async function down() {
  const emails = [...TRADERS.map((t) => t.email), ...MERCHANTS.map((m) => m.email)];
  const users = await db.User.findAll({ where: { email: emails } });
  for (const u of users) {
    if (u.role === 'trader') {
      const tr = await db.Trader.findOne({ where: { user_id: u.id } });
      if (tr) {
        await db.PaymentDetail.destroy({ where: { trader_id: tr.id } });
        await db.BalanceLog.destroy({ where: { trader_id: tr.id } });
        await db.Trader.destroy({ where: { id: tr.id } });
      }
    } else if (u.role === 'merchant') {
      await db.Merchant.destroy({ where: { user_id: u.id } });
    }
    await db.User.destroy({ where: { id: u.id } });
    console.log(`✗ removed ${u.email}`);
  }
}

// sequelize-cli compatible export (ignores queryInterface, uses models).
module.exports = { up, down };

// Direct execution.
if (require.main === module) {
  const isDown = process.argv.includes('--down');
  (isDown ? down() : up())
    .then(() => { console.log(isDown ? 'Demo seed reverted.' : 'Demo seed complete.'); process.exit(0); })
    .catch((e) => { console.error('Demo seed error:', e.message); process.exit(1); });
}
