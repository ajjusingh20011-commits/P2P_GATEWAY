'use strict';

/**
 * webhook_logs — the durable delivery queue AND audit trail for merchant
 * webhooks.
 *
 * Before this table, delivery lived entirely in BullMQ: `sendWebhook` enqueued a
 * job with { attempts: 3, backoff: exponential } and, if the queue was
 * unusable (no Redis, or Redis older than BullMQ's 5.0.0 requirement), silently
 * fell back to a single direct fetch with NO retry at all. The retry guarantee
 * we would have to put in a partner integration document therefore depended on
 * the Redis version of whichever host happened to be running — and nothing
 * anywhere recorded whether a webhook was actually delivered.
 *
 * This row IS the queue. `sendWebhook` writes it first, then tries to deliver;
 * every outcome is written back here, and a sweep (jobs/webhookRetrySweep.js)
 * picks up anything still `pending` whose `next_attempt_at` has passed. Retries
 * are therefore guaranteed by MySQL, which the API cannot run without, rather
 * than by an optional dependency.
 *
 * `payload` stores the EXACT body bytes that were signed and sent, so a
 * merchant disputing a signature can be answered from this table alone.
 */

const TABLE = 'webhook_logs';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, CHAR, STRING, TEXT, DATE, ENUM, fn } = Sequelize;

    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes(TABLE);
    if (exists) return;

    await queryInterface.createTable(TABLE, {
      id: { type: INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      merchant_id: { type: INTEGER.UNSIGNED, allowNull: false },
      // Nullable: not every event is order-scoped, and the order may be purged.
      order_id: { type: INTEGER.UNSIGNED, allowNull: true },
      order_uuid: { type: CHAR(36), allowNull: true },
      event: { type: STRING(50), allowNull: false },
      target_url: { type: STRING(512), allowNull: false },
      // The exact JSON string that was signed and POSTed — not a re-serialised
      // copy of the object, so the stored signature always verifies against it.
      payload: { type: TEXT, allowNull: false },
      signature: { type: STRING(64), allowNull: false },
      status: {
        type: ENUM('pending', 'delivering', 'delivered', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: { type: INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      max_attempts: { type: INTEGER.UNSIGNED, allowNull: false, defaultValue: 5 },
      last_status_code: { type: INTEGER, allowNull: true },
      last_error: { type: STRING(500), allowNull: true },
      next_attempt_at: { type: DATE, allowNull: true },
      delivered_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
      updated_at: { type: DATE, allowNull: false, defaultValue: fn('NOW') },
    });

    // The sweep's only query: due, still-retryable rows.
    await queryInterface.addIndex(TABLE, ['status', 'next_attempt_at'], {
      name: 'webhook_logs_status_next_attempt_at',
    });
    // Merchant-facing audit ("show me my deliveries").
    await queryInterface.addIndex(TABLE, ['merchant_id', 'created_at'], {
      name: 'webhook_logs_merchant_id_created_at',
    });
    await queryInterface.addIndex(TABLE, ['order_id'], { name: 'webhook_logs_order_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
