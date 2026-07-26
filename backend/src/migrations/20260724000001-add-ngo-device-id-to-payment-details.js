'use strict';

/**
 * Bridges the trader-native `payment_details` row to a real ngo-backend
 * Device (Mongo, paired via the Smartphones page's APK flow) instead of the
 * legacy, dead MySQL `Smartphone` model that `smartphone_id` points at.
 * Stores the Device's Mongo `_id` as a string (that's the id the
 * GET /api/apk/devices/:ngoId list already keys by), not the Android
 * `deviceId` — so it matches exactly what the trader panel's device picker
 * and the Smartphones page both already consume.
 */

const COLUMN = 'ngo_device_id';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('payment_details');
    if (!table[COLUMN]) {
      await queryInterface.addColumn('payment_details', COLUMN, {
        type: Sequelize.STRING(191),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('payment_details');
    if (table[COLUMN]) {
      await queryInterface.removeColumn('payment_details', COLUMN);
    }
  },
};
