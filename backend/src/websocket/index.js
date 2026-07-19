'use strict';

/**
 * Socket.IO server + real-time event bus.
 *
 * Rooms:
 *   trader:{trader_id}     - a single trader's panel/APK sessions
 *   merchant:{merchant_id} - a merchant's dashboard sessions
 *   admin                  - all admin console sessions
 *
 * Sockets authenticate with a JWT passed as `auth.token` in the handshake.
 * The rest of the app emits via the helpers exported here (emitToTrader, …),
 * so services never import socket.io directly.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const config = require('../config');
const logger = require('../utils/logger');
const db = require('../models');

let io = null;

const ROOM = {
  trader: (id) => `trader:${id}`,
  merchant: (id) => `merchant:${id}`,
  admin: () => 'admin',
  order: (uuid) => `order:${uuid}`,
};

// Authenticate the socket if a token is present. Token-less connections are
// allowed as ANONYMOUS (used by the public checkout page) — they can only
// subscribe to a specific order room, never the role rooms.
async function authenticate(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      socket.user = null;
      return next();
    }
    const decoded = jwt.verify(token, config.jwt.accessSecret);
    socket.user = { id: decoded.sub, role: decoded.role };

    if (decoded.role === 'trader') {
      const trader = await db.Trader.findOne({ where: { user_id: decoded.sub } });
      if (trader) socket.profileId = trader.id;
    } else if (decoded.role === 'merchant') {
      const merchant = await db.Merchant.findOne({ where: { user_id: decoded.sub } });
      if (merchant) socket.profileId = merchant.id;
    }
    return next();
  } catch (err) {
    // Invalid token → downgrade to anonymous rather than refusing the socket.
    socket.user = null;
    return next();
  }
}

function initWebsocket(httpServer) {
  io = new Server(httpServer, {
    path: config.ws.path,
    cors: { origin: config.ws.corsOrigins, credentials: true },
  });

  io.use(authenticate);

  io.on('connection', (socket) => {
    const { role, id } = socket.user || {};
    logger.info(`WS connected: ${socket.id} (${role} user ${id})`);

    if (role === 'admin') socket.join(ROOM.admin());
    if (role === 'trader' && socket.profileId) {
      socket.join(ROOM.trader(socket.profileId));
      emitToAdmin('trader:online', { trader_id: socket.profileId });
    }
    if (role === 'merchant' && socket.profileId) socket.join(ROOM.merchant(socket.profileId));

    // Anonymous (or any) sockets can follow a single order — used by checkout.
    socket.on('subscribe:order', (uuid) => {
      if (typeof uuid === 'string' && uuid.length <= 64) socket.join(ROOM.order(uuid));
    });

    socket.on('disconnect', () => {
      if (role === 'trader' && socket.profileId) {
        emitToAdmin('trader:offline', { trader_id: socket.profileId });
      }
      logger.info(`WS disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIo() {
  if (!io) throw new Error('WebSocket not initialized');
  return io;
}

/* ------------------------------ emit helpers ------------------------------ */
// These are safe to call before init (no-op if io is null) so services/jobs
// can emit without worrying about boot order.

function emit(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

function emitToTrader(traderId, event, payload) {
  emit(ROOM.trader(traderId), event, payload);
}
function emitToMerchant(merchantId, event, payload) {
  emit(ROOM.merchant(merchantId), event, payload);
}
function emitToAdmin(event, payload) {
  emit(ROOM.admin(), event, payload);
}
function emitToOrder(uuid, event, payload) {
  emit(ROOM.order(uuid), event, payload);
}
function broadcast(event, payload) {
  if (io) io.emit(event, payload);
}

module.exports = {
  initWebsocket,
  getIo,
  emitToTrader,
  emitToMerchant,
  emitToAdmin,
  emitToOrder,
  broadcast,
  ROOM,
};
