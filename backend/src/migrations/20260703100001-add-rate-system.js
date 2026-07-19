'use strict';

/**
 * Rate & commission system:
 *   traders.trader_margin  — "My Rate" margin % over the base rate (default 4.00)
 *   traders.admin_margin   — admin profit margin % over the base rate (default 5.00)
 *
 *   orders.trader_rate            — INR/USDT rate applied to the trader
 *   orders.admin_rate             — INR/USDT rate applied to the admin
 *   orders.trader_deduction_usdt  — USDT deducted from the trader
 *   orders.admin_receives_usdt    — USDT the admin records
 *   (platform_profit_usdt + merchant_receives_usdt already exist)
 *
 * Settings seeded: base_exchange_rate=100, admin_default_margin=5,
 * trader_default_margin=4.
 *
 * Idempotent: columns added only if missing; settings inserted with IGNORE.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL } = Sequelize;

    // --- traders ---
    const traders = await queryInterface.describeTable('traders');
    if (!traders.trader_margin) {
      await queryInterface.addColumn('traders', 'trader_margin', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 4.0 });
    }
    if (!traders.admin_margin) {
      await queryInterface.addColumn('traders', 'admin_margin', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 5.0 });
    }

    // --- orders ---
    const orders = await queryInterface.describeTable('orders');
    const addOrderCol = async (name, spec) => { if (!orders[name]) await queryInterface.addColumn('orders', name, spec); };
    await addOrderCol('trader_rate', { type: DECIMAL(10, 4), allowNull: true });
    await addOrderCol('admin_rate', { type: DECIMAL(10, 4), allowNull: true });
    await addOrderCol('trader_deduction_usdt', { type: DECIMAL(20, 8), allowNull: true });
    await addOrderCol('admin_receives_usdt', { type: DECIMAL(20, 8), allowNull: true });
    // These may already exist (added by an earlier migration) — guard anyway.
    await addOrderCol('platform_profit_usdt', { type: DECIMAL(20, 8), allowNull: true });
    await addOrderCol('merchant_receives_usdt', { type: DECIMAL(20, 8), allowNull: true });

    // --- settings (seed base rate + default margins) ---
    const now = new Date();
    await queryInterface.bulkInsert(
      'settings',
      [
        { key: 'base_exchange_rate', value: '100', created_at: now, updated_at: now },
        { key: 'admin_default_margin', value: '5', created_at: now, updated_at: now },
        { key: 'trader_default_margin', value: '4', created_at: now, updated_at: now },
      ],
      { ignoreDuplicates: true }
    );
  },

  async down(queryInterface) {
    for (const c of ['trader_margin', 'admin_margin']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn('traders', c);
    }
    for (const c of ['trader_rate', 'admin_rate', 'trader_deduction_usdt', 'admin_receives_usdt']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn('orders', c);
    }
    await queryInterface.bulkDelete('settings', { key: ['base_exchange_rate', 'admin_default_margin', 'trader_default_margin'] });
  },
};
