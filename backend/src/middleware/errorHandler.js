'use strict';

/**
 * Global error handler. Must be mounted last (4-arg signature).
 * Normalizes Sequelize/validation errors into the standard failure envelope.
 */

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Sequelize validation / unique constraint
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    return res.status(422).json({
      success: false,
      message: err.errors?.map((e) => e.message).join('; ') || 'Validation error',
      code: 'VALIDATION_ERROR',
    });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  }

  return res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
    code: err.code,
  });
}

/** 404 fallback for unmatched routes. */
function notFound(req, res) {
  return res.status(404).json({ success: false, message: 'Route not found' });
}

module.exports = errorHandler;
module.exports.notFound = notFound;
