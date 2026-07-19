'use strict';

/**
 * Adds TOTP two-factor-authentication columns to users.
 *   totp_secret     — base32 secret (only meaningful once verified)
 *   two_fa_enabled  — whether 2FA is active for this account
 *   backup_codes    — JSON array of one-time backup codes (hashed)
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, BOOLEAN, TEXT } = Sequelize;
    const t = 'users';
    const table = await queryInterface.describeTable(t);
    const add = async (name, spec) => { if (!table[name]) await queryInterface.addColumn(t, name, spec); };

    await add('totp_secret', { type: STRING(255), allowNull: true, defaultValue: null });
    await add('two_fa_enabled', { type: BOOLEAN, allowNull: false, defaultValue: false });
    await add('backup_codes', { type: TEXT, allowNull: true, defaultValue: null });
  },

  async down(queryInterface) {
    const t = 'users';
    for (const c of ['totp_secret', 'two_fa_enabled', 'backup_codes']) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn(t, c);
    }
  },
};
