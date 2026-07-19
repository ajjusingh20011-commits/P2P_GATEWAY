'use strict';

/**
 * webhookRetry — the webhook delivery processor.
 *
 * Delivery + retry is driven by the `webhooks` BullMQ queue: jobs are added
 * with { attempts: 3, backoff: exponential } (see services/webhookService.js),
 * so BullMQ performs up to 3 attempts with exponential backoff automatically.
 * This module just exposes the processor used by the worker.
 */

const { deliverWebhook } = require('../services/webhookService');

module.exports = { process: deliverWebhook };
