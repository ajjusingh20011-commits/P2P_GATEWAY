'use strict';

/**
 * DB-level backstop for the same-amount lock (routingEngine.js's
 * acquireAmountLock/hasSameAmountActiveOrder). Those are an application-level
 * Redis/in-memory mutex plus a live re-check query — real but not airtight if
 * Redis is down AND the API ever runs as more than one process, since there's
 * no database constraint to catch a duplicate insert.
 *
 * MySQL/MariaDB has no native partial/filtered unique index (unlike
 * Postgres's `UNIQUE ... WHERE status IN (...)`), so this uses the standard
 * MySQL-compatible substitute: a VIRTUAL generated column that evaluates to
 * NULL for terminal/inactive orders and to `<payment_detail_id>:<amount_inr>`
 * for orders in an ACTIVE_STATUSES status (mirrored exactly from
 * models/order.model.js), with a UNIQUE index on that column. MySQL/MariaDB
 * unique indexes treat multiple NULLs as non-conflicting, so terminal orders
 * never collide with each other — only two simultaneously-active orders for
 * the same account+amount would violate it.
 *
 * Verified against the live dev DB: MariaDB 10.4.32, which supports indexing
 * VIRTUAL generated columns (InnoDB, since MariaDB 10.2 / MySQL 5.7).
 *
 * This is a backstop only — the application-level lock/recheck in
 * orderService.js / routingEngine.js is unchanged and still runs first; this
 * index just guarantees the invariant even if that layer is ever bypassed.
 */

const GENERATED_COLUMN = 'active_amount_lock_key';
const INDEX_NAME = 'uq_orders_active_amount_lock';
// Keep in lockstep with ACTIVE_STATUSES in models/order.model.js.
const ACTIVE_STATUSES_SQL = "'pending','checkout_open','claimed_paid','under_review'";

module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (!table[GENERATED_COLUMN]) {
      await queryInterface.sequelize.query(`
        ALTER TABLE \`orders\`
        ADD COLUMN \`${GENERATED_COLUMN}\` VARCHAR(191)
          GENERATED ALWAYS AS (
            CASE WHEN \`status\` IN (${ACTIVE_STATUSES_SQL})
                 THEN CONCAT(\`payment_detail_id\`, ':', \`amount_inr\`)
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
