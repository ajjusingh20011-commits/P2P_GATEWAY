'use strict';

/**
 * Backfill any closed order that is missing its locked base exchange rate.
 *
 * A settled order's INR→USDT conversion must be permanently pinned to the rate
 * that was live when it settled. The rate IS persisted per order at creation
 * (orderService) and re-persisted at settlement (balanceService.settleOrder),
 * so in a healthy system exchange_rate is never null. But the commission /
 * earnings recomputations used to fall back to the CURRENT base rate whenever a
 * stored rate was missing (`Number(o.exchange_rate) || baseRate`), which meant
 * changing the base rate today retroactively revalued any null-rate history.
 *
 * That fallback has been removed — those recomputations now skip a null-rate
 * order rather than revalue it at the live rate. This migration backfills what
 * it can from the order's OWN stored rate fields (admin_rate, then trader_rate)
 * so genuinely settled orders are still counted, WITHOUT ever substituting a
 * live rate. Any order with no rate data anywhere (truly legacy) stays null and
 * is simply excluded — honest, not revalued.
 *
 * Confirmed zero affected rows in production at ship time; this is a safety net
 * for legacy/other-environment data and to keep the two changes coupled.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE orders
          SET exchange_rate = COALESCE(admin_rate, trader_rate)
        WHERE exchange_rate IS NULL
          AND status IN ('success', 'failed', 'rejected', 'disputed')
          AND (admin_rate IS NOT NULL OR trader_rate IS NOT NULL)`
    );
  },

  async down() {
    // Irreversible by design: a backfilled value is indistinguishable from an
    // original one, and both are the order's own locked rate, so there is
    // nothing unsafe to undo. No-op.
  },
};
