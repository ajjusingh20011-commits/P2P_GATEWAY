'use strict';

/**
 * Adds 'cancelled' as its own terminal Order.status, distinct from 'failed'
 * (used for auto-expiry) and 'rejected' (used for admin rejection) — so
 * reporting can tell "donor cancelled before paying" apart from a timeout or
 * an admin decision. Used by the new public POST /:id/cancel-checkout route.
 *
 * 'cancelled' is intentionally NOT added to ACTIVE_STATUSES in
 * models/order.model.js, so it drops out of the same-amount lock exactly
 * like 'failed'/'rejected'/'disputed' already do — no other code changes
 * needed for the amount slot to release.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('pending','checkout_open','claimed_paid','under_review','success','failed','rejected','disputed','cancelled') " +
      "NOT NULL DEFAULT 'pending'"
    );
  },

  async down(queryInterface) {
    // Best-effort reverse: remap any 'cancelled' rows to 'failed' (their pre-
    // fix equivalent) before narrowing the ENUM back.
    await queryInterface.sequelize.query(
      "UPDATE `orders` SET `status` = 'failed' WHERE `status` = 'cancelled'"
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('pending','checkout_open','claimed_paid','under_review','success','failed','rejected','disputed') " +
      "NOT NULL DEFAULT 'pending'"
    );
  },
};
