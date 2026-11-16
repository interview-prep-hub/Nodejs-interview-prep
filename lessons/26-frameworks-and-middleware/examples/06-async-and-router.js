// Mini-express stages 6 and 7: async handlers with error forwarding, and routers mounted at a prefix
// Run: node lessons/26-frameworks-and-middleware/examples/06-async-and-router.js

const stage4 = require('./_mini-express/04-errors'); //  errors, but no promise support
const stage6 = require('./_mini-express/06-async'); //   + async handlers
const { init } = require('./_mini-express/03-helpers');
const { createApp, Router, json, httpError } = require('./_mini-express'); // the finished library (stage 7)
const { start, line } = require('./_mini-express/testing');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A handler that fails AFTER an await, so a plain try/catch around the call cannot see the error.
async function flaky(req, res) {
  await sleep(5);
  throw new Error('db is down');
}

// The Express 4 era workaround: wrap every async handler by hand.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function addErrorHandler(app) {
  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  });
}

async function partAsync() {
  console.log('=== Part 1: async handlers (stage 6)');

  // Without promise support, the rejection has no owner.
  const lost = [];
  const onLost = (reason) => lost.push(reason.message);
  process.on('unhandledRejection', onLost); // without this line Node 24 would crash the process (exit code 1)

  const old = stage4.createApp({ silent: true });
  old.use(init);
  old.get('/flaky', flaky);
  old.get('/wrapped', wrap(flaky));
  addErrorHandler(old);

  let server = await start(old);
  try {
    await server.get('/flaky', { signal: AbortSignal.timeout(300) });
  } catch (err) {
    console.log('stage 4, async handler      : the client gave up (' + err.name + '), the request hangs');
  }
  console.log('stage 4, unhandled rejection:', JSON.stringify(lost));
  console.log('stage 4, with wrap()        :', line(await server.get('/wrapped')));
  await server.close();
  process.off('unhandledRejection', onLost);

  // With promise support, nothing special is needed.
  const modern = stage6.createApp({ silent: true });
  modern.use(init);
  modern.get('/flaky', flaky);
  modern.get('/reject-nothing', () => Promise.reject()); // rejecting with no reason at all
  modern.get('/user/:id', async (req, res) => {
    await sleep(5); // pretend this is a database call
    if (req.params.id === '0') throw httpError(404, 'No such user');
    res.json({ id: Number(req.params.id) });
  });
  addErrorHandler(modern);

  server = await start(modern);
  console.log('stage 6, async handler      :', line(await server.get('/flaky')));
  console.log('stage 6, reject with nothing:', line(await server.get('/reject-nothing')));
  console.log('stage 6, async 404 error    :', line(await server.get('/user/0')));
  console.log('stage 6, async success      :', line(await server.get('/user/5')));
  await server.close();
}

async function partRouter() {
  console.log('=== Part 2: routers mounted at a prefix (stage 7)');
  const seen = [];

  // A router is a mini application: its own middleware and routes, written as if it lived at "/".
  const users = Router();
  users.use((req, res, next) => {
    seen.push(`users middleware: baseUrl=${req.baseUrl} url=${req.url}`);
    next();
  });
  users.get('/', (req, res) => res.json({ list: ['ada', 'linus'] }));
  users.get('/:id', (req, res) => {
    res.json({
      id: req.params.id,
      url: req.url,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      path: req.path,
    });
  });
  users.post('/', json(), (req, res) => res.status(201).json({ created: req.body.name }));
  users.get('/:id/boom', () => {
    throw new Error('bug inside the users router');
  });

  // API versioning by URL prefix: the same router style, a different shape of answer.
  const usersV2 = Router();
  usersV2.get('/:id', (req, res) => res.json({ data: { id: req.params.id }, meta: { version: 2 } }));

  const v1 = Router();
  v1.use((req, res, next) => {
    res.set('X-Api-Version', '1'); // runs for every /v1/... request
    next();
  });
  v1.use('/users', users); //          mounted inside v1, so the full path is /v1/users

  const v2 = Router();
  v2.use((req, res, next) => {
    res.set('X-Api-Version', '2');
    next();
  });
  v2.use('/users', usersV2);

  const app = createApp({ silent: true });
  app.use((req, res, next) => {
    seen.push(`app middleware: url=${req.url}`);
    next();
  });
  app.use('/v1', v1);
  app.use('/v2', v2);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use((req, res, next) => next(httpError(404, `No route for ${req.method} ${req.originalUrl}`)));
  addErrorHandler(app);

  const server = await start(app);
  const show = async (method, path, options) => {
    seen.length = 0;
    const res = await server.request(method, path, options);
    const version = res.headers.get('x-api-version');
    const note = version ? ` [X-Api-Version: ${version}]` : '';
    console.log(`${method} ${path}`.padEnd(26), line(res) + note);
    for (const s of seen) console.log(' '.repeat(26), '|', s);
  };

  await show('GET', '/v1/users');
  await show('GET', '/v1/users/7?full=1');
  await show('POST', '/v1/users', { json: { name: 'Grace' } });
  await show('GET', '/v2/users/7');
  await show('GET', '/health');
  console.log('--- what does not match falls through to the next layer');
  await show('GET', '/v1/usersX');
  await show('GET', '/v3/users');
  await show('GET', '/v1/users/7/boom');

  await server.close();
}

async function main() {
  await partAsync();
  await partRouter();
}

main();
