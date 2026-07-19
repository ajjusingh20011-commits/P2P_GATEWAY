'use strict';

/**
 * Merchant webhook delivery.
 *
 *   sendWebhook(merchantId, event, data)
 *     - builds a signed payload and enqueues it on the `webhooks` queue.
 *     - the queue is configured with 3 attempts + exponential backoff, which
 *       gives us the "retry 3 times" behaviour (see jobs/webhookRetry.js).
 *
 *   deliverWebhook(job)  (called by the worker)
 *     - POSTs to the merchant URL; throws on non-2xx so BullMQ retries.
 *
 * The signature is HMAC-SHA256(rawBody, merchant.api_secret), sent as the
 * `X-Signature` header so merchants can verify authenticity.
 */

const crypto = require('crypto');

const db = require('../models');
const logger = require('../utils/logger');
const { isQueueUsable } = require('../loaders/redis');

function sign(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Build the payload + signature (also used by callers that log the attempt). */
function buildEnvelope(merchant, event, data) {
  const payload = {
    event,
    ...data,
    timestamp: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(payload);
  const signature = sign(merchant.api_secret, rawBody);
  return { payload, rawBody, signature };
}

/**
 * Enqueue a webhook for delivery. Returns immediately; delivery + retries are
 * handled by the worker. No-ops (logs) if the merchant has no webhook_url.
 */
async function sendWebhook(merchantId, event, data) {
  const merchant = await db.Merchant.scope('withSecret').findByPk(merchantId);
  if (!merchant) {
    logger.warn(`sendWebhook: merchant ${merchantId} not found`);
    return;
  }
  if (!merchant.webhook_url) {
    logger.info(`sendWebhook: merchant ${merchantId} has no webhook_url, skipping ${event}`);
    return;
  }

  const { payload, signature } = buildEnvelope(merchant, event, data);
  const jobData = { url: merchant.webhook_url, signature, payload };

  // With a working queue: enqueue for reliable delivery + retries (3 attempts).
  // Otherwise (no Redis, or Redis too old for BullMQ): deliver directly.
  let enqueued = false;
  if (isQueueUsable()) {
    try {
      const { queues } = require('../jobs');
      await queues.webhooks.add('deliver', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      });
      enqueued = true;
    } catch (err) {
      logger.warn(`Webhook enqueue failed (${err.message}) — delivering directly.`);
    }
  }

  if (!enqueued) {
    try {
      await deliverWebhook({ data: jobData });
    } catch (err) {
      logger.warn(`Direct webhook delivery failed (no retry): ${err.message}`);
    }
  }
}

/** Worker processor: perform the actual HTTP POST. Throws to trigger retry. */
async function deliverWebhook(job) {
  const { url, signature, payload } = job.data;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook ${payload.event} -> ${url} responded ${res.status}`);
  }
  logger.info(`Webhook delivered: ${payload.event} -> ${url}`);
  return { status: res.status };
}

module.exports = { sendWebhook, deliverWebhook, buildEnvelope, sign };
