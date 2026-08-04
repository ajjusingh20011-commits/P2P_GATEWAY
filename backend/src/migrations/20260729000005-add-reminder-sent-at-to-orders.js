'use strict';

/**
 * Tracks whether the under-review reminder sweep (jobs/underReviewReminder.js)
 * has already nudged a trader + admin about this order, so it fires exactly
 * once per order rather than every sweep tick. Purely a notification-side
 * marker — never read by any status-changing logic, and never blocks the
 * admin confirm/reject/dispute endpoints (see adminController.js), which
 * gate only on Order.REVIEWABLE_STATUSES regardless of this field.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.reminder_sent_at) {
      await queryInterface.addColumn('orders', 'reminder_sent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('orders', 'reminder_sent_at'); } catch (err) { /* noop */ }
  },
};
