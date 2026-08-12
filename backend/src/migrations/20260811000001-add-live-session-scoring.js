'use strict';

/**
 * Session-scoped account success scoring.
 *
 * Success rate is no longer a lifetime record. It is scoped to the account's
 * CURRENT time in the live pool: it starts clean when the trader brings the
 * account in, and resets on the next fresh entry. An account scoring below the
 * routing threshold stops receiving orders, and toggling it off and on is the
 * recovery path — which only works if "when did this session start" is stored.
 *
 *   payment_details.live_session_started_at
 *     When the account last entered the live pool. NULL = never entered, which
 *     scores zero orders and is therefore exempt from the threshold (an
 *     account with no history must be able to take its first order, otherwise
 *     nothing could ever start).
 *
 *   orders.disconnect_failed
 *     Set when the account's connection dies while this order is still open.
 *     Such an order counts as an unsuccessful outcome for scoring and stays
 *     that way even if the trader reconnects and settles it later — the
 *     customer already experienced the failure. Kept as its own column rather
 *     than inferred from status, because the final status may well end up
 *     `success` and the score must not silently forgive it.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const pd = await queryInterface.describeTable('payment_details');
    if (!pd.live_session_started_at) {
      await queryInterface.addColumn('payment_details', 'live_session_started_at', {
        type: Sequelize.DATE, allowNull: true, defaultValue: null,
      });
      // Backfill: every account currently in the live pool is treated as
      // having started its session now, so existing history does not
      // retroactively push an account below the threshold the instant this
      // ships. Accounts that are off stay NULL and get a session when the
      // trader next switches them on.
      await queryInterface.sequelize.query(
        'UPDATE payment_details SET live_session_started_at = NOW() WHERE is_active = true AND is_active_detail = true'
      );
    }

    const orders = await queryInterface.describeTable('orders');
    if (!orders.disconnect_failed) {
      await queryInterface.addColumn('orders', 'disconnect_failed', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    const pd = await queryInterface.describeTable('payment_details');
    if (pd.live_session_started_at) await queryInterface.removeColumn('payment_details', 'live_session_started_at');
    const orders = await queryInterface.describeTable('orders');
    if (orders.disconnect_failed) await queryInterface.removeColumn('orders', 'disconnect_failed');
  },
};
