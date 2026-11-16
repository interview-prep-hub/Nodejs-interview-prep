// Mini-express, stage 6: async handlers. A rejected promise is forwarded to the error handlers.
// Helper module, not run by itself. Used by examples/06-async-and-router.js
//
// This is stage 4 with ONE change, marked "NEW" below: after calling a middleware we look at
// what it returned. If it is a promise, we attach a rejection handler that calls next(error).
// This is exactly what Express 5 does. Express 4 did not, so Express 4 apps needed try/catch
// or a wrapper around every async handler.

const http = require('node:http');
const { compile } = require('./02-routing');
const { pathOf } = require('./03-helpers');
const { httpError, finalHandler } = require('./04-errors');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function createApp({ silent = false } = {}) {
  const stack = [];

  function app(req, res) {
    let index = 0;
    const pathname = pathOf(req.url);

    function next(err) {
      const layer = stack[index++];
      if (!layer) return finalHandler(err, req, res, silent);

      const isErrorHandler = layer.fn.length === 4;
      if (err && !isErrorHandler) return next(err);
      if (!err && isErrorHandler) return next();

      if (layer.method) {
        if (layer.method !== 'ALL' && layer.method !== req.method) return next();
        const match = layer.regex.exec(pathname);
        if (!match) return next();
        try {
          req.params = Object.fromEntries(layer.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
        } catch {
          return next(httpError(400, 'Bad Request'));
        }
      }

      try {
        const result = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
        // NEW in stage 6: an async function returns a promise. Nobody awaits it, so we watch it.
        if (result && typeof result.then === 'function') {
          result.then(undefined, (reason) => next(reason || new Error('Rejected promise')));
        }
      } catch (thrown) {
        next(thrown);
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

module.exports = { createApp };
