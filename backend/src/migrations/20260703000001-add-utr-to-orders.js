'use strict';

/**
 * Add customer-provided payment reference fields to orders:
 *   utr_number            — the UPI/UTR reference the customer enters on checkout
 *   customer_confirmed_at — when the customer clicked "Continue" / confirmed paid
 *
 * Idempotent: each column is only added if it doesn't already exist.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, DATE } = Sequelize;
    const t = 'orders';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('utr_number', { type: STRING(50), allowNull: true, defaultValue: null });
    await add('customer_confirmed_at', { type: DATE, allowNull: true, defaultValue: null });
  },

  async down(queryInterface) {
    const t = 'orders';
    for (const c of ['utr_number', 'customer_confirmed_at']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
