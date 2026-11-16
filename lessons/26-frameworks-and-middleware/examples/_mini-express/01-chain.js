// Mini-express, stage 1: app.use(fn) and next(). A chain of middleware.
// Helper module, not run by itself. Used by examples/01-middleware-chain.js
//
// What this stage can do:     run functions one after the other, in the order they were added.
// What it cannot do yet:      routes, errors, body parsing (the next stages add them).

const http = require('node:http');

function createApp() {
  const stack = []; // the middleware functions, in the order they were added

  // "app" is a normal request listener, so http.createServer(app) works.
  function app(req, res) {
    let index = 0; // one counter per request, shared by every call of next()

    function next() {
      const fn = stack[index++]; // take the next function and move the counter on
      if (!fn) {
        // We ran out of middleware and nobody answered the request.
        res.statusCode = 404;
        res.end(`Cannot ${req.method} ${req.url}`);
        return;
      }
      fn(req, res, next); // hand over: the function decides whether to call next()
    }

    next();
  }

  app.use = (fn) => {
    stack.push(fn);
    return app; // so calls can be chained: app.use(a).use(b)
  };
  app.listen = (...args) => http.createServer(app).listen(...args);
  return app;
}

module.exports = { createApp };
