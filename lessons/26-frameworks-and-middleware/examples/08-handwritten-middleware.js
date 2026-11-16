// Middleware you should be able to write by hand: request id, logger, timing, CORS, rate limit, compression, 404, error handler
// Run: node lessons/26-frameworks-and-middleware/examples/08-handwritten-middleware.js

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createApp, httpError } = require('./_mini-express');
const { start, line } = require('./_mini-express/testing');

// Small helper: add a field to the Vary header without erasing what other middleware put there.
function appendVary(res, field) {
  const current = res.getHeader('Vary');
  if (!current) return res.setHeader('Vary', field);
  const present = String(current).split(',').map((part) => part.trim().toLowerCase());
  if (!present.includes(field.toLowerCase())) res.setHeader('Vary', `${current}, ${field}`);
}

// ---------- 1. request id: every request gets a label that appears in logs and in the response ----------
function requestId() {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    // Trust an id from the client (or a proxy) only if it looks harmless. Otherwise a client could
    // put newlines or huge strings into your logs.
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

// ---------- 2. logger: runs when the response is FINISHED, so it knows the real status code ----------
function logger(lines) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      lines.push({ id: req.id, text: `${req.method} ${req.originalUrl} -> ${res.statusCode}`, msIsNumber: Number.isFinite(ms) });
    });
    next();
  };
}

// ---------- 3. timing: add X-Response-Time just before the headers go out ----------
// In Express you cannot set a header after next() returns (the answer is gone). So wrap res.writeHead.
// This is the idea behind the "on-headers" package.
function timing() {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      if (!this.headersSent) {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        this.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}

// ---------- 4. CORS: tell browsers which other websites may call this API ----------
function cors({ origins = [], methods = 'GET,POST,PUT,PATCH,DELETE', headers = 'content-type,authorization', maxAge = 600 } = {}) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next(); // not a cross-origin browser call (curl, server to server, same origin)
    appendVary(res, 'Origin'); // the answer depends on the Origin header, so caches must keep copies per origin
    if (!origins.includes(origin)) return next(); // no CORS headers: the browser will block the response
    res.setHeader('Access-Control-Allow-Origin', origin);
    const isPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'];
    if (isPreflight) {
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', headers);
      res.setHeader('Access-Control-Max-Age', String(maxAge));
      res.status(204).end(); // answer the preflight here, the routes never see it
      return;
    }
    next();
  };
}

// ---------- 5. rate limit: a token bucket per client ----------
// The bucket holds up to "capacity" tokens and refills "refillPerSecond" tokens every second.
// A request costs one token. Empty bucket -> 429. "now" can be replaced in tests (a fake clock).
function rateLimit({ capacity = 5, refillPerSecond = 1, keyOf = (req) => req.socket.remoteAddress, now = Date.now } = {}) {
  const buckets = new Map(); // key -> { tokens, updated }   (in memory: one process only, see the lesson text)
  return (req, res, next) => {
    const key = keyOf(req);
    const t = now();
    const bucket = buckets.get(key) ?? { tokens: capacity, updated: t };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((t - bucket.updated) / 1000) * refillPerSecond);
    bucket.updated = t;
    buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(capacity));
    if (bucket.tokens < 1) {
      res.setHeader('Retry-After', String(Math.ceil((1 - bucket.tokens) / refillPerSecond)));
      return next(httpError(429, 'Too Many Requests'));
    }
    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
}

// ---------- 6. compression, the idea ----------
// Wrap res.end: if the client accepts gzip and the body is big enough, compress it.
// Real code (the "compression" package) streams through zlib.createGzip(), skips images and other
// already-compressed types, and respects Cache-Control: no-transform. gzipSync here blocks the event
// loop, which is fine for a demo and wrong for big bodies.
function compress({ threshold = 1024 } = {}) {
  return (req, res, next) => {
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
    appendVary(res, 'Accept-Encoding');
    const end = res.end;
    res.end = function patchedEnd(chunk, ...rest) {
      const isData = typeof chunk === 'string' || Buffer.isBuffer(chunk);
      if (isData && !this.headersSent && !this.getHeader('Content-Encoding')) {
        const raw = Buffer.from(chunk);
        if (raw.length >= threshold) {
          const zipped = zlib.gzipSync(raw);
          this.setHeader('Content-Encoding', 'gzip');
          this.setHeader('Content-Length', zipped.length);
          return end.call(this, zipped);
        }
      }
      return end.call(this, chunk, ...rest);
    };
    next();
  };
}

// ---------- 7. the last two: 404 and the error handler ----------
const notFound = (req, res, next) => next(httpError(404, `No route for ${req.method} ${req.path}`));

function errorHandler(logs) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? 500;
    if (status >= 500) logs.push(`server error (${req.id}): ${err.message}`); // details stay in the log
    res.status(status).json({
      error: { message: err.expose ? err.message : 'Internal Server Error', requestId: req.id },
    });
  };
}

// ---------- put it together. THE ORDER IS PART OF THE DESIGN ----------
async function main() {
  const lines = [];
  const errorLogs = [];
  const clock = { now: 0 }; // a fake clock, so the rate limit result is the same on every run

  const app = createApp({ silent: true });
  app.use(requestId()); //    first: everybody after it can use req.id
  app.use(timing());
  app.use(logger(lines)); //  early: it must see short-circuited answers (preflight, 429) too
  app.use(cors({ origins: ['https://app.example.com'] })); // before the rate limit: a 429 needs CORS headers
  // A real limiter keys on the client IP address or an API key. Here, requests without an x-client
  // header get their own bucket (their request id), so the demo sections do not disturb each other.
  app.use(rateLimit({ capacity: 3, refillPerSecond: 1, keyOf: (req) => req.headers['x-client'] ?? req.id, now: () => clock.now }));
  app.use(compress({ threshold: 200 }));

  app.get('/small', (req, res) => res.json({ hello: 'world' }));
  app.get('/big', (req, res) => res.json({ text: 'the same sentence again and again. '.repeat(100) }));
  app.get('/bug', () => {
    throw new Error('null pointer somewhere');
  });

  app.use(notFound); //                  after all routes
  app.use(errorHandler(errorLogs)); //   last of all

  const server = await start(app);
  const show = (label, value) => console.log(label.padEnd(30), value);

  console.log('--- request id');
  let res = await server.get('/small', { headers: { 'x-request-id': 'client-id-0001' } });
  show('client sent an id', `${res.headers.get('x-request-id')} (kept)`);
  res = await server.get('/small', { headers: { 'x-request-id': 'bad id with spaces\tand tab' } });
  show('client sent a bad id', `replaced by a uuid: ${/^[0-9a-f-]{36}$/.test(res.headers.get('x-request-id'))}`);

  console.log('--- timing');
  res = await server.get('/small');
  show('X-Response-Time looks like', /^\d+\.\d ?ms$/.test(res.headers.get('x-response-time')) ? 'a number of ms' : res.headers.get('x-response-time'));

  console.log('--- CORS');
  const asked = { 'access-control-request-method': 'POST', 'accept-encoding': 'identity' }; // identity: no gzip, keeps the output short
  res = await server.request('OPTIONS', '/small', { headers: { origin: 'https://app.example.com', ...asked } });
  show('preflight, allowed origin', `${res.status} allow-origin=${res.headers.get('access-control-allow-origin')} allow-methods=${res.headers.get('access-control-allow-methods')}`);
  res = await server.request('OPTIONS', '/small', { headers: { origin: 'https://evil.example.net', ...asked } });
  show('preflight, unknown origin', `${res.status} allow-origin=${res.headers.get('access-control-allow-origin')} vary=${res.headers.get('vary')}`);
  res = await server.get('/small', { headers: { origin: 'https://app.example.com', 'accept-encoding': 'identity' } });
  show('normal call, allowed origin', `${res.status} allow-origin=${res.headers.get('access-control-allow-origin')}`);

  console.log('--- rate limit (3 tokens, 1 token back per second, fake clock)');
  const results = [];
  for (let i = 0; i < 4; i++) {
    res = await server.get('/small', { headers: { 'x-client': 'bob' } });
    results.push(res.status + (res.status === 429 ? ` (Retry-After ${res.headers.get('retry-after')})` : ''));
  }
  show('bob, 4 quick requests', results.join(', '));
  res = await server.get('/small', { headers: { 'x-client': 'alice' } });
  show('alice, her own bucket', `${res.status} remaining=${res.headers.get('x-ratelimit-remaining')}`);
  clock.now += 1000; // one second later
  res = await server.get('/small', { headers: { 'x-client': 'bob' } });
  show('bob, 1 second later', String(res.status));
  res = await server.get('/small', { headers: { 'x-client': 'bob', 'x-request-id': 'client-id-0004' } });
  show('bob, again at once', line(res));

  console.log('--- compression');
  res = await server.get('/big', { headers: { 'accept-encoding': 'identity', 'x-client': 'c1' } });
  const plainSize = Number(res.headers.get('content-length'));
  show('client says identity', `content-encoding=${res.headers.get('content-encoding')} bytes=${plainSize}`);
  res = await server.get('/big', { headers: { 'accept-encoding': 'gzip', 'x-client': 'c2' } });
  show('client accepts gzip', `content-encoding=${res.headers.get('content-encoding')} bytes=${res.headers.get('content-length')} (decoded text is ${res.text.length} chars)`);
  res = await server.get('/small', { headers: { 'accept-encoding': 'gzip', 'x-client': 'c3' } });
  show('small body, gzip accepted', `content-encoding=${res.headers.get('content-encoding')} (below the threshold)`);
  res = await server.get('/big', { headers: { 'accept-encoding': 'gzip', origin: 'https://app.example.com' } });
  show('origin AND gzip', `vary=${res.headers.get('vary')}`);

  console.log('--- 404 and 500');
  res = await server.get('/nothing', { headers: { 'x-request-id': 'client-id-0002', 'x-client': 'c4' } });
  show('unknown route', line(res));
  res = await server.get('/bug', { headers: { 'x-request-id': 'client-id-0003', 'x-client': 'c5' } });
  show('a bug in a handler', line(res));
  show('what the server logged', JSON.stringify(errorLogs));

  // The 'finish' event of the last response can fire a moment after the client has read it, so wait a little.
  await new Promise((resolve) => setTimeout(resolve, 20));
  console.log('--- the access log (one line per finished response)');
  const wanted = ['client-id-0001', 'client-id-0002', 'client-id-0003'];
  for (const entry of lines.filter((l) => wanted.includes(l.id))) console.log(' ', entry.id, entry.text);
  console.log('  lines in total:', lines.length, '| all had a duration:', lines.every((l) => l.msIsNumber));

  await server.close();
}

main();
