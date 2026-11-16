// A hand-rolled REST API: routing table, JSON helpers, safe body reading, 404 / 405 / 422 / 500
// Run: node lessons/12-http-and-networking/examples/04-router-and-json.js
//
// This is a tiny version of what Express or Fastify do for you.

const http = require('node:http');
const { once } = require('node:events');

const BODY_LIMIT = 1024; // bytes. Real APIs pick a limit that fits their data.

// An error that knows which HTTP status it should become.
class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// ---------- helpers ----------

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), // bytes, not characters
    ...headers,
  });
  res.end(body);
}

// Read the request body as a stream, count the bytes, stop when it gets too big.
async function readJson(req, limit = BODY_LIMIT) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  // Cheap early check: the client announced a size that is already too big.
  if (Number(req.headers['content-length']) > limit) {
    throw new HttpError(413, 'Body too large', { Connection: 'close' });
  }
  // The header can be missing (chunked upload) or a lie, so count the real bytes too.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large', { Connection: 'close' });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

// Valid JSON is not always an object: null, 5, "text" and [1, 2] are all valid JSON too.
async function readObject(req) {
  const body = await readJson(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'Body must be a JSON object');
  }
  return body;
}

// ---------- the routing table ----------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  // "/todos/:id" becomes the regular expression ^/todos/([^/]+)/?$ and keys = ['id']
  const source = pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
}

// ---------- the "database" and the handlers ----------

const todos = new Map();
let nextId = 1;

function findTodo(params) {
  const todo = todos.get(Number(params.id));
  if (!todo) throw new HttpError(404, `Todo ${params.id} not found`);
  return todo;
}

function checkTitle(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(422, 'title must be a non-empty string');
  }
  return value.trim();
}

route('GET', '/todos', ({ res, url }) => {
  let list = [...todos.values()];
  if (url.searchParams.has('done')) {
    const wanted = url.searchParams.get('done') === 'true';
    list = list.filter((todo) => todo.done === wanted);
  }
  sendJson(res, 200, list);
});

route('POST', '/todos', async ({ req, res }) => {
  const body = await readObject(req);
  const todo = { id: nextId++, title: checkTitle(body.title), done: false };
  todos.set(todo.id, todo);
  sendJson(res, 201, todo, { Location: `/todos/${todo.id}` });
});

route('GET', '/todos/:id', ({ res, params }) => sendJson(res, 200, findTodo(params)));

route('PUT', '/todos/:id', async ({ req, res, params }) => {
  const current = findTodo(params);
  const body = await readObject(req);
  if (typeof body.done !== 'boolean') throw new HttpError(422, 'done must be true or false');
  const replaced = { id: current.id, title: checkTitle(body.title), done: body.done }; // replace everything
  todos.set(current.id, replaced);
  sendJson(res, 200, replaced);
});

route('PATCH', '/todos/:id', async ({ req, res, params }) => {
  const current = findTodo(params);
  const body = await readObject(req);
  const updated = { ...current }; // change only the fields that were sent
  if ('title' in body) updated.title = checkTitle(body.title);
  if ('done' in body) updated.done = Boolean(body.done);
  todos.set(current.id, updated);
  sendJson(res, 200, updated);
});

route('DELETE', '/todos/:id', ({ res, params }) => {
  const todo = findTodo(params);
  todos.delete(todo.id);
  res.writeHead(204).end(); // 204 No Content: success, nothing to send
});

route('GET', '/crash', () => {
  throw new Error('database is down'); // a bug or an outage: the client must not see this text
});

// ---------- the server: find the route, run it, turn errors into responses ----------

function sendError(res, err) {
  if (res.headersSent) {
    res.destroy(); // too late to change the status, so cut the connection
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message }, err.headers);
  } else {
    console.log('  (server log) unexpected error:', err.message); // log the details for yourself
    sendJson(res, 500, { error: 'Internal Server Error' }); // tell the client nothing useful to an attacker
  }
}

const server = http.createServer(async (req, res) => {
  // An async handler returns a promise that http ignores, so ALWAYS catch inside.
  try {
    const url = new URL(req.url, 'http://localhost');
    const methodsForThisPath = [];
    for (const r of routes) {
      const match = r.regex.exec(url.pathname);
      if (!match) continue;
      if (r.method !== req.method) {
        methodsForThisPath.push(r.method);
        continue;
      }
      let params;
      try {
        params = Object.fromEntries(r.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
      } catch {
        throw new HttpError(400, 'Bad percent-encoding in the URL');
      }
      await r.handler({ req, res, url, params });
      return;
    }
    if (methodsForThisPath.length > 0) {
      throw new HttpError(405, 'Method not allowed', { Allow: methodsForThisPath.join(', ') });
    }
    throw new HttpError(404, 'Route not found');
  } catch (err) {
    sendError(res, err);
  }
});

// ---------- the demo client ----------

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(label, method, path, { json, body, headers } = {}) {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    console.log(label);
    const res = await fetch(base + path, init);
    const text = await res.text();
    const extra = ['location', 'allow']
      .filter((name) => res.headers.has(name))
      .map((name) => `${name}: ${res.headers.get(name)}`)
      .join(', ');
    console.log(`  ${method} ${path} -> ${res.status}${extra ? ` [${extra}]` : ''} ${text}`);
  }

  console.log('--- creating, reading, changing, deleting');
  await call('create (POST)', 'POST', '/todos', { json: { title: 'learn http' } });
  await call('POST again: a second todo, so POST is not idempotent', 'POST', '/todos', { json: { title: 'learn http' } });
  await call('list', 'GET', '/todos');
  await call('read one', 'GET', '/todos/1');
  await call('PUT (replace)', 'PUT', '/todos/1', { json: { title: 'learn http well', done: true } });
  await call('PUT again: same request, same state, so PUT is idempotent', 'PUT', '/todos/1', {
    json: { title: 'learn http well', done: true },
  });
  await call('PATCH (change one field)', 'PATCH', '/todos/2', { json: { done: true } });
  await call('filter with a query string', 'GET', '/todos?done=true');
  await call('DELETE', 'DELETE', '/todos/2');
  await call('DELETE again: the state is the same (gone), the status differs', 'DELETE', '/todos/2');

  console.log('--- errors');
  await call('unknown path -> 404', 'GET', '/nothing');
  await call('known path, wrong method -> 405 + Allow', 'DELETE', '/todos');
  await call('not JSON -> 400', 'POST', '/todos', { body: '{oops', headers: { 'content-type': 'application/json' } });
  await call('wrong Content-Type -> 415', 'POST', '/todos', { body: 'title=x', headers: { 'content-type': 'text/plain' } });
  await call('body over the limit -> 413', 'POST', '/todos', { json: { title: 'x'.repeat(2000) } });
  await call('valid JSON, invalid data -> 422', 'POST', '/todos', { json: { title: '   ' } });
  await call('valid JSON but not an object -> 422', 'PATCH', '/todos/1', {
    body: 'null',
    headers: { 'content-type': 'application/json' },
  });
  await call('bad percent-encoding -> 400', 'GET', '/todos/%E0%A4%A');
  await call('a bug in a handler -> 500', 'GET', '/crash');

  server.close();
  server.closeAllConnections();
}

main();
