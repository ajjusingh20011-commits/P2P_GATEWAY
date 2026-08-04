'use strict';

/**
 * Matching engine v2 (see services/matchingEngineV2.js):
 *   - donor_submitted_utr: the UTR the donor enters at checkout (Prompt 3,
 *     not wired up yet — this column exists ahead of that UI so v2's Tier
 *     0/1 comparison logic has something to read; NULL until then).
 *   - match_tier: which tier settled this order (0 = exact UTR match,
 *     1 = receiver-side UTR present but didn't match donor's, 2 = amount
 *     match only, no UTR available). NULL for orders settled by the older
 *     smartMerge confidence path (paymentController.ingest) or manually.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.donor_submitted_utr) {
      await queryInterface.addColumn('orders', 'donor_submitted_utr', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
    if (!table.match_tier) {
      await queryInterface.addColumn('orders', 'match_tier', {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('orders', 'donor_submitted_utr'); } catch (err) { /* noop */ }
    try { await queryInterface.removeColumn('orders', 'match_tier'); } catch (err) { /* noop */ }
  },
};
