'use strict';

/**
 * heartbeatCheck job — runs every 60s.
 * Marks traders (and their devices) offline when their last heartbeat is older
 * than the configured timeout (default 2 minutes).
 */

const { Op } = require('sequelize');

const config = require('../config');
const db = require('../models');
const logger = require('../utils/logger');
const { emitToAdmin } = require('../websocket');

async function checkHeartbeats() {
  const cutoff = new Date(Date.now() - config.platform.heartbeatTimeoutMs);

  // Find traders about to go offline so we can emit per-trader events.
  const stale = await db.Trader.findAll({
    where: { is_online: true, last_heartbeat: { [Op.lt]: cutoff } },
    attributes: ['id'],
  });

  if (stale.length) {
    await db.Trader.update(
      { is_online: false },
      { where: { is_online: true, last_heartbeat: { [Op.lt]: cutoff } } }
    );
    stale.forEach((t) => emitToAdmin('trader:offline', { trader_id: t.id }));
  }

  // Devices too.
  await db.Smartphone.update(
    { is_online: false },
    { where: { is_online: true, last_ping: { [Op.lt]: cutoff } } }
  );

  if (stale.length) logger.info(`heartbeatCheck: marked ${stale.length} trader(s) offline`);
  return { markedOffline: stale.length };
}

module.exports = { checkHeartbeats };
