'use strict';

/**
 * Uniform HTTP response helpers.
 * Success:  { success: true, data }
 * Failure:  { success: false, message, code? }
 */

function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data });
}

function created(res, data = {}) {
  return ok(res, data, 201);
}

function fail(res, status, message, code) {
  const body = { success: false, message };
  if (code) body.code = code;
  return res.status(status).json(body);
}

/** Wrap an async controller so thrown errors flow to the error handler. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Parse common list query params (page, limit, sort). */
function pagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { ok, created, fail, asyncHandler, pagination };
