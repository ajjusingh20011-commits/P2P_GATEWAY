'use strict';

/**
 * Per-trader payout pool access + daily limit (Feature 2 access layer).
 *
 * The payout pool was open to every trader. This adds admin-controlled access:
 *   - payout_pool_access — may this trader see/pick from the global payout pool
 *     at all. Model default is FALSE (new traders must be allocated by an admin,
 *     "not unrestricted by default"), but every trader that EXISTS at migration
 *     time is grandfathered to TRUE so the currently-open live flow is not cut
 *     off the moment this ships.
 *   - payout_daily_limit — INR/day cap on payouts this trader may pick up
 *     (0 = no limit), enforced in payoutService.accept(), mirroring how
 *     traders.daily_limit works for pay-in.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('traders');
    if (!table.payout_pool_access) {
      await queryInterface.addColumn('traders', 'payout_pool_access', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
      // Grandfather existing traders — they had implicit access before this.
      await queryInterface.sequelize.query('UPDATE traders SET payout_pool_access = true');
    }
    if (!table.payout_daily_limit) {
      await queryInterface.addColumn('traders', 'payout_daily_limit', {
        type: Sequelize.DECIMAL(15, 2), allowNull: false, defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('traders');
    if (table.payout_pool_access) await queryInterface.removeColumn('traders', 'payout_pool_access');
    if (table.payout_daily_limit) await queryInterface.removeColumn('traders', 'payout_daily_limit');
  },
};
