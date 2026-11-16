// REST API conventions in one small in-memory API: resources, status codes, cursor pagination,
// problem details (RFC 9457), idempotency keys, 404/405/500 handling. No server needed: handle(req) is a pure function.
// Run: node lessons/25-architecture-and-patterns/examples/09-api-design.js

const books = [
  { id: 1, title: 'Dune', genre: 'scifi', year: 1965 },
  { id: 2, title: 'Neuromancer', genre: 'scifi', year: 1984 },
  { id: 3, title: 'Emma', genre: 'classic', year: 1815 },
  { id: 4, title: 'Foundation', genre: 'scifi', year: 1951 },
  { id: 5, title: 'Hyperion', genre: 'scifi', year: 1989 },
];
let nextId = 6;

// ---------- response helpers
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body });

// RFC 9457 "problem details": one error shape for the whole API.
function problem({ status, title, detail, type = 'about:blank', instance, headers = {}, ...extensions }) {
  return {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
    body: { type, title, status, detail, instance, ...extensions },
  };
}

// ---------- cursors: opaque to the client, so we are free to change what is inside
const encodeCursor = (id) => Buffer.from(JSON.stringify({ id })).toString('base64url');
function decodeCursor(cursor) {
  try {
    const { id } = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

// ---------- handlers
function listBooks(req) {
  const { genre, after } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 2, 1), 50); // default 2, never more than 50
  let rows = books.filter((b) => !genre || b.genre === genre); // filtering: ?genre=scifi
  if (after !== undefined) {
    const lastId = decodeCursor(after);
    if (lastId === null) return problem({ status: 400, title: 'Bad Request', detail: 'the "after" cursor is not valid', instance: req.path });
    rows = rows.filter((b) => b.id > lastId); // keyset pagination: "rows after the last one you saw"
  }
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const nextCursor = hasMore ? encodeCursor(page.at(-1).id) : null;
  const base = `/v1/books?${genre ? `genre=${genre}&` : ''}limit=${limit}`;
  return json(200, {
    data: page,
    page: { limit, nextCursor },
    _links: { self: base, next: hasMore ? `${base}&after=${nextCursor}` : null }, // a taste of HATEOAS
  });
}

function getBook(req) {
  const book = books.find((b) => b.id === Number(req.params.id));
  if (!book) return problem({ status: 404, title: 'Not Found', detail: `book ${req.params.id} does not exist`, instance: req.path });
  return json(200, book);
}

function createBook(req) {
  const { title, genre, year } = req.body ?? {};
  const errors = [];
  if (typeof title !== 'string' || !title.trim()) errors.push({ field: 'title', message: 'is required' });
  if (!Number.isInteger(year)) errors.push({ field: 'year', message: 'must be a whole number' });
  if (errors.length) {
    return problem({
      status: 422,
      type: 'https://api.example.com/problems/validation-error',
      title: 'Your request parameters are invalid',
      detail: `${errors.length} field(s) failed validation`,
      instance: req.path,
      errors, // an "extension member": extra fields are allowed
    });
  }
  const book = { id: nextId++, title: title.trim(), genre: genre ?? 'unknown', year };
  books.push(book);
  return json(201, book, { location: `/v1/books/${book.id}` }); // 201 + Location of the new resource
}

function deleteBook(req) {
  const index = books.findIndex((b) => b.id === Number(req.params.id));
  if (index === -1) return problem({ status: 404, title: 'Not Found', detail: `book ${req.params.id} does not exist`, instance: req.path });
  books.splice(index, 1);
  return { status: 204, headers: {}, body: undefined }; // success, nothing to send back
}

// Idempotency keys make a POST safe to retry: same key + same body = same result, side effect happens once.
const savedByKey = new Map();
let chargesMade = 0;
function createPayment(req) {
  const key = req.headers['idempotency-key'];
  if (!key) return problem({ status: 400, title: 'Bad Request', detail: 'the Idempotency-Key header is required', instance: req.path });
  const fingerprint = JSON.stringify(req.body);
  const saved = savedByKey.get(key);
  if (saved) {
    if (saved.fingerprint !== fingerprint) {
      return problem({ status: 422, title: 'Idempotency key reused', detail: 'this key was first used with a different request body', instance: req.path });
    }
    return { ...saved.response, headers: { ...saved.response.headers, 'idempotent-replayed': 'true' } };
  }
  chargesMade++; // the real side effect (charging a card) happens only on the first request with this key
  const response = json(201, { id: `pay_${chargesMade}`, amount: req.body.amount });
  savedByKey.set(key, { fingerprint, response });
  return response;
}

// ---------- routing
const routes = [
  ['GET', '/v1/books', listBooks],
  ['POST', '/v1/books', createBook],
  ['GET', '/v1/books/:id', getBook],
  ['DELETE', '/v1/books/:id', deleteBook],
  ['POST', '/v1/payments', createPayment],
  ['GET', '/v1/boom', () => { throw new Error('connection string: postgres://admin:secret@db'); }],
];

function matchPath(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = a[i];
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

function handle(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const request = { ...req, path: url.pathname, query: Object.fromEntries(url.searchParams) };
    const allowed = [];
    for (const [method, pattern, handler] of routes) {
      const params = matchPath(pattern, url.pathname);
      if (!params) continue;
      if (method !== req.method) {
        allowed.push(method);
        continue;
      }
      return handler({ ...request, params });
    }
    if (allowed.length) {
      return problem({ status: 405, title: 'Method Not Allowed', detail: `${req.method} is not allowed here`, instance: url.pathname, headers: { allow: allowed.join(', ') } });
    }
    return problem({ status: 404, title: 'Not Found', detail: `no route for ${url.pathname}`, instance: url.pathname });
  } catch {
    // Log the real error on the server; never send internals (like that connection string) to the client.
    return problem({ status: 500, title: 'Internal Server Error', detail: 'something went wrong on our side' });
  }
}

// ---------- a tiny driver that prints each exchange
function call(method, url, { headers = {}, body } = {}) {
  const res = handle({ method, url, headers, body });
  const extra = ['location', 'allow', 'idempotent-replayed'].filter((h) => res.headers[h]).map((h) => `${h}: ${res.headers[h]}`);
  console.log(`${method} ${url}`);
  console.log(`  -> ${res.status} ${res.headers['content-type'] ?? '(no body)'}${extra.length ? ' | ' + extra.join(' | ') : ''}`);
  if (res.body !== undefined) console.log('  ', JSON.stringify(res.body));
  return res;
}

console.log('=== collection, filtering and cursor pagination');
const first = call('GET', '/v1/books?genre=scifi&limit=2');
call('GET', `/v1/books?genre=scifi&limit=2&after=${first.body.page.nextCursor}`);
call('GET', '/v1/books?after=not-a-cursor');

console.log('\n=== create, read, delete');
call('POST', '/v1/books', { body: { title: 'Solaris', genre: 'scifi', year: 1961 } });
call('POST', '/v1/books', { body: { year: 'soon' } });
call('GET', '/v1/books/6');
call('DELETE', '/v1/books/6');
call('DELETE', '/v1/books/6');

console.log('\n=== wrong route, wrong method, server bug');
call('GET', '/v1/shelves');
call('PUT', '/v1/books');
call('GET', '/v1/boom');

console.log('\n=== idempotency key');
call('POST', '/v1/payments', { body: { amount: 500 } });
call('POST', '/v1/payments', { headers: { 'idempotency-key': 'abc-1' }, body: { amount: 500 } });
call('POST', '/v1/payments', { headers: { 'idempotency-key': 'abc-1' }, body: { amount: 500 } });
call('POST', '/v1/payments', { headers: { 'idempotency-key': 'abc-1' }, body: { amount: 999 } });
console.log('charges actually made:', chargesMade);
