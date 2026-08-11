#!/usr/bin/env node
/**
 * ⚠️  TEMPORARY QA SCRIPT — NOT PERMANENT INFRA. ⚠️
 *
 * Keeps a real trader marked online (routingEngine.js requires is_online:true
 * to route a new order to them — see backend/src/services/routingEngine.js)
 * by repeatedly sending the exact real heartbeat a live Trader-panel session
 * sends every 30s: PUT /api/trader/heartbeat (backend/src/controllers/
 * traderController.js). Nothing is faked or simulated — this is the same
 * request the real dashboard makes; it just runs headless from a terminal so
 * a QA test can rely on a trader staying online without a browser tab open.
 *
 * heartbeatCheck.js marks a trader offline once their last heartbeat is
 * older than config.platform.heartbeatTimeoutMs (default 2 min) — this script
 * pings every 30s, comfortably inside that window.
 *
 * Usage:
 *   node tools/qa/keep-trader-online.js [email] [password] [apiBase]
 *   (defaults: trader2@p2p.com / Trader@123456 / http://localhost:4000)
 *
 * Stop with Ctrl+C. Does not daemonize, does not write a pidfile, does not
 * survive terminal close — kill it when your test session is done.
 */

const email = process.argv[2] || 'trader2@p2p.com';
const password = process.argv[3] || 'Trader@123456';
const apiBase = (process.argv[4] || 'http://localhost:4000').replace(/\/$/, '');
const INTERVAL_MS = 30 * 1000;

let stopped = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function login() {
  const res = await fetch(apiBase + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok || !data?.data?.accessToken) {
    throw new Error('Login failed: ' + JSON.stringify(data));
  }
  return data.data.accessToken;
}

async function heartbeat(token) {
  const res = await fetch(apiBase + '/api/trader/heartbeat', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  log(`⚠️  TEMPORARY QA SCRIPT — logging in as ${email} against ${apiBase}`);
  let token = await login();
  log('Logged in. Sending real PUT /api/trader/heartbeat every 30s. Ctrl+C to stop.');

  while (!stopped) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await heartbeat(token);
      if (r.ok) {
        log(`heartbeat OK — ${JSON.stringify(r.data)}`);
      } else if (r.status === 401) {
        log('access token expired — logging in again');
        // eslint-disable-next-line no-await-in-loop
        token = await login();
      } else {
        log(`heartbeat FAILED — HTTP ${r.status} ${JSON.stringify(r.data)}`);
      }
    } catch (err) {
      log(`heartbeat request error: ${err.message}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  log('Stopped.');
}

process.on('SIGINT', () => {
  stopped = true;
  log('Ctrl+C received, stopping after current cycle...');
  // Force-exit in case we're mid-sleep — this script has no cleanup to do.
  process.exit(0);
});

main().catch((err) => {
  log('FATAL: ' + err.message);
  process.exit(1);
});
