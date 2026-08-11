'use strict';

/**
 * Explicit trader opt-in for accounts that have no real connection.
 *
 * The preceding migration (…000001-add-connection-liveness) made routing skip
 * an account whose connection is confirmed dead (connection_alive = false),
 * but left NULL — "nothing is linked to this UPI at all" — fully eligible.
 * That is the worse case, not the safer one: an account with no APK device and
 * no web session has no way to ever detect that a payment arrived, so every
 * order routed to it strands in claimed_paid until someone confirms it by
 * hand. Two live GPay/Paytm accounts were sitting in the pool exactly like
 * that when this was found.
 *
 * Rather than make NULL unconditionally ineligible, it becomes eligible only
 * when the trader has explicitly said "I watch this account and confirm its
 * payments myself". That keeps the deliberate manual-confirmation workflow
 * available while closing the accidental case, which is the whole bug.
 *
 * BACKFILL: NOT NULL DEFAULT false, then true for every row that is currently
 * routable (is_active AND is_active_detail). Without that pass this migration
 * would be an outage — at the time of writing 12 of 14 rows are
 * connection_alive NULL and *zero* rows are true, so a bare `false` default
 * would empty the routing pool for every trader in the system at once.
 * Grandfathering preserves today's behaviour exactly; the gate binds new
 * accounts and any account a trader later re-enables.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('payment_details');
    if (table.manually_confirmed) return;

    await queryInterface.addColumn('payment_details', 'manually_confirmed', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.sequelize.query(
      'UPDATE payment_details SET manually_confirmed = true WHERE is_active = true AND is_active_detail = true'
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('payment_details');
    if (table.manually_confirmed) {
      await queryInterface.removeColumn('payment_details', 'manually_confirmed');
    }
  },
};
