/**
 * MySQL connection loader (Sequelize).
 * `connectDatabase()` authenticates and flips `dbConnected`. `isDbConnected()`
 * feeds the /api/health endpoint.
 */

const { Sequelize } = require('sequelize');
const config = require('../config');
const logger = require('../utils/logger');

let dbConnected = false;

const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: config.db.dialect,
  logging: config.db.logging ? (msg) => logger.debug(msg) : false,
  pool: config.db.pool,
});

async function connectDatabase() {
  await sequelize.authenticate();
  dbConnected = true;
  logger.info('MySQL connection established');
  return sequelize;
}

function isDbConnected() {
  return dbConnected;
}

module.exports = { sequelize, connectDatabase, isDbConnected };
