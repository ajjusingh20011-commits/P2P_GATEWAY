'use strict';

/**
 * Order System v2.
 *
 * - Adds gateway_order_id, merchant_order_id, deposit_type, callback/redirect
 *   urls, confirmation fields, and review/reject audit columns to `orders`.
 * - Remaps the order `status` ENUM to the v2 lifecycle, migrating existing rows.
 * - Adds `deposit_types` (JSON) to `traders`.
 *
 * Status remap (old -> new):
 *   new       -> pending
 *   assigned  -> pending
 *   paid      -> claimed_paid
 *   confirmed -> success
 *   expired   -> failed
 *   cancelled -> failed
 *   disputed  -> disputed
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const table = await queryInterface.describeTable('orders');
    const addIfMissing = async (name, spec) => {
      if (!table[name]) await queryInterface.addColumn('orders', name, spec);
    };

    // ---- new order columns ----
    await addIfMissing('gateway_order_id', { type: DataTypes.STRING(50), allowNull: true });
    await addIfMissing('merchant_order_id', { type: DataTypes.STRING(100), allowNull: true });
    await addIfMissing('deposit_type', { type: DataTypes.ENUM('FTD', 'STD'), allowNull: false, defaultValue: 'STD' });
    await addIfMissing('callback_url', { type: DataTypes.STRING(500), allowNull: true });
    await addIfMissing('redirect_url', { type: DataTypes.STRING(500), allowNull: true });
    await addIfMissing('confirmation_type', { type: DataTypes.ENUM('utr', 'screenshot', 'no_proof'), allowNull: true });
    await addIfMissing('screenshot_path', { type: DataTypes.STRING(500), allowNull: true });
    await addIfMissing('claimed_paid_at', { type: DataTypes.DATE, allowNull: true });
    await addIfMissing('reviewed_at', { type: DataTypes.DATE, allowNull: true });
    await addIfMissing('reviewed_by', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });
    await addIfMissing('rejected_at', { type: DataTypes.DATE, allowNull: true });
    await addIfMissing('rejection_reason', { type: DataTypes.STRING(500), allowNull: true });

    // customer_ref: backfill NULLs, then enforce NOT NULL (v2 requires it).
    await queryInterface.sequelize.query(
      "UPDATE `orders` SET `customer_ref` = CONCAT('legacy_', id) WHERE `customer_ref` IS NULL OR `customer_ref` = ''"
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE `orders` MODIFY COLUMN `customer_ref` VARCHAR(100) NOT NULL'
    );

    // ---- status ENUM remap (widen -> migrate -> narrow) ----
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('new','assigned','paid','confirmed','expired','disputed','cancelled'," +
      "'pending','checkout_open','claimed_paid','under_review','success','failed','rejected') " +
      "NOT NULL DEFAULT 'pending'"
    );
    await queryInterface.sequelize.query(
      "UPDATE `orders` SET `status` = CASE `status` " +
      "WHEN 'new' THEN 'pending' " +
      "WHEN 'assigned' THEN 'pending' " +
      "WHEN 'paid' THEN 'claimed_paid' " +
      "WHEN 'confirmed' THEN 'success' " +
      "WHEN 'expired' THEN 'failed' " +
      "WHEN 'cancelled' THEN 'failed' " +
      "WHEN 'disputed' THEN 'disputed' " +
      "ELSE `status` END"
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('pending','checkout_open','claimed_paid','under_review','success','failed','rejected','disputed') " +
      "NOT NULL DEFAULT 'pending'"
    );

    // ---- indexes ----
    const idx = async (fields, opts) => {
      try { await queryInterface.addIndex('orders', fields, opts); } catch (e) { /* already exists */ }
    };
    await idx(['gateway_order_id'], { name: 'uq_orders_gateway_order_id', unique: true });
    await idx(['merchant_id', 'merchant_order_id'], { name: 'uq_orders_merchant_order_id', unique: true });
    await idx(['reviewed_by'], { name: 'idx_orders_reviewed_by' });
    await idx(['deposit_type'], { name: 'idx_orders_deposit_type' });

    // ---- traders.deposit_types ----
    const tTable = await queryInterface.describeTable('traders');
    if (!tTable.deposit_types) {
      await queryInterface.addColumn('traders', 'deposit_types', { type: DataTypes.JSON, allowNull: true });
    }
    await queryInterface.sequelize.query(
      'UPDATE `traders` SET `deposit_types` = \'["FTD","STD"]\' WHERE `deposit_types` IS NULL'
    );
  },

  async down(queryInterface, Sequelize) {
    // Best-effort reverse: narrow status back, drop new columns.
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('new','assigned','paid','confirmed','expired','disputed','cancelled'," +
      "'pending','checkout_open','claimed_paid','under_review','success','failed','rejected') NOT NULL DEFAULT 'pending'"
    );
    await queryInterface.sequelize.query(
      "UPDATE `orders` SET `status` = CASE `status` " +
      "WHEN 'pending' THEN 'new' WHEN 'checkout_open' THEN 'assigned' WHEN 'claimed_paid' THEN 'paid' " +
      "WHEN 'under_review' THEN 'paid' WHEN 'success' THEN 'confirmed' WHEN 'failed' THEN 'expired' " +
      "WHEN 'rejected' THEN 'cancelled' WHEN 'disputed' THEN 'disputed' ELSE `status` END"
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE `orders` MODIFY COLUMN `status` " +
      "ENUM('new','assigned','paid','confirmed','expired','disputed','cancelled') NOT NULL DEFAULT 'new'"
    );
    for (const col of ['gateway_order_id', 'merchant_order_id', 'deposit_type', 'callback_url', 'redirect_url',
      'confirmation_type', 'screenshot_path', 'claimed_paid_at', 'reviewed_at', 'reviewed_by', 'rejected_at', 'rejection_reason']) {
      // eslint-disable-next-line no-await-in-loop
      try { await queryInterface.removeColumn('orders', col); } catch (e) { /* noop */ }
    }
    try { await queryInterface.removeColumn('traders', 'deposit_types'); } catch (e) { /* noop */ }
  },
};
