'use strict';

/**
 * Adds trader commission / rate-label columns.
 *   commission_rate    — the trader's "My Rate" %, credited on each confirmed order
 *   payout_commission  — % taken on payouts (future use)
 *   rate_label         — label shown in the trader panel (default "My Rate")
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DECIMAL, STRING } = Sequelize;
    const t = 'traders';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('commission_rate', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 2.0 });
    await add('payout_commission', { type: DECIMAL(5, 2), allowNull: false, defaultValue: 0.5 });
    await add('rate_label', { type: STRING(50), allowNull: false, defaultValue: 'My Rate' });
  },

  async down(queryInterface) {
    const t = 'traders';
    for (const c of ['commission_rate', 'payout_commission', 'rate_label']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
