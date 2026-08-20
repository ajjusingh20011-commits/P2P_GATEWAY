'use strict';

/**
 * Raise the live payout pickup->transfer window to 40 minutes.
 *
 * payout_expiry_minutes is the ONE key payoutService.expiryMinutes() reads
 * (there is no separate payout_processing_window_minutes). The code default is
 * already 40 (settingsService.DEFAULTS + payoutService.DEFAULT_EXPIRY_MINUTES),
 * but settingsService.ensureDefaults() only findOrCreates — it never updates an
 * existing row — so a settings row seeded at 15 by an earlier build (and by the
 * admin Settings UI's old hardcoded '15' default) was stuck at 15, overriding
 * the code default. That too-short window expired genuine, on-time payments.
 *
 * This reconciles the stored value to 40. Idempotent (ON DUPLICATE KEY UPDATE);
 * `key` is UNIQUE. Restart the API after migrating so the 60s settings cache
 * drops the stale value. Still fully admin-adjustable afterwards via the
 * Settings UI — this only fixes the wrong starting value.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "INSERT INTO settings (`key`, `value`, `created_at`, `updated_at`) "
      + "VALUES ('payout_expiry_minutes', '40', NOW(), NOW()) "
      + "ON DUPLICATE KEY UPDATE `value` = '40', `updated_at` = NOW()"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "UPDATE settings SET `value` = '15', `updated_at` = NOW() WHERE `key` = 'payout_expiry_minutes'"
    );
  },
};
