/**
 * app.js
 * Express application factory. Wires global middleware and mounts the API.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const { isDbConnected } = require('./loaders/database');
const { isRedisAvailable } = require('./loaders/redis');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const traderRoutes = require('./routes/traderRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const adminRoutes = require('./routes/adminRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));

// Health checks
app.get('/health', (req, res) => res.json({ status: 'ok', service: config.appName }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mysql: isDbConnected() ? 'connected' : 'disconnected',
    redis: isRedisAvailable() ? 'connected' : 'disconnected',
    timestamp: new Date(),
  });
});

// ---- REST API (mounted under /api by default) ----
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/trader', traderRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payout-requests', payoutRoutes);

app.get('/api', (req, res) => res.json({ success: true, data: { name: 'P2P UPI Gateway API' } }));

// 404 + error handler (must be last)
app.use(errorHandler.notFound);
app.use(errorHandler);

module.exports = app;
