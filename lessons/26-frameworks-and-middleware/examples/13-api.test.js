// Testing a framework app with node:test: a fresh app and a fresh port (0) for every test
// Run: node --test lessons/26-frameworks-and-middleware/examples/13-api.test.js
//
// The same ideas as example 11, but with the built-in test runner (lesson 16) instead of a hand-made one.
// With real Express you would write the same tests; only buildApp() and the way you call the app change
// (the "supertest" package can replace start() and fetch).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, json, httpError } = require('./_mini-express');
const { start } = require('./_mini-express/testing');

// buildApp() returns a brand-new app with its own empty data every time it is called.
// It never calls listen(): the test decides how and where to listen.
function buildApp() {
  const todos = [];
  const app = createApp({ silent: true });

  app.get('/ping', (req, res) => res.json({ pong: true }));
  app.get('/todos', (req, res) => res.json(todos));
  app.post('/todos', json(), (req, res) => {
    const title = req.body?.title;
    if (typeof title !== 'string' || title.trim() === '') throw httpError(422, 'title must not be empty');
    const todo = { id: todos.length + 1, title: title.trim() };
    todos.push(todo);
    res.status(201).set('Location', `/todos/${todo.id}`).json(todo);
  });
  app.get('/bug', () => {
    throw new Error('secret database detail');
  });

  app.use((req, res, next) => next(httpError(404, `No route for ${req.method} ${req.path}`))); // 404, after the routes
  app.use((err, req, res, next) => {
    // error handler, last
    res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  });
  return app;
}

describe('the todo API', () => {
  let api;
  beforeEach(async () => {
    api = await start(buildApp()); // a fresh app on a fresh port for every test
  });
  afterEach(async () => {
    await api.close(); // always close the server, or the test run never ends
  });

  it('answers GET /ping', async () => {
    const res = await api.get('/ping');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { pong: true });
  });

  it('creates a todo, sets Location, and lists it', async () => {
    const created = await api.post('/todos', { json: { title: '  write tests  ' } });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('location'), '/todos/1');
    assert.deepEqual(created.json, { id: 1, title: 'write tests' });

    const list = await api.get('/todos');
    assert.deepEqual(list.json, [{ id: 1, title: 'write tests' }]);
  });

  it('starts empty again, because every test gets a fresh app', async () => {
    const list = await api.get('/todos');
    assert.deepEqual(list.json, []);
  });

  it('answers 422 for an empty title and 400 for broken JSON', async () => {
    const empty = await api.post('/todos', { json: { title: '   ' } });
    assert.equal(empty.status, 422);
    assert.deepEqual(empty.json, { error: 'title must not be empty' });

    const broken = await api.post('/todos', { body: '{oops', headers: { 'content-type': 'application/json' } });
    assert.equal(broken.status, 400);
  });

  it('answers unknown routes with JSON, not with an HTML page', async () => {
    const res = await api.get('/nothing');
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: 'No route for GET /nothing' });
  });

  it('turns a bug into a 500 and does not leak the message', async () => {
    const res = await api.get('/bug');
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'Internal Server Error' });
    assert.ok(!res.text.includes('secret'));
  });
});

describe('a middleware on its own', () => {
  it('can be tested with a fake req, res and next, without any server', () => {
    const requireKey = (req, res, next) => (req.headers['x-key'] === 'k1' ? next() : next(httpError(401, 'bad key')));

    let received = 'next was not called';
    requireKey({ headers: { 'x-key': 'k1' } }, {}, (arg) => (received = arg));
    assert.equal(received, undefined); // next() with no argument means: carry on

    requireKey({ headers: {} }, {}, (arg) => (received = arg));
    assert.equal(received.status, 401); // next(error) means: stop and handle this error
  });
});
