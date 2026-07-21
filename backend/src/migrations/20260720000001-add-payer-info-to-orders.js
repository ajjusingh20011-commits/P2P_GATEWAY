'use strict';

/**
 * Adds payer_name / payer_upi / auto_verified to `orders`, needed by
 * orderController.verifyPayment — the NGO backend's auto-settlement callback
 * (POST /api/orders/verify-payment) writes these to record who paid and
 * whether the order was closed automatically vs. by admin review.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const table = await queryInterface.describeTable('orders');
    const addIfMissing = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn('orders', name, spec);
    };

    await addIfMissing('payer_name', { type: DataTypes.STRING(191), allowNull: true });
    await addIfMissing('payer_upi', { type: DataTypes.STRING(191), allowNull: true });
    await addIfMissing('auto_verified', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  },

  async down(queryInterface) {
    for (const col of ['payer_name', 'payer_upi', 'auto_verified']) {
      // eslint-disable-next-line no-await-in-loop
      try { await queryInterface.removeColumn('orders', col); } catch (e) { /* noop */ }
    }
  },
};
