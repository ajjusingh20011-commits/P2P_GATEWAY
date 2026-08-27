'use strict';

/**
 * Merchant webhook delivery — durable, Redis-independent.
 *
 *   sendWebhook(merchantId, event, data, opts)
 *     - resolves the destination URL, builds and signs the body, writes a
 *       `webhook_logs` row (that row IS the queue), then attempts delivery
 *       immediately. Never throws into the caller.
 *
 *   attemptDelivery(log)   - one claimed attempt; records the outcome.
 *   processDueWebhooks()   - the sweep: retries everything now due.
 *
 * WHY THIS IS NOT BULLMQ ANY MORE
 * Delivery used to be enqueued on the `webhooks` BullMQ queue with
 * { attempts: 3, backoff: exponential }. That gave a real retry guarantee only
 * when Redis was present AND new enough for BullMQ (>= 5.0.0); otherwise
 * sendWebhook silently fell through to a single direct fetch with no retry and
 * no record. The retry behaviour we can promise a partner therefore depended on
 * the Redis version of whichever host was running. It now depends on MySQL,
 * which the API cannot serve a request without, so the guarantee holds
 * everywhere. jobs/webhookRetrySweep.js drives the retries in-process, the same
 * pattern the order-expiry / stale-claim / payout-expiry sweeps already use.
 *
 * SIGNATURE
 * X-Signature = HMAC-SHA256(exact request body, merchant.api_secret), hex. The
 * body that was signed is stored verbatim in webhook_logs.payload and re-sent
 * byte-for-byte on every retry, so a signature can always be re-verified from
 * the stored row (the previous code signed one serialisation and then
 * re-serialised the object at send time).
 */

const crypto = require('crypto');

const db = require('../models');
const logger = require('../utils/logger');

// Attempt 1 is immediate. These are the delays BEFORE attempts 2..5, so a
// merchant endpoint that is down for ~40 minutes still gets the event.
const RETRY_DELAYS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 5
const REQUEST_TIMEOUT_MS = 10 * 1000;
// One sweep tick must not stall behind a large backlog of dead endpoints.
const SWEEP_BATCH = 25;

function sign(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Build the payload + the exact signed body. Exported for tests/tooling. */
function buildEnvelope(merchant, event, data) {
  const payload = { event, ...data, timestamp: new Date().toISOString() };
  const rawBody = JSON.stringify(payload);
  return { payload, rawBody, signature: sign(merchant.api_secret, rawBody) };
}

function nextAttemptAt(attemptsMade) {
  const delay = RETRY_DELAYS_MS[attemptsMade - 1];
  return delay == null ? null : new Date(Date.now() + delay);
}

/**
 * Where this event actually goes.
 *
 * Per-order `callback_url` wins over the merchant's registered `webhook_url`.
 * The column was written on every order by orderService and then read by
 * nothing at all — a merchant could send a callback_url, see it accepted, and
 * never receive anything at it. Now it is honoured, with the merchant-level URL
 * as the fallback, which is what the field always implied.
 */
async function resolveTargetUrl(merchant, order) {
  const perOrder = order && typeof order.callback_url === 'string' ? order.callback_url.trim() : '';
  if (perOrder && /^https?:\/\//i.test(perOrder)) return perOrder;
  const merchantUrl = merchant.webhook_url ? String(merchant.webhook_url).trim() : '';
  return merchantUrl && /^https?:\/\//i.test(merchantUrl) ? merchantUrl : null;
}

/**
 * Queue a webhook and try to deliver it now.
 *
 * @param {number} merchantId
 * @param {string} event
 * @param {object} data     - event body (merged into the envelope)
 * @param {object} [opts]
 * @param {object} [opts.order] - the Order this event is about. Supplies the
 *   per-order callback_url and links the audit row to the order.
 */
async function sendWebhook(merchantId, event, data, opts = {}) {
  try {
    const merchant = await db.Merchant.scope('withSecret').findByPk(merchantId);
    if (!merchant) {
      logger.warn(`sendWebhook: merchant ${merchantId} not found`);
      return null;
    }

    // Resolve the order once, so a caller that only knows an id still gets the
    // per-order callback_url honoured.
    let order = opts.order || null;
    if (!order && (data.order_id || opts.orderId)) {
      order = await db.Order.findOne({
        where: data.order_id ? { uuid: data.order_id } : { id: opts.orderId },
      }).catch(() => null);
    }

    const targetUrl = await resolveTargetUrl(merchant, order);
    if (!targetUrl) {
      logger.info(`sendWebhook: merchant ${merchantId} has no callback_url or webhook_url, skipping ${event}`);
      return null;
    }

    const { rawBody, signature } = buildEnvelope(merchant, event, data);

    const log = await db.WebhookLog.create({
      merchant_id: merchant.id,
      order_id: order ? order.id : null,
      order_uuid: order ? order.uuid : (data.order_id || null),
      event,
      target_url: targetUrl,
      payload: rawBody,
      signature,
      status: 'pending',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      next_attempt_at: new Date(),
    });

    // Deliver inline so the common case is immediate; the sweep is the safety
    // net, not the primary path. Failure here is already recorded on the row.
    await attemptDelivery(log).catch((err) => {
      logger.warn(`sendWebhook: inline delivery error for log ${log.id}: ${err.message}`);
    });

    return log;
  } catch (err) {
    // A webhook must never break the business action that triggered it.
    logger.error(`sendWebhook failed for merchant ${merchantId} event ${event}: ${err.message}`);
    return null;
  }
}

/**
 * Claim a row for exactly one attempt.
 *
 * The conditional UPDATE is what makes the inline send and the sweep safe to
 * run concurrently: whoever flips `pending` -> `delivering` owns the attempt,
 * and the loser sees 0 affected rows and walks away. Without it a row due at
 * the same moment the sweep runs could be POSTed twice.
 */
async function claim(log) {
  const [affected] = await db.WebhookLog.update(
    { status: 'delivering', attempts: db.sequelize.literal('attempts + 1') },
    { where: { id: log.id, status: 'pending' } }
  );
  if (!affected) return null;
  return db.WebhookLog.findByPk(log.id);
}

/** POST the stored body. Returns the raw fetch Response. */
async function postWebhook(url, rawBody, signature) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      body: rawBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One delivery attempt for an already-persisted webhook.
 * Records success or schedules the next attempt; never throws for a transport
 * error (that is an expected outcome, recorded on the row).
 */
async function attemptDelivery(logRow) {
  const claimed = await claim(logRow);
  if (!claimed) return null; // someone else has it, or it is already terminal

  let statusCode = null;
  let errorText = null;

  try {
    const res = await postWebhook(claimed.target_url, claimed.payload, claimed.signature);
    statusCode = res.status;
    if (res.ok) {
      await claimed.update({
        status: 'delivered',
        delivered_at: new Date(),
        last_status_code: statusCode,
        last_error: null,
        next_attempt_at: null,
      });
      logger.info(`Webhook delivered: ${claimed.event} -> ${claimed.target_url} (attempt ${claimed.attempts})`);
      return claimed;
    }
    errorText = `HTTP ${res.status}`;
  } catch (err) {
    errorText = err.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : err.message;
  }

  const exhausted = claimed.attempts >= claimed.max_attempts;
  const nextAt = exhausted ? null : nextAttemptAt(claimed.attempts);

  await claimed.update({
    status: exhausted ? 'failed' : 'pending',
    last_status_code: statusCode,
    last_error: String(errorText).slice(0, 500),
    next_attempt_at: nextAt,
  });

  if (exhausted) {
    logger.error(
      `Webhook FAILED permanently: ${claimed.event} -> ${claimed.target_url} `
      + `after ${claimed.attempts} attempt(s): ${errorText}`
    );
  } else {
    logger.warn(
      `Webhook attempt ${claimed.attempts}/${claimed.max_attempts} failed: ${claimed.event} `
      + `-> ${claimed.target_url} (${errorText}); next attempt ${nextAt.toISOString()}`
    );
  }
  return claimed;
}

/**
 * The sweep body: retry every webhook whose next attempt is due.
 * Rows are processed one at a time — a batch of dead endpoints each burning the
 * request timeout should not be issued in parallel against the same host.
 */
async function processDueWebhooks() {
  const { Op } = require('sequelize');
  const due = await db.WebhookLog.findAll({
    where: {
      status: 'pending',
      next_attempt_at: { [Op.lte]: new Date() },
      attempts: { [Op.lt]: db.sequelize.col('max_attempts') },
    },
    order: [['next_attempt_at', 'ASC']],
    limit: SWEEP_BATCH,
  });

  let delivered = 0;
  for (const log of due) {
    // eslint-disable-next-line no-await-in-loop
    const res = await attemptDelivery(log).catch((err) => {
      logger.warn(`webhook sweep: attempt error on log ${log.id}: ${err.message}`);
      return null;
    });
    if (res && res.status === 'delivered') delivered += 1;
  }

  if (due.length) logger.info(`webhook sweep: retried ${due.length}, delivered ${delivered}`);
  return { retried: due.length, delivered };
}

/**
 * Back-compat shim for the BullMQ worker (jobs/worker.js still registers a
 * `webhooks` processor). Nothing enqueues onto that queue any more, so this
 * only runs for a job left over from before this change.
 */
async function deliverWebhook(job) {
  const { url, signature, payload } = job.data || {};
  if (!url) return { skipped: true };
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = await postWebhook(url, rawBody, signature);
  if (!res.ok) throw new Error(`Webhook -> ${url} responded ${res.status}`);
  return { status: res.status };
}

module.exports = {
  sendWebhook,
  attemptDelivery,
  processDueWebhooks,
  buildEnvelope,
  sign,
  resolveTargetUrl,
  deliverWebhook,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
};
