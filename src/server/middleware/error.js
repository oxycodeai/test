/** 404 for unknown /api routes + central error handler. */
export function notFound(req, res) {
  res
    .status(404)
    .json({ error: { code: 'not_found', message: `No route: ${req.method} ${req.path}` } });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || (status >= 500 ? 'server_error' : 'bad_request');
  if (status >= 500) console.error('[api]', req.method, req.path, err);
  else console.warn('[api]', req.method, req.path, err.message);
  res.status(status).json({ error: { code, message: err.message || 'Unexpected error' } });
}

/** async route wrapper */
export function h(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
