/**
 * Sequelize CLI configuration (migrations/seeders).
 * The runtime Sequelize instance is created in src/loaders/database.js.
 */

require('dotenv').config();

const base = {
  username: process.env.DB_USER || 'root',
  // XAMPP/local MySQL commonly has no root password — default to empty string.
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'p2p_gateway',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  dialect: process.env.DB_DIALECT || 'mysql',
  logging: process.env.DB_LOGGING === 'true',
};

module.exports = {
  development: base,
  test: { ...base, database: `${base.database}_test` },
  production: base,
};
