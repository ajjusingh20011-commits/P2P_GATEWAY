'use strict';

/**
 * Make the live-session boundary exact.
 *
 * The session score was scoped with `orders.created_at >= live_session_started_at`.
 * Both are MySQL DATETIME, i.e. whole seconds, so any order created in the same
 * second as a toggle-on falls on an ambiguous side of the boundary: an order
 * from the PREVIOUS session can be counted in the new one, which means the
 * reset a trader relies on to recover does not reliably clear the score. Caught
 * by the lifecycle test, which reset a session and still saw the old orders.
 *
 * Widening the timestamp to DATETIME(3) would only shrink the window, not close
 * it. `orders.id` is monotonic and unique, so a high-water mark taken when the
 * session starts partitions orders exactly, with no clock involved:
 *
 *     scored orders = payment_detail_id = X AND id > live_session_start_order_id
 *
 * live_session_started_at is kept — it is still the honest answer to "when did
 * this session begin" for display — but it no longer decides membership.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const pd = await queryInterface.describeTable('payment_details');
    if (pd.live_session_start_order_id) return;

    await queryInterface.addColumn('payment_details', 'live_session_start_order_id', {
      type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0,
    });

    // Existing live accounts start their session from the current top of the
    // orders table, matching the timestamp backfill in the previous migration:
    // history before this ships must not retroactively push an account below
    // the routing threshold.
    await queryInterface.sequelize.query(
      `UPDATE payment_details
          SET live_session_start_order_id = COALESCE((SELECT MAX(id) FROM orders), 0)
        WHERE is_active = true AND is_active_detail = true`
    );
  },

  async down(queryInterface) {
    const pd = await queryInterface.describeTable('payment_details');
    if (pd.live_session_start_order_id) {
      await queryInterface.removeColumn('payment_details', 'live_session_start_order_id');
    }
  },
};
