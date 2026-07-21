require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
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

const app = express();

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: function(origin, callback) {
      // Allow all origins for now
      callback(null, true);
    },
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
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
app.locals.io = io;

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

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

module.exports = { app, server, io };
