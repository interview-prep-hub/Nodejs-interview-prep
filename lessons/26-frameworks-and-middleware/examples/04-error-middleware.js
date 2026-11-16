// Mini-express stage 4: error-handling middleware (four parameters), next(err), and the arity trick
// Run: node lessons/26-frameworks-and-middleware/examples/04-error-middleware.js

const { createApp, httpError } = require('./_mini-express/04-errors');
const { init } = require('./_mini-express/03-helpers');
const { start, line } = require('./_mini-express/testing');

async function main() {
  // ---------- Part 1: three ways an error is born, one place where it is handled
  const trail = [];
  const app = createApp({ silent: true });
  app.use(init);
  app.use((req, res, next) => {
    trail.push('logger');
    next();
  });

  app.get('/throws', () => {
    throw new Error('sync throw'); // no try/catch needed: the framework wraps every call
  });
  app.get('/next-err', (req, res, next) => next(new Error('passed to next()')));
  app.get('/not-found', (req, res, next) => next(httpError(404, 'User 7 does not exist')));
  app.get('/boom', (req, res, next) => next(new Error('database password is hunter2'))); // a secret in the message
  app.get('/ok', (req, res) => res.json({ ok: true }));

  // This middleware sits AFTER the routes. While an error is travelling it is skipped (see the
  // trail for /throws), but it does run for a request that reaches it without an error.
  app.use((req, res, next) => {
    trail.push('after-routes middleware');
    next();
  });

  // 404 handler: a normal middleware placed after all routes. It turns "nobody answered" into an error.
  app.use((req, res, next) => next(httpError(404, `Cannot ${req.method} ${req.path}`)));

  // Error handler number 1: only logs, then passes the error on with next(err).
  app.use((err, req, res, next) => {
    trail.push(`log: ${err.message}`);
    next(err);
  });

  // Error handler number 2: the one that answers. FOUR parameters, even though "next" is unused.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err); // too late to send JSON, let the default handler cut the connection
    const status = err.status ?? 500;
    res.status(status).json({
      error: { status, message: err.expose ? err.message : 'Internal Server Error' },
    });
  });

  let server = await start(app);
  console.log('--- Part 1: errors become JSON in one place');
  for (const path of ['/ok', '/throws', '/next-err', '/not-found', '/boom', '/nothing-here']) {
    trail.length = 0;
    const res = await server.get(path);
    console.log(`GET ${path}`.padEnd(20), line(res));
    console.log(' '.repeat(20), 'trail:', trail.join(' | '));
  }
  await server.close();

  // ---------- Part 2: the arity trap. A "handler" with only three parameters is a normal middleware.
  const wrong = createApp({ silent: true });
  wrong.get('/fail', () => {
    throw new Error('fail');
  });
  wrong.use((err, req, res) => {
    // Only 3 parameters, so this is a NORMAL middleware: it is skipped for errors, and for any
    // request that reaches it, it is called as (req, res, next). Then "res" is really the next function.
    res.end('handled by the 3-parameter function');
  });
  console.log('--- Part 2: function.length decides');
  console.log('(err, req, res, next) =>', ((err, req, res, next) => {}).length, '-> error handler');
  console.log('(err, req, res)       =>', ((err, req, res) => {}).length, '-> normal middleware (the bug)');
  console.log('(...args)             =>', ((...args) => {}).length, '-> normal middleware');
  console.log('(err, req, res, next = null) =>', ((err, req, res, next = null) => {}).length, '-> normal middleware');
  server = await start(wrong);
  console.log('GET /fail (an error), 3-parameter handler :', line(await server.get('/fail')));
  console.log('GET /other (no error), 3-parameter handler:', line(await server.get('/other')));
  await server.close();

  // ---------- Part 3: the headers are already sent, so no clean error is possible
  const late = createApp({ silent: true });
  late.use(init);
  late.get('/stream', (req, res, next) => {
    res.write('first part of the answer...'); // status 200 and the headers go out now
    setTimeout(() => next(new Error('crashed in the middle')), 20);
  });
  late.use((err, req, res, next) => {
    if (res.headersSent) return next(err); // the rule from the Express docs: hand it on
    res.status(500).json({ error: 'never reached for this route' });
  });
  server = await start(late);
  console.log('--- Part 3: error after the response started');
  const res = await fetch(`${server.base}/stream`);
  console.log('status the client already saw:', res.status);
  try {
    await res.text();
  } catch (err) {
    console.log('reading the rest of the body failed:', err.name, '-', err.message);
  }
  await server.close();
}

main();
