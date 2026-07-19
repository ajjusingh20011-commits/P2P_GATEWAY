/**
 * Global Express error handler. Logs the error and returns a consistent
 * JSON envelope. Must be registered last, after all routes.
 *
 * eslint-disable-next-line no-unused-vars — Express identifies an error
 * handler by its 4-argument signature, so `next` must stay in the list.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('Error:', err.stack || err.message || err);

  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
