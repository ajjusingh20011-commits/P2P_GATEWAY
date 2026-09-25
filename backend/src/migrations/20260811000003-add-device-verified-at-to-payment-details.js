'use strict';

/**
 * Feature 2 — APK Device Verification via Random Test Payment.
 *
 * Before this, a newly-added payment detail became eligible for real routing
 * consideration the moment it was saved (subject only to connection_alive,
 * which itself starts NULL until the liveness sync's first pass) — nothing
 * ever confirmed the linked device could actually CAPTURE a payment, only
 * that it was heartbeating. A device that's online but has notification
 * access silently revoked, or is paired to the wrong app, would pass
 * connection_alive === true and still never confirm a real customer's
 * deposit.
 *
 * device_verified_at is an additive gate: routingEngine.eligibleAccountsFor()
 * will require it NOT NULL alongside the existing checks (connection_alive
 * === true, etc). Unlike connection_alive's own NULL though, an unbackfilled
 * NULL here on a row that's already routing today would immediately take
 * every currently-working trader account out of service the moment this
 * ships — nobody has ever gone through the new verification flow, because it
 * didn't exist until now.
 *
 * So this backfills: any row already connection_alive === true (i.e.
 * genuinely routing today, confirmed by the existing liveness signal) is
 * grandfathered in with device_verified_at = NOW() at migration time. Only
 * brand-new payment details created after this ships actually need to pass
 * through the QR test-payment flow. A row that ISN'T currently alive gets no
 * backfill — it wasn't routing-eligible before this migration either way, so
 * there is nothing to preserve, and it will need to pass verification like
 * any new detail once its connection comes back.
 */

const COLUMNS = {
  device_verified_at: {
    spec: (Sequelize) => ({ type: Sequelize.DATE, allowNull: true, defaultValue: null }),
  },
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('payment_details');
    for (const [name, def] of Object.entries(COLUMNS)) {
      if (!table[name]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn('payment_details', name, def.spec(Sequelize));
      }
    }
    // Grandfather-in backfill — see comment above. Idempotent (only touches
    // rows still NULL), safe to re-run.
    await queryInterface.sequelize.query(
      'UPDATE payment_details SET device_verified_at = NOW() WHERE connection_alive = TRUE AND device_verified_at IS NULL'
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('payment_details');
    for (const name of Object.keys(COLUMNS)) {
      if (table[name]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn('payment_details', name);
      }
    }
  },
};
