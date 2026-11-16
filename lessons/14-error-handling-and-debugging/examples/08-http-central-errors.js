// Central error handling for an HTTP server: handlers throw, ONE function turns errors into responses
// Shows: operational errors become 4xx/503 with a clear body; bugs become a generic 500; validation collects all problems.
// Run: node lessons/14-error-handling-and-debugging/examples/08-http-central-errors.js

const http = require('node:http');

// ---------------------------------------------------------------------------
// Error classes: the statusCode says how the error should look to the client.
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'E_APP', details } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
class NotFoundError extends AppError {
  constructor(what) {
    super(`${what} was not found`, { statusCode: 404, code: 'E_NOT_FOUND' });
  }
}
class ValidationError extends AppError {
  constructor(details) {
    super('The request is not valid', { statusCode: 400, code: 'E_VALIDATION', details });
  }
}

// ---------------------------------------------------------------------------
// Validation: collect EVERY problem, so the client can fix them all in one round trip.
function validateUser(body) {
  const problems = [];
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    problems.push({ field: 'name', message: 'must be a non-empty string' });
  }
  if (!Number.isInteger(body.age) || body.age < 0 || body.age > 150) {
    problems.push({ field: 'age', message: 'must be an integer from 0 to 150' });
  }
  if (problems.length > 0) throw new ValidationError(problems);
  return { name: body.name.trim(), age: body.age };
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError([{ field: 'body', message: 'is not valid JSON' }]);
  }
}

// ---------------------------------------------------------------------------
// The handlers. They only throw. They never write error responses themselves.
const users = new Map([[1, { id: 1, name: 'Ada' }]]);

const routes = {
  'GET /users/1': async () => users.get(1),
  'GET /users/999': async () => {
    throw new NotFoundError('User 999');
  },
  'POST /users': async (req) => {
    const user = validateUser(await readJson(req));
    return { created: user };
  },
  'GET /bug': async () => {
    const settings = undefined;
    return { theme: settings.theme }; // a programmer error: TypeError
  },
  'GET /database': async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    err.code = 'ECONNREFUSED'; // an operational error, but not one of ours
    throw err;
  },
};

// ---------------------------------------------------------------------------
// THE central place. Everything that goes wrong ends up here.
let requestCounter = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handleError(err, res, requestId) {
  // 1. Translate known non-AppError failures into a status.
  let status = 500;
  let body = { error: { code: 'E_INTERNAL', message: 'Something went wrong', requestId } };

  if (err instanceof AppError) {
    status = err.statusCode;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) {
    status = 503; // our dependency is down: tell the client to try again later
    body = { error: { code: 'E_UNAVAILABLE', message: 'A service we depend on is unavailable', requestId } };
  }

  // 2. Log what a developer needs. Real apps log err.stack with a logger; clients never see it.
  if (status >= 500) console.log(`  [server log ${requestId}] ${err.name}: ${err.message}`);

  // 3. Respond, unless a response has already started. Then all we can do is cut the connection.
  if (res.headersSent) return res.destroy(err);
  sendJson(res, status, body);
}

async function dispatch(req, res, requestId) {
  try {
    const handler = routes[`${req.method} ${new URL(req.url, 'http://localhost').pathname}`];
    if (!handler) throw new NotFoundError(`Route ${req.method} ${req.url}`);
    sendJson(res, 200, await handler(req));
  } catch (err) {
    handleError(err, res, requestId);
  }
}

const server = http.createServer((req, res) => {
  requestCounter++;
  // dispatch() has its own try/catch, but handleError itself could fail. The last .catch means a rejection never escapes.
  dispatch(req, res, `req-${requestCounter}`).catch((err) => {
    console.log(`  [last resort] ${err.message}`);
    res.destroy();
  });
});

// ---------------------------------------------------------------------------
async function call(base, method, path, body) {
  const res = await fetch(base + path, { method, body });
  console.log(`${method} ${path} -> ${res.status}`);
  console.log('  ', await res.text());
}

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  try {
    await call(base, 'GET', '/users/1');
    await call(base, 'GET', '/users/999');
    await call(base, 'GET', '/nothing-here');
    await call(base, 'POST', '/users', JSON.stringify({ name: 'Grace', age: 36 }));
    await call(base, 'POST', '/users', JSON.stringify({ name: '', age: 'old' }));
    await call(base, 'POST', '/users', '{not json');
    await call(base, 'GET', '/database');
    await call(base, 'GET', '/bug');

    // fetch only REJECTS when the network fails. An HTTP error status such as 404 or 500 is a normal, resolved response.
    const notFound = await fetch(`${base}/users/999`);
    console.log(`fetch did not throw for the 404: ok=${notFound.ok}, status=${notFound.status}. Check res.ok yourself.`);
    await notFound.text();
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
