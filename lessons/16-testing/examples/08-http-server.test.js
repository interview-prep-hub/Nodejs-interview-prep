// Testing an HTTP server for real: listen on port 0, call it with fetch(), close it after each test
// Run: node --test lessons/16-testing/examples/08-http-server.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createTodoServer } = require('./_lib/todo-api.js');

// Start a fresh server for one test. Port 0 means "any free port", so tests never fight over a port.
// t.after() registers the cleanup right next to the code that needs it.
async function startServer(t, todos = []) {
  const server = createTodoServer({ todos });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(() => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections(); // safety net: an unread big response would keep a socket busy
    return closed;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signal = () => AbortSignal.timeout(2000); // a hung server fails the test instead of hanging it
  return {
    baseUrl,
    get: (path) => fetch(baseUrl + path, { signal: signal() }),
    send: (method, path, body) =>
      fetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: signal(),
      }),
  };
}

describe('GET routes', () => {
  it('GET /health answers 200 with a JSON body', async (t) => {
    const api = await startServer(t);

    const res = await api.get('/health');

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('GET /todos lists what the server was started with', async (t) => {
    const api = await startServer(t, [{ id: 1, title: 'write tests', done: false }]);

    const res = await api.get('/todos');

    assert.deepEqual(await res.json(), [{ id: 1, title: 'write tests', done: false }]);
  });

  it('GET /todos/:id returns 404 for an unknown id', async (t) => {
    const api = await startServer(t);

    const res = await api.get('/todos/99');

    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  });

  it('an unknown path is a 404 too', async (t) => {
    const api = await startServer(t);

    const res = await api.get('/nope');

    assert.equal(res.status, 404);
    await res.arrayBuffer(); // always read (or cancel) the body so the connection can be reused and closed
  });
});

describe('POST /todos', () => {
  it('creates a todo, answers 201 and a Location header', async (t) => {
    const api = await startServer(t);

    const res = await api.send('POST', '/todos', { title: '  buy milk  ' });

    assert.equal(res.status, 201);
    assert.equal(res.headers.get('location'), '/todos/1');
    assert.deepEqual(await res.json(), { id: 1, title: 'buy milk', done: false });
  });

  it('the new todo can be read back (a small integration test)', async (t) => {
    const api = await startServer(t);
    await (await api.send('POST', '/todos', { title: 'first' })).json();

    const res = await api.get('/todos/1');

    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, 'first');
  });

  it('answers 400 when the title is missing', async (t) => {
    const api = await startServer(t);

    const res = await api.send('POST', '/todos', { done: true });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'title is required' });
  });

  it('answers 400 for a body that is not valid JSON', async (t) => {
    const api = await startServer(t);

    const res = await api.send('POST', '/todos', '{ this is not json');

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid JSON' });
  });

  it('answers 405 and an Allow header for other methods', async (t) => {
    const api = await startServer(t);

    const res = await api.send('DELETE', '/todos');

    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, POST');
    await res.arrayBuffer();
  });
});

describe('test setup', () => {
  it('every test gets its own server on its own port', async (t) => {
    const first = await startServer(t);
    const second = await startServer(t);

    assert.notEqual(first.baseUrl, second.baseUrl);
  });

  it('a closed server refuses connections', async (t) => {
    const api = await startServer(t);
    const server = createTodoServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const deadUrl = `http://127.0.0.1:${server.address().port}`;
    server.close();
    await once(server, 'close');

    // fetch rejects with a generic "fetch failed" TypeError; the real reason is in error.cause
    await assert.rejects(fetch(deadUrl + '/health'), (error) => {
      assert.equal(error.message, 'fetch failed');
      assert.equal(error.cause.code, 'ECONNREFUSED');
      return true;
    });
    assert.equal((await api.get('/health')).status, 200); // the other server is unaffected
  });
});
