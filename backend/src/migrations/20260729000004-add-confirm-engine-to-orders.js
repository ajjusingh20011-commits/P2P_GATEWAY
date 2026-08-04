'use strict';

/**
 * smartMerge.confirmOrder() already accepts an `engine` tag (e.g. 'apk_notification',
 * 'scraper', 'trader_manual', 'sms', 'notification', 'screen_scraper', 'manual')
 * but previously only used it for the live order:confirmed socket
 * emit/Telegram message — never persisted it, so there was no way to query
 * "how was this order actually settled" after the fact. This column makes
 * that queryable/reportable, distinguishing trader-manual confirms (new
 * POST /:id/trader-confirm) from matching-engine-v2 Tier 0/1/2 auto-matches
 * (already distinguishable via match_tier) and from admin/legacy confirms.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.confirm_engine) {
      await queryInterface.addColumn('orders', 'confirm_engine', {
        type: Sequelize.STRING(30),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('orders', 'confirm_engine'); } catch (err) { /* noop */ }
  },
};
