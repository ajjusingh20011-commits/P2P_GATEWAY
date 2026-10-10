'use strict';

/**
 * Demo merchant feature. A demo merchant is a real `merchants` row (needed so
 * it can log in and the panel can tell it apart) but is_demo gates every
 * money-moving/outbound action server-side: order creation (orderService),
 * payout creation (payoutController), API-key auth (apiKeyAuth), and API
 * credential regeneration (merchantController) all reject it. Demo activity
 * never touches `orders`, `payout_requests`, `balance_logs` or the routing
 * engine — the merchant panel simulates everything client-side instead.
 *
 * Default false, so every existing merchant is unaffected.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('merchants');
    if (table.is_demo) return;

    await queryInterface.addColumn('merchants', 'is_demo', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('merchants');
    if (table.is_demo) {
      await queryInterface.removeColumn('merchants', 'is_demo');
    }
  },
};
