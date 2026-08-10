'use strict';

/**
 * Routing liveness flag.
 *
 * pickEligibleAccount() could hand a real customer order to a UPI whose
 * underlying connection was already dead — an APK device that stopped
 * heartbeating, or a Web Login session that died while Mongo still said
 * status:'live' (that status can lag by hours). The order then sits in
 * claimed_paid with nobody able to confirm it.
 *
 * The liveness signal already exists and is correct — apk.js's isOnline()
 * (15s heartbeat window) and SessionStore.isSessionAlive() — it was simply
 * never consulted by routing. Rather than call ngo-backend from inside the
 * checkout decision path (latency + a new failure mode on every order), a
 * background sync mirrors that signal onto this column and routing reads it
 * locally.
 *
 * Deliberately THREE-state, not a boolean default:
 *   NULL  - no APK device and no web account linked to this UPI. Routing is
 *           unaffected. This is the common case (13 of 14 rows at the time
 *           of writing), so a NOT NULL DEFAULT false would have silently
 *           taken every currently-routing account out of service.
 *   true  - linked and confirmed alive.
 *   false - linked and confirmed dead -> skipped by routing.
 */

const COLUMNS = {
  connection_alive: {
    type: 'BOOLEAN',
    spec: (Sequelize) => ({ type: Sequelize.BOOLEAN, allowNull: true, defaultValue: null }),
  },
  connection_checked_at: {
    type: 'DATE',
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
