require('dotenv').config({
  path: process.env.NODE_ENV === 'production'
    ? '.env'
    : '.env.local'
});

const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const connectDB = require('./src/config/database');
const errorHandler = require('./src/middleware/errorHandler');

// Route modules
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const ngoRoutes = require('./src/routes/ngo');
const merchantRoutes = require('./src/routes/merchant');
const apkRoutes = require('./src/routes/apk');
const webhookRoutes = require('./src/routes/webhook');
const checkoutRoutes = require('./src/routes/checkout');
const publicRoutes = require('./src/routes/public');
const internalRoutes = require('./src/routes/internal');

const app = express();

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
// Real allow-list, read from CORS_ORIGINS (comma-separated) — same pattern
// backend/src/config/index.js already uses (pass the array straight through
// as `origin`, not a callback that throws — the `cors` package just omits
// the Access-Control-Allow-Origin header for a non-matching origin, no 500).
// Falls back to the known local trader-panel dev origin when unset so local
// dev keeps working with no env changes. Requests with no Origin header (the
// APK's HttpURLConnection, curl, server-to-server calls) are never subject
// to CORS at all — the `cors` package only checks browser-sent Origin
// headers — so tightening this has no effect on the APK.
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// HTTP server + Socket.io
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
});
app.locals.io = io;

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Real trader auth — a short-lived token minted by backend/ (see
  // GET /api/trader/ngo-socket-token). Verified here at handshake time so
  // the room a client lands in is never a value the client itself supplies
  // (unlike the legacy 'join' event below, which trusts whatever room name
  // it's given — kept only for other, non-trader frontends already relying
  // on it; not used by the trader panel's Offers/Smartphones/Notifications
  // pages once they present a serviceToken instead).
  const serviceToken = socket.handshake.auth?.serviceToken;
  if (serviceToken) {
    try {
      const decoded = jwt.verify(serviceToken, process.env.SERVICE_AUTH_SECRET, {
        issuer: 'p2p-backend',
        audience: 'ngo-backend',
      });
      if (decoded.type === 'service' && Number.isFinite(decoded.trader_id)) {
        socket.join(`trader:${decoded.trader_id}`);
      }
    } catch (err) {
      console.warn(`Socket ${socket.id} presented an invalid service token: ${err.message}`);
    }
  }

  socket.on('join', (room) => {
    if (room) {
      socket.join(String(room));
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Make io available to routes/services via req.app.get('io').
app.set('io', io);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'OK', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
// Public, unauthenticated NGO lookup for the donor checkout page. Must be
// registered before `app.use('/api/ngo', ngoRoutes)` below — that router
// applies verifyToken/requireRole to every path via `router.use(...)`, which
// would otherwise intercept this request first.
app.get('/api/ngo/public/:ngoId', checkoutRoutes.publicNgoHandler);
app.use('/api/ngo', ngoRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/apk', apkRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/internal', internalRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler (must be last)
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();

// ---------------------------------------------------------------------------
// Graceful shutdown — closes the HTTP server and Mongo connection so the port
// and DB connections are actually released (nodemon sends SIGUSR2 on restart,
// but SIGINT/SIGTERM cover Ctrl+C and process managers/orchestrators too).
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');

function shutdown(signal) {
  console.log(`${signal} received: closing server gracefully`);
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('HTTP server and MongoDB connection closed');
      process.exit(0);
    });
  });

  // Force-exit if close() hangs (e.g. open keep-alive sockets).
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, io };
