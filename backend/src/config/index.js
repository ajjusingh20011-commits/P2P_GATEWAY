/**
 * Central configuration loaded from environment variables.
 */

require('dotenv').config();

const toList = (v) => (v ? v.split(',').map((s) => s.trim()) : []);

// Frontend origins — used for CORS and building checkout URLs.
const frontend = {
  admin: process.env.FRONTEND_ADMIN_URL || 'http://localhost:5173',
  trader: process.env.FRONTEND_TRADER_URL || 'http://localhost:5174',
  merchant: process.env.FRONTEND_MERCHANT_URL || 'http://localhost:5175',
  checkout: process.env.FRONTEND_CHECKOUT_URL || 'http://localhost:5176',
};

// Default CORS/WS origins to the known frontends when not explicitly set.
const defaultOrigins = Object.values(frontend);
const corsOrigins = toList(process.env.CORS_ORIGINS);
const wsCorsOrigins = toList(process.env.WS_CORS_ORIGINS);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'P2P-UPI-Gateway',
  port: parseInt(process.env.PORT, 10) || 4000,
  apiPrefix: process.env.API_PREFIX || '/api',
  corsOrigins: corsOrigins.length ? corsOrigins : defaultOrigins,
  frontend,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    name: process.env.DB_NAME || 'p2p_upi_gateway',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: process.env.DB_LOGGING === 'true',
    pool: {
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
    },
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  jwt: {
    // Accept the spec's JWT_SECRET, falling back to JWT_ACCESS_SECRET.
    accessSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  security: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  ws: {
    path: process.env.WS_PATH || '/socket.io',
    corsOrigins: wsCorsOrigins.length ? wsCorsOrigins : defaultOrigins,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
  },

  platform: {
    feePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.6,
    traderCommissionPercent: parseFloat(process.env.DEFAULT_TRADER_COMMISSION_PERCENT) || 0.4,
    orderExpiryMinutes: parseInt(process.env.ORDER_EXPIRY_MINUTES, 10) || 10,
    exchangeRate: parseFloat(process.env.DEFAULT_EXCHANGE_RATE) || 89.0,
    heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS, 10) || 2 * 60 * 1000,
  },

  queue: {
    prefix: process.env.QUEUE_PREFIX || 'p2p',
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY, 10) || 5,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },
};
