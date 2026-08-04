'use strict';

/**
 * UTR-reuse prevention (matching engine v2) — DB-level backstop so a UTR
 * that already settled one order can never settle a second one.
 *
 * Same technique as 20260722000001-add-active-amount-lock-index.js: MySQL/
 * MariaDB has no partial/filtered unique index, so this uses a VIRTUAL
 * generated column that evaluates to the UTR only when the order is
 * status='success' and has a non-empty utr_number, NULL otherwise, with a
 * UNIQUE index on that column. Multiple NULLs don't collide (pending/failed/
 * no-UTR orders are unaffected); two 'success' orders sharing a UTR would.
 *
 * This is the backstop only — matchingEngineV2.matchAndSettle() does an
 * app-level pre-check first (for a clean, immediate rejection message);
 * this index guarantees the invariant even if that check is ever bypassed
 * or races.
 */

const GENERATED_COLUMN = 'settled_utr_lock_key';
const INDEX_NAME = 'uq_orders_settled_utr_lock';

module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (!table[GENERATED_COLUMN]) {
      await queryInterface.sequelize.query(`
        ALTER TABLE \`orders\`
        ADD COLUMN \`${GENERATED_COLUMN}\` VARCHAR(50)
          GENERATED ALWAYS AS (
            CASE WHEN \`status\` = 'success' AND \`utr_number\` IS NOT NULL AND \`utr_number\` != ''
                 THEN \`utr_number\`
                 ELSE NULL END
          ) VIRTUAL
      `);
    }

    try {
      await queryInterface.addIndex('orders', [GENERATED_COLUMN], {
        name: INDEX_NAME,
        unique: true,
      });
    } catch (err) {
      if (!/duplicate/i.test(err.message) && !/already exists/i.test(err.message)) throw err;
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('orders', INDEX_NAME); } catch (err) { /* noop */ }
    try { await queryInterface.removeColumn('orders', GENERATED_COLUMN); } catch (err) { /* noop */ }
  },
};
