'use strict';

/**
 * Real DB-level backstop for UPI uniqueness on payment_details.upi_id —
 * this never actually existed. Uniqueness was enforced purely at the app
 * layer (traderController.assertUpiAvailable); nothing stopped a direct
 * write, a race between two concurrent requests, or a future code path
 * that forgets to call the check.
 *
 * MySQL/InnoDB's UNIQUE index treats every NULL as distinct from every
 * other NULL, so this needs no partial-index trick (unlike Mongo's
 * Account.upiId index, which explicitly excludes '' via a
 * partialFilterExpression) — rows with no UPI yet never collide.
 *
 * SAFETY: if duplicate non-empty upi_id values already exist, adding a
 * UNIQUE index would fail with an opaque SQL error, or (if written
 * naively) tempt a migration into silently deleting/renaming someone's
 * real data to make room for it. This migration does neither — it checks
 * first and refuses to proceed with a clear, actionable error, leaving
 * every row untouched. A known instance of this exists in local dev data
 * (3 payment_details rows all sharing upi_id 'paytm.s1z8m9a@pty', trader 1,
 * created across three different dates in July — leftover demo-seed
 * pollution, already flagged in PRODUCTION_READINESS_AUDIT.md §5/§15) and
 * must be resolved by a human before this migration can run there.
 */

const INDEX_NAME = 'uq_payment_details_upi_id';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [dupes] = await queryInterface.sequelize.query(`
      SELECT upi_id, COUNT(*) AS c
      FROM payment_details
      WHERE upi_id IS NOT NULL AND upi_id != ''
      GROUP BY upi_id
      HAVING COUNT(*) > 1
    `);
    if (dupes.length > 0) {
      const list = dupes.map((d) => `${d.upi_id} (${d.c}x)`).join(', ');
      throw new Error(
        `Cannot add a unique index on payment_details.upi_id — duplicate values already exist: ${list}. ` +
        `Resolve these manually (decide which row is real per UPI, deactivate/delete or re-key the others) ` +
        `then re-run this migration. Refusing to guess and silently modify real data.`
      );
    }

    await queryInterface.addIndex('payment_details', ['upi_id'], {
      name: INDEX_NAME,
      unique: true,
    });
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex('payment_details', INDEX_NAME);
    } catch (err) {
      /* noop — index may not exist if up() never got past the dupe check */
    }
  },
};
