'use strict';

/**
 * Mirrors ngo-backend's real connection-liveness signal onto
 * payment_details.connection_alive so routingEngine.pickEligibleAccount()
 * can consult it locally.
 *
 * Why a background sync and not a call inside routing: the routing decision
 * sits directly in the checkout path. A cross-service HTTP call there would
 * add latency to every order and turn "ngo-backend is briefly unreachable"
 * into "no customer can check out". Mirroring on the same ~15s cadence the
 * trader panel already polls at keeps the flag fresh enough — the device
 * heartbeat window it is derived from is itself 15s.
 *
 * Mapping (both directions verified against real data):
 *   APK  - payment_details.ngo_device_id -> Device._id
 *   Web  - payment_details.upi_id        -> Account.upiId
 *          upi_id is the reliable key here: it carries a UNIQUE index and
 *          cross-database uniqueness is enforced by ngo-backend's
 *          upiUniqueness.js, whereas Account.gatewayPaymentDetailId has been
 *          observed pointing at a deleted payment_details row. That id is
 *          still accepted as a secondary match when the UPI doesn't resolve.
 *
 * A row with neither link resolves to NULL, never false — see the migration.
 * Nothing here decides liveness; it only copies decisions already made by
 * apk.js's isOnline() and SessionStore.isSessionAlive().
 */

const axios = require('axios');

const db = require('../models');
const logger = require('../utils/logger');
const { internalAuthHeaders } = require('../services/ngoServiceAuth');

const SYNC_INTERVAL_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Resolve every payment_detail to true / false / null.
 * Exported separately from the DB write so it can be unit-checked directly.
 */
function resolveLiveness(details, snapshot) {
  const deviceAlive = new Map((snapshot.devices || []).map((d) => [String(d.deviceId), !!d.alive]));

  const aliveByUpi = new Map();
  const aliveByDetailId = new Map();
  for (const a of snapshot.webAccounts || []) {
    if (a.upiId) aliveByUpi.set(String(a.upiId).trim().toLowerCase(), !!a.alive);
    if (a.gatewayPaymentDetailId != null) aliveByDetailId.set(Number(a.gatewayPaymentDetailId), !!a.alive);
  }

  return details.map((d) => {
    // A linked device that no longer exists in Mongo is not "unknown" — it is
    // definitively not alive, so it must resolve to false rather than null.
    if (d.ngo_device_id) {
      return { id: d.id, alive: deviceAlive.get(String(d.ngo_device_id)) === true };
    }
    const upi = d.upi_id ? String(d.upi_id).trim().toLowerCase() : null;
    if (upi && aliveByUpi.has(upi)) return { id: d.id, alive: aliveByUpi.get(upi) };
    if (aliveByDetailId.has(Number(d.id))) return { id: d.id, alive: aliveByDetailId.get(Number(d.id)) };
    return { id: d.id, alive: null }; // nothing linked — routing unaffected
  });
}

async function syncOnce() {
  const base = process.env.NGO_BACKEND_URL || 'http://localhost:3000';
  let snapshot;
  try {
    const res = await axios.get(`${base}/api/internal/connection-liveness`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: internalAuthHeaders(),
    });
    if (!res.data || res.data.success !== true) throw new Error('unexpected response shape');
    snapshot = res.data;
  } catch (err) {
    // Deliberately leave the previous values in place. Blanking them to false
    // on a transient network blip would take every linked account out of
    // routing; blanking to null would silently re-enable genuinely dead ones.
    logger.warn(`connectionLiveness: sync skipped — ${err.message}`);
    return { ok: false, updated: 0 };
  }

  const details = await db.PaymentDetail.findAll({
    attributes: ['id', 'upi_id', 'ngo_device_id', 'connection_alive'],
  });

  const resolved = resolveLiveness(details.map((d) => d.get({ plain: true })), snapshot);
  const now = new Date();
  let updated = 0;

  for (const r of resolved) {
    const current = details.find((d) => d.id === r.id);
    // Always refresh checked_at, but only log/count a real state transition.
    const changed = (current.connection_alive === null ? null : !!current.connection_alive) !== r.alive;
    // eslint-disable-next-line no-await-in-loop
    await db.PaymentDetail.update(
      { connection_alive: r.alive, connection_checked_at: now },
      { where: { id: r.id } }
    );
    if (changed) {
      updated += 1;
      logger.info(`connectionLiveness: payment_detail ${r.id} connection_alive ${current.connection_alive} -> ${r.alive}`);
    }
  }

  return { ok: true, updated, total: resolved.length };
}

/** Start the in-process poll. Mirrors the order-expiry sweep's pattern in
 *  server.js so it works with or without Redis. */
function startConnectionLivenessSync() {
  const tick = () => {
    syncOnce().catch((err) => logger.warn(`connectionLiveness: ${err.message}`));
  };
  tick();
  const timer = setInterval(tick, SYNC_INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info(`connectionLiveness: syncing every ${SYNC_INTERVAL_MS / 1000}s`);
  return timer;
}

module.exports = { startConnectionLivenessSync, syncOnce, resolveLiveness, SYNC_INTERVAL_MS };
