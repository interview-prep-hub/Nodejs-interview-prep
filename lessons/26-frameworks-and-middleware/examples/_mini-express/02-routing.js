// Mini-express, stage 2: routing. app.get('/users/:id', handler) and friends.
// Helper module, not run by itself. Used by examples/02-routing.js
//
// New compared to stage 1: a "layer" can now have a method and a path pattern.
// A layer without them (made by app.use) runs for every request.

const http = require('node:http');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Turn '/users/:id' into a regular expression plus the names of the parameters.
//   '/users/:id'  ->  regex /^\/users\/([^/]+)\/?$/   keys ['id']
function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, '') // '/users/' and '/users' are the same route
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // a dot in the path means a dot, not "any character"
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)'; // one or more characters that are not a slash
    });
  return { regex: new RegExp(`^${source}/?$`), keys };
}

// '/users/7?sort=asc' -> '/users/7'. (We cut the string ourselves. new URL(req.url, base) is
// risky here because a request line such as "//evil.com/x" would be read as a host name.)
function pathOf(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function createApp() {
  const stack = [];

  function app(req, res) {
    let index = 0;
    const pathname = pathOf(req.url);

    function next() {
      const layer = stack[index++];
      if (!layer) {
        res.statusCode = 404;
        res.end(`Cannot ${req.method} ${pathname}`);
        return;
      }

      if (layer.method) {
        // A route layer must match the method AND the path. Otherwise skip it.
        if (layer.method !== 'ALL' && layer.method !== req.method) return next();
        const match = layer.regex.exec(pathname);
        if (!match) return next();
        try {
          req.params = Object.fromEntries(layer.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
        } catch {
          res.statusCode = 400; // '%E0%A4%A' is not valid percent-encoding
          res.end('Bad Request');
          return;
        }
      }

      layer.fn(req, res, next);
    }

    next();
  }

  app.use = (fn) => {
    stack.push({ fn });
    return app;
  };

  // app.get(path, a, b, c): several handlers per route are allowed
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

module.exports = { createApp, compile };
