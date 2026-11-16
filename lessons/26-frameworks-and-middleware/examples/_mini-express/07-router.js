// Mini-express, stage 7: a Router that can be mounted at a prefix: app.use('/api', router).
// Helper module, not run by itself. Used by examples/06-async-and-router.js and the later examples.
//
// New compared to stage 6:
//   1. The chain logic moves into Router(). A router is a middleware itself: router(req, res, out).
//      "out" is the next() of whoever called it. When the router runs out of layers, it calls out().
//   2. app.use('/prefix', ...) matches on whole path segments and STRIPS the prefix from req.url while
//      the inner layers run. Inside a router mounted at /api, the URL '/api/users/7' looks like '/users/7'.
//      req.baseUrl remembers the part that was removed, req.originalUrl the full URL.
//   3. The app becomes "a router plus listen() plus a final handler".

const http = require('node:http');
const { compile } = require('./02-routing');
const { pathOf } = require('./03-helpers');
const { httpError, finalHandler } = require('./04-errors');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// '/api/' -> '/api',  '/' -> ''  (an empty prefix means "everything")
function normalizePrefix(prefix) {
  return prefix.replace(/\/+$/, '');
}

// Does the path start with the prefix, on a whole segment? '/api' matches '/api' and '/api/x', not '/apix'.
function matchesPrefix(pathname, prefix) {
  return prefix === '' || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function Router() {
  const stack = [];

  function router(req, res, out) {
    let index = 0;
    const entryUrl = req.url; // the URL as this router sees it (already stripped by any parent)
    const entryBase = req.baseUrl || '';
    const pathname = pathOf(entryUrl);

    function next(err) {
      req.url = entryUrl; // undo the prefix stripping done for the previous layer
      req.baseUrl = entryBase;

      const layer = stack[index++];
      if (!layer) return out(err); // hand control back to whoever called this router

      const isErrorHandler = layer.fn.length === 4;
      if (err && !isErrorHandler) return next(err);
      if (!err && isErrorHandler) return next();

      if (layer.method) {
        // a route: full match on method and path
        if (layer.method !== 'ALL' && layer.method !== req.method) return next();
        const match = layer.regex.exec(pathname);
        if (!match) return next();
        try {
          req.params = Object.fromEntries(layer.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
        } catch {
          return next(httpError(400, 'Bad Request'));
        }
      } else {
        // a use(): prefix match, and strip the prefix while the layer runs
        if (!matchesPrefix(pathname, layer.prefix)) return next();
        if (layer.prefix !== '') {
          const rest = entryUrl.slice(layer.prefix.length);
          req.url = rest.startsWith('/') ? rest : `/${rest}`; // '/api?x=1' -> '/?x=1'
          req.baseUrl = entryBase + layer.prefix;
        }
      }

      try {
        const result = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
        if (result && typeof result.then === 'function') {
          result.then(undefined, (reason) => next(reason || new Error('Rejected promise')));
        }
      } catch (thrown) {
        next(thrown);
      }
    }

    next();
  }

  // router.use(fn)  or  router.use('/prefix', fnOrRouter, ...)
  router.use = (...args) => {
    const prefix = typeof args[0] === 'string' ? normalizePrefix(args.shift()) : '';
    for (const fn of args) stack.push({ prefix, fn });
    return router;
  };

  function route(method, pattern, handlers) {
    const { regex, keys } = compile(pattern);
    for (const fn of handlers) stack.push({ method, regex, keys, fn });
    return router;
  }
  for (const name of METHODS) {
    router[name] = (pattern, ...handlers) => route(name.toUpperCase(), pattern, handlers);
  }
  router.all = (pattern, ...handlers) => route('ALL', pattern, handlers);

  return router;
}

function createApp({ silent = false } = {}) {
  const router = Router();

  function app(req, res, out) {
    router(req, res, out || ((err) => finalHandler(err, req, res, silent)));
  }
  // Same methods as the router, but return the app so that chaining keeps working.
  for (const name of ['use', 'all', ...METHODS]) {
    app[name] = (...args) => {
      router[name](...args);
      return app;
    };
  }
  app.listen = (...args) => http.createServer(app).listen(...args);
  return app;
}

module.exports = { createApp, Router };
