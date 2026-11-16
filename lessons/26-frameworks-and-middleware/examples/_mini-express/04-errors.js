// Mini-express, stage 4: error-handling middleware (the function with FOUR parameters).
// Helper module, not run by itself. Used by examples/04-error-middleware.js and 05-json-body-parser.js
//
// New compared to stage 2: next(err), a try/catch around every call, and a final handler.
// The dispatch rule: while an error is travelling, skip every normal middleware and run only the
// functions that declare four parameters. While there is no error, skip those four-parameter functions.

const http = require('node:http');
const { compile } = require('./02-routing');
const { pathOf } = require('./03-helpers');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// An Error that knows its HTTP status. "expose" means: the message is safe to show to the client.
function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: status < 500 });
}

// Runs when the chain is finished: nobody answered (404) or nobody handled the error.
function finalHandler(err, req, res, silent) {
  if (res.headersSent) {
    // Too late for a clean error page, the status line is already on the wire.
    if (!res.writableEnded) res.destroy(); // cut the connection so the client does not wait forever
    return;
  }
  if (!err) {
    res.statusCode = 404;
    res.end(`Cannot ${req.method} ${pathOf(req.url)}`);
    return;
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (!silent && status >= 500) console.log(`  [final handler] unhandled error: ${err.message}`);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(err.expose ? err.message : 'Internal Server Error'); // never leak internals for a 5xx
}

function createApp({ silent = false } = {}) {
  const stack = [];

  function app(req, res) {
    let index = 0;
    const pathname = pathOf(req.url);

    function next(err) {
      const layer = stack[index++];
      if (!layer) return finalHandler(err, req, res, silent);

      // The arity trick: fn.length is the number of declared parameters.
      const isErrorHandler = layer.fn.length === 4;
      if (err && !isErrorHandler) return next(err); // an error is travelling: skip normal middleware
      if (!err && isErrorHandler) return next(); //  nothing wrong: skip error handlers

      if (layer.method) {
        if (layer.method !== 'ALL' && layer.method !== req.method) return next();
        const match = layer.regex.exec(pathname);
        if (!match) return next();
        try {
          req.params = Object.fromEntries(layer.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
        } catch {
          return next(httpError(400, 'Bad Request')); // an error now, not a hard-coded answer
        }
      }

      try {
        if (err) layer.fn(err, req, res, next);
        else layer.fn(req, res, next);
      } catch (thrown) {
        next(thrown); // a throw inside a middleware becomes next(error)
      }
    }

    next();
  }

  app.use = (fn) => {
    stack.push({ fn });
    return app;
  };
  function route(method, pattern, handlers) {
    const { regex, keys } = compile(pattern);
    for (const fn of handlers) stack.push({ method, regex, keys, fn });
    return app;
  }
  for (const name of METHODS) {
    app[name] = (pattern, ...handlers) => route(name.toUpperCase(), pattern, handlers);
  }
  app.all = (pattern, ...handlers) => route('ALL', pattern, handlers);
  app.listen = (...args) => http.createServer(app).listen(...args);
  return app;
}

module.exports = { createApp, httpError, finalHandler };
