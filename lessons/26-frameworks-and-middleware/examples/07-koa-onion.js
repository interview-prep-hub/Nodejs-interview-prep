// Koa-style onion model built from scratch (async compose with await next()), shown beside the Express model
// Run: node lessons/26-frameworks-and-middleware/examples/07-koa-onion.js

const http = require('node:http');
const { createApp, httpError } = require('./_mini-express'); // the Express-style mini framework
const { start, line } = require('./_mini-express/testing');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- compose: the whole idea of Koa in about 15 lines ----------
// Takes a list of async functions (ctx, next) and returns ONE function that runs them as nested calls.
function compose(middleware) {
  return function run(ctx) {
    let last = -1; // the highest index that has started
    function dispatch(i) {
      if (i <= last) return Promise.reject(new Error('next() called multiple times'));
      last = i;
      const fn = middleware[i];
      if (!fn) return Promise.resolve(); // past the end: the innermost next() does nothing
      try {
        // next is "run the rest of the list". The caller gets back a promise it can await.
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err); // a sync throw becomes a rejection too
      }
    }
    return dispatch(0);
  };
}

// ---------- a tiny Koa-like server around compose ----------
class Context {
  constructor(req, res) {
    this.req = req;
    this.res = res;
    this.method = req.method;
    this.path = req.url.split('?')[0];
    this.headers = {}; // response headers, kept here until the very end
    this.state = {}; //   a place for middleware to share data
    this._status = 404; // like Koa: "not found" until somebody sets a body
    this._explicitStatus = false;
    this._body = undefined;
  }
  get status() {
    return this._status;
  }
  set status(value) {
    this._status = value;
    this._explicitStatus = true;
  }
  get body() {
    return this._body;
  }
  set body(value) {
    this._body = value;
    if (!this._explicitStatus) this._status = 200; // setting a body means "found"
  }
  set(name, value) {
    this.headers[name] = value;
  }
}

function koaLite(...middleware) {
  const run = compose(middleware);
  return async (req, res) => {
    const ctx = new Context(req, res);
    try {
      await run(ctx); // the whole onion, in and out
    } catch (err) {
      ctx.status = err.status ?? 500; // last-resort handler
      ctx.body = { error: err.expose ? err.message : 'Internal Server Error' };
    }
    // The response is written only NOW, after every "out" part has run. That is the point.
    const text = typeof ctx.body === 'string' ? ctx.body : undefined;
    const payload = text ?? JSON.stringify(ctx.body ?? { error: http.STATUS_CODES[ctx.status] });
    res.writeHead(ctx.status, {
      'Content-Type': text === undefined ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      ...ctx.headers,
    });
    res.end(payload);
  };
}

async function main() {
  // ===== Part 1: the onion
  console.log('=== Part 1: compose, the heart of Koa');
  const trail = [];
  const onion = compose([
    async (ctx, next) => {
      trail.push('A in');
      await next();
      trail.push('A out');
    },
    async (ctx, next) => {
      trail.push('B in');
      await next();
      trail.push('B out');
    },
    async () => {
      trail.push('C start');
      await sleep(20); // slow work, like a database call
      trail.push('C done');
    },
  ]);
  await onion({});
  console.log('order:', trail.join(' > '));

  // ===== Part 2: the same three middleware in the Express model
  console.log('=== Part 2: the same code in the Express model (next() returns nothing)');
  const expressTrail = [];
  const express = createApp({ silent: true });
  express.use((req, res, next) => {
    expressTrail.push('A in');
    next(); // returns undefined at once, nothing to await
    expressTrail.push('A out');
  });
  express.use((req, res, next) => {
    expressTrail.push('B in');
    next();
    expressTrail.push('B out');
  });
  express.use(async (req, res) => {
    expressTrail.push('C start');
    await sleep(20);
    expressTrail.push('C done');
    res.end('done');
  });
  let server = await start(express);
  await server.get('/');
  await server.close();
  console.log('order:', expressTrail.join(' > '));
  console.log('"A out" and "B out" ran BEFORE "C done": next() cannot wait for async work in Express.');

  // ===== Part 3: logic after the response is built. Timing is the classic example.
  console.log('=== Part 3: a timing header');
  const timed = koaLite(
    async (ctx, next) => {
      const started = performance.now();
      await next(); //     everything below finished, the response is still NOT sent
      ctx.set('X-Response-Time', `${Math.round(performance.now() - started)}ms`); // so this still works
    },
    async (ctx) => {
      await sleep(25);
      ctx.body = { hello: 'koa' };
    },
  );
  server = await start(timed);
  let res = await server.get('/');
  const header = res.headers.get('x-response-time');
  console.log('Koa model   :', line(res), '| X-Response-Time is a number of ms:', /^\d+ms$/.test(header), '| at least 20ms:', parseInt(header, 10) >= 20);
  await server.close();

  const lateErrors = [];
  const expressTimed = createApp({ silent: true });
  expressTimed.use((req, res, next) => {
    const started = performance.now();
    next(); //     the handler below already called res.json(): the headers are gone
    res.setHeader('X-Response-Time', `${Math.round(performance.now() - started)}ms`); // too late
  });
  expressTimed.get('/', (req, res) => res.json({ hello: 'express' }));
  expressTimed.use((err, req, res, next) => {
    lateErrors.push(err.code);
    next(err);
  });
  server = await start(expressTimed);
  res = await server.get('/');
  console.log('Express way :', line(res), '| header present:', res.headers.has('x-response-time'), '| error seen:', lateErrors[0]);
  await server.close();
  console.log('(Express fixes this by setting the header in a patched res.writeHead, see example 08.)');

  // ===== Part 4: errors. One try/catch around await next() replaces the four-parameter function.
  console.log('=== Part 4: errors in the onion');
  const app = koaLite(
    async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        ctx.status = err.status ?? 500;
        ctx.body = { error: err.expose ? err.message : 'Internal Server Error' };
        ctx.state.failed = true;
      }
    },
    async (ctx) => {
      if (ctx.path === '/boom') throw new Error('bug');
      if (ctx.path === '/missing') throw httpError(404, 'No such page');
      ctx.body = 'fine';
    },
  );
  server = await start(app);
  for (const path of ['/ok', '/boom', '/missing']) console.log(path.padEnd(10), line(await server.get(path)));
  await server.close();

  // ===== Part 5: next() called twice is detected by compose
  console.log('=== Part 5: next() called twice');
  const guarded = compose([
    async (ctx, next) => {
      await next();
      await next(); // the bug
    },
    async () => {},
  ]);
  try {
    await guarded({});
  } catch (err) {
    console.log('Koa model rejects :', err.message);
  }
  console.log('Express model     : no check, the shared counter runs whatever comes next (example 01, part 4).');

  // ===== Part 6: a middleware that forgets to call next()
  console.log('=== Part 6: a middleware that never calls next()');
  server = await start(koaLite(async () => {}));
  console.log('Koa model   :', line(await server.get('/')), '(the chain ended, so the framework still answers)');
  await server.close();
  console.log('Express way : the request hangs (example 01, part 5).');
}

main();
