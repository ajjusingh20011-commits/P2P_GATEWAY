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
const accountScore = require('../services/accountScore');
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
    attributes: ['id', 'upi_id', 'ngo_device_id', 'connection_alive', 'is_active', 'is_active_detail'],
  });

  const resolved = resolveLiveness(details.map((d) => d.get({ plain: true })), snapshot);
  const now = new Date();
  let updated = 0;

  for (const r of resolved) {
    const current = details.find((d) => d.id === r.id);
    // Always refresh checked_at, but only log/count a real state transition.
    const changed = (current.connection_alive === null ? null : !!current.connection_alive) !== r.alive;

    // Re-arm is_active when the device is genuinely live again but the linkage
    // flag was left off. is_active is set false the instant a device goes
    // offline (the trader panel's auto-unlink), but nothing turned it back on
    // when the device recovered — so an account whose switch is still ON
    // (is_active_detail true) stayed dark forever after a single dropped
    // heartbeat, because routing requires is_active AND connection_alive.
    // connection_alive === true is proof the device is responding right now, so
    // re-arming here is the same evidence a manual "Link" click checks — no
    // separate readiness gate is skipped. Only ever turns is_active ON, and
    // only while the trader's own switch is on; it never links an account the
    // trader parked (is_active_detail false).
    const rearm = r.alive === true
      && current.is_active_detail === true
      && current.is_active === false;

    // eslint-disable-next-line no-await-in-loop
    await db.PaymentDetail.update(
      rearm
        ? { connection_alive: r.alive, connection_checked_at: now, is_active: true }
        : { connection_alive: r.alive, connection_checked_at: now },
      { where: { id: r.id } }
    );
    if (rearm) {
      logger.info(`connectionLiveness: payment_detail ${r.id} re-armed is_active — device live again while switch on`);
    }
    if (changed) {
      updated += 1;
      logger.info(`connectionLiveness: payment_detail ${r.id} connection_alive ${current.connection_alive} -> ${r.alive}`);
      // Alive -> dead is a real outage on an account that was serving orders.
      // Anything still open on it could not be confirmed, which is a service
      // failure to the trader's own customer, so it is scored against the
      // account's live session rather than quietly ignored. Only this exact
      // transition counts: an account that was already dead, or that was never
      // linked, has no session outage to attribute.
      if (current.connection_alive === true && r.alive === false) {
        // eslint-disable-next-line no-await-in-loop
        await accountScore.markOpenOrdersFailed(r.id);
      }
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
