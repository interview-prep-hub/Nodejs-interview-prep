// Testing a framework app with real requests: port 0 + fetch, a fresh app per test, and a middleware unit test with fake req/res
// Run: node lessons/26-frameworks-and-middleware/examples/11-testing-with-fetch.js
//
// No test framework is needed to understand the idea, so this file uses node:assert and a 10-line runner.
// The README shows the same tests written with node:test and with supertest.

const assert = require('node:assert/strict');
const { createApp, json, httpError } = require('./_mini-express');
const { start } = require('./_mini-express/testing');

// ---------- the app under test, built by a FACTORY ----------
// A function that returns a brand-new app (with its own empty data) means every test starts clean
// and tests can run side by side. Exporting one shared global app is what makes tests depend on each other.
function buildApp({ apiKey = 'k-123' } = {}) {
  const todos = new Map();
  let nextId = 1;
  const app = createApp({ silent: true });

  app.get('/todos', (req, res) => res.json([...todos.values()]));
  app.post('/todos', json(), (req, res) => {
    const title = req.body?.title;
    if (typeof title !== 'string' || title.trim() === '') throw httpError(422, 'title must be a non-empty string');
    const todo = { id: nextId++, title: title.trim(), done: false };
    todos.set(todo.id, todo);
    res.status(201).set('Location', `/todos/${todo.id}`).json(todo);
  });
  app.get('/todos/:id', (req, res) => {
    const todo = todos.get(Number(req.params.id));
    if (!todo) throw httpError(404, `Todo ${req.params.id} not found`);
    res.json(todo);
  });
  app.get('/secret', apiKeyGuard(apiKey), (req, res) => res.json({ secret: 42 }));
  app.get('/boom', () => {
    throw new Error('connection string is postgres://admin:pw@db');
  });

  app.use((req, res, next) => next(httpError(404, `No route for ${req.method} ${req.path}`)));
  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: { message: err.expose ? err.message : 'Internal Server Error' } });
  });
  return app;
}

// A middleware we will also test WITHOUT any server.
function apiKeyGuard(expected) {
  return (req, res, next) => {
    if (req.headers['x-api-key'] !== expected) return next(httpError(401, 'Invalid API key'));
    next();
  };
}

// ---------- a tiny test runner ----------
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok      ${name}`);
  } catch (err) {
    failed++;
    process.exitCode = 1;
    console.log(`FAILED  ${name}\n        ${err.message}`);
  }
}

// start the app on a free port, run the test, ALWAYS close the server (even if an assertion throws)
async function withServer(app, fn) {
  const server = await start(app);
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

async function main() {
  console.log('--- integration tests: real HTTP on port 0');

  await test('GET /todos starts empty', () =>
    withServer(buildApp(), async (api) => {
      const res = await api.get('/todos');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, []);
    }));

  await test('POST /todos creates a todo and sets Location', () =>
    withServer(buildApp(), async (api) => {
      const res = await api.post('/todos', { json: { title: '  write tests ' } });
      assert.equal(res.status, 201);
      assert.equal(res.headers.get('location'), '/todos/1');
      assert.deepEqual(res.json, { id: 1, title: 'write tests', done: false });
      assert.deepEqual((await api.get('/todos')).json.length, 1);
    }));

  await test('each test gets a fresh app (no leftover todos)', () =>
    withServer(buildApp(), async (api) => {
      assert.deepEqual((await api.get('/todos')).json, []);
    }));

  await test('POST with broken JSON is a 400', () =>
    withServer(buildApp(), async (api) => {
      const res = await api.post('/todos', { body: '{oops', headers: { 'content-type': 'application/json' } });
      assert.equal(res.status, 400);
    }));

  await test('POST with an empty title is a 422 with a readable message', () =>
    withServer(buildApp(), async (api) => {
      const res = await api.post('/todos', { json: { title: '   ' } });
      assert.equal(res.status, 422);
      assert.match(res.json.error.message, /title/);
    }));

  await test('unknown todo and unknown route are 404 JSON', () =>
    withServer(buildApp(), async (api) => {
      assert.equal((await api.get('/todos/99')).status, 404);
      const res = await api.get('/nope');
      assert.equal(res.status, 404);
      assert.equal(res.json.error.message, 'No route for GET /nope');
    }));

  await test('a bug returns 500 and does NOT leak the message', () =>
    withServer(buildApp(), async (api) => {
      const res = await api.get('/boom');
      assert.equal(res.status, 500);
      assert.equal(res.json.error.message, 'Internal Server Error');
      assert.ok(!res.text.includes('postgres'));
    }));

  await test('protected route: 401 without the key, 200 with it', () =>
    withServer(buildApp({ apiKey: 'k-123' }), async (api) => {
      assert.equal((await api.get('/secret')).status, 401);
      assert.equal((await api.get('/secret', { headers: { 'x-api-key': 'wrong' } })).status, 401);
      assert.equal((await api.get('/secret', { headers: { 'x-api-key': 'k-123' } })).status, 200);
    }));

  await test('two servers at once do not collide (port 0)', async () => {
    const [a, b] = await Promise.all([start(buildApp()), start(buildApp())]);
    try {
      assert.notEqual(a.base, b.base);
      await a.post('/todos', { json: { title: 'only in A' } });
      assert.equal((await a.get('/todos')).json.length, 1);
      assert.equal((await b.get('/todos')).json.length, 0); // B has its own state
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  console.log('--- unit tests: call the middleware directly with fake req, res and next');

  await test('apiKeyGuard calls next() with no argument for a good key', () => {
    const calls = [];
    apiKeyGuard('k')({ headers: { 'x-api-key': 'k' } }, {}, (...args) => calls.push(args));
    assert.deepEqual(calls, [[]]);
  });

  await test('apiKeyGuard calls next(error) with status 401 for a bad key', () => {
    const calls = [];
    apiKeyGuard('k')({ headers: {} }, {}, (...args) => calls.push(args));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].status, 401);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
}

main();
