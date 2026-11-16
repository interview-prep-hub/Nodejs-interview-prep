// Validation middleware and an authentication/authorization pattern (signed token, req.user, role guard)
// Run: node lessons/26-frameworks-and-middleware/examples/09-validation-and-auth.js
//
// Everything here is written by hand with core modules so you can see how it works.
// In a real project use a schema library for validation (Zod, Joi, Ajv) and a reviewed library
// for tokens (jose or jsonwebtoken). Never invent your own crypto for production.

const crypto = require('node:crypto');
const { createApp, json, httpError } = require('./_mini-express');
const { start, line } = require('./_mini-express/testing');

// =====================================================================================
// Part A: validation
// A rule is a function: input -> { value } (clean) or { error } (a message).
// =====================================================================================
const str = ({ min = 1, max = 200 } = {}) => (input) => {
  if (typeof input !== 'string') return { error: 'must be a string' };
  const value = input.trim();
  if (value.length < min) return { error: `must have at least ${min} character${min === 1 ? '' : 's'}` };
  if (value.length > max) return { error: `must have at most ${max} characters` };
  return { value };
};

// Accepts 5 and "5" (query strings and path parameters are always strings).
const int = ({ min = -Infinity, max = Infinity } = {}) => (input) => {
  const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
  if (!Number.isInteger(n)) return { error: 'must be a whole number' };
  if (n < min) return { error: `must be at least ${min}` };
  if (n > max) return { error: `must be at most ${max}` };
  return { value: n };
};

// If the field is missing, use the fallback instead of failing.
const optional = (rule, fallback) => (input) => (input === undefined ? { value: fallback } : rule(input));

// validate({ body: {...}, query: {...}, params: {...} })
// Only the fields named in the schema survive (a whitelist). Clean values go to req.valid.<part>.
// Why not overwrite req.query? In Express 5 (and in our mini version) req.query is a getter,
// so an assignment would be ignored. Keeping validated data in its own place is safer anyway.
function validate(schema) {
  return (req, res, next) => {
    const issues = [];
    req.valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (!schema[part]) continue;
      const input = req[part] ?? {}; // req.body is undefined when no parser ran
      if (typeof input !== 'object' || Array.isArray(input)) {
        issues.push({ in: part, path: '', message: 'must be an object' });
        continue;
      }
      const clean = {};
      for (const [field, rule] of Object.entries(schema[part])) {
        const result = rule(input[field]);
        if (result.error) issues.push({ in: part, path: field, message: result.error });
        else if (result.value !== undefined) clean[field] = result.value;
      }
      req.valid[part] = clean;
    }
    if (issues.length > 0) return next(Object.assign(httpError(422, 'Validation failed'), { issues }));
    next();
  };
}

// =====================================================================================
// Part B: authentication. A signed token in the shape of a JWT (HS256), built with node:crypto.
// "header.payload.signature", each part base64url. The signature is HMAC-SHA256 of "header.payload".
// =====================================================================================
const b64url = (text) => Buffer.from(text).toString('base64url');
const unb64url = (text) => Buffer.from(text, 'base64url').toString('utf8');

function signToken(payload, secret, { expiresInSeconds = 3600, now = Date.now } = {}) {
  const issuedAt = Math.floor(now() / 1000);
  const body = { ...payload, iat: issuedAt, exp: issuedAt + expiresInSeconds };
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(body))}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

function verifyToken(token, secret, { now = Date.now } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  // The token must NOT choose the algorithm. "alg: none" attacks work against code that obeys the header.
  if (JSON.parse(unb64url(h)).alg !== 'HS256') throw new Error('unsupported algorithm');
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  // timingSafeEqual needs equal lengths and takes the same time however many bytes match
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  const payload = JSON.parse(unb64url(p));
  if (typeof payload.exp === 'number' && payload.exp <= Math.floor(now() / 1000)) throw new Error('token expired');
  return payload;
}

// The middleware: read "Authorization: Bearer <token>", verify, attach req.user.
function authenticate(secret, { optional: isOptional = false, now } = {}) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      if (isOptional) return next(); // anonymous is allowed, req.user stays undefined
      res.setHeader('WWW-Authenticate', 'Bearer');
      return next(httpError(401, 'Authentication required'));
    }
    try {
      req.user = verifyToken(token, secret, { now });
    } catch {
      // Same message for every failure: do not tell an attacker whether the signature or the date was wrong.
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return next(httpError(401, 'Invalid or expired token'));
    }
    next();
  };
}

// Authorization (what may this user do?) is a separate step from authentication (who is this?).
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(httpError(403, 'You are not allowed to do this')); // known user, not allowed
  next();
};

// =====================================================================================
// The app
// =====================================================================================
const SECRET = 'demo-secret-do-not-use-in-production';
const clock = { now: Date.UTC(2026, 0, 1) }; // a fake clock keeps the tokens (and the output) identical on every run
const now = () => clock.now;
const USERS = {
  ada: { id: '1', password: 'lovelace', role: 'user' }, // real code stores a password HASH (lesson 20)
  root: { id: '2', password: 'toor', role: 'admin' },
};

function buildApp() {
  const app = createApp({ silent: true });
  const auth = authenticate(SECRET, { now });

  app.post('/login', json(), validate({ body: { name: str(), password: str({ max: 100 }) } }), (req, res) => {
    const { name, password } = req.valid.body;
    const user = USERS[name];
    if (!user || user.password !== password) throw httpError(401, 'Wrong name or password');
    res.json({ token: signToken({ sub: user.id, name, role: user.role }, SECRET, { now }) });
  });

  app.get('/public', authenticate(SECRET, { optional: true, now }), (req, res) => {
    res.json({ hello: req.user ? req.user.name : 'stranger' });
  });
  app.get('/me', auth, (req, res) => res.json({ user: req.user }));
  app.get('/admin/stats', auth, requireRole('admin'), (req, res) => res.json({ users: 2 }));
  app.get('/users/:id/profile', auth, (req, res) => {
    // "ownership" check: a user may read their own profile, an admin may read any
    if (req.user.sub !== req.params.id && req.user.role !== 'admin') throw httpError(403, 'Not your profile');
    res.json({ profileOf: req.params.id });
  });

  app.post(
    '/products',
    auth,
    json(),
    validate({
      body: {
        name: str({ max: 40 }),
        price: int({ min: 0, max: 100000 }),
        stock: optional(int({ min: 0 }), 0),
      },
    }),
    (req, res) => res.status(201).json({ created: req.valid.body }),
  );
  app.get('/products', validate({ query: { page: optional(int({ min: 1 }), 1), limit: optional(int({ min: 1, max: 50 }), 10) } }), (req, res) => {
    res.json({ page: req.valid.query.page, limit: req.valid.query.limit, types: [typeof req.valid.query.page, typeof req.query.page] });
  });

  app.use((req, res, next) => next(httpError(404, 'Not Found')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? 500;
    res.status(status).json({ error: { message: err.expose ? err.message : 'Internal Server Error', issues: err.issues } });
  });
  return app;
}

async function main() {
  const server = await start(buildApp());
  const show = (label, res) => console.log(label.padEnd(34), line(res));
  const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

  console.log('--- login and the token');
  const login = await server.post('/login', { json: { name: 'ada', password: 'lovelace' } });
  const token = login.json.token;
  const [h, p] = token.split('.');
  console.log('token has 3 parts'.padEnd(34), token.split('.').length === 3);
  console.log('header'.padEnd(34), unb64url(h));
  console.log('payload'.padEnd(34), unb64url(p));
  show('wrong password', await server.post('/login', { json: { name: 'ada', password: 'nope' } }));
  show('missing fields', await server.post('/login', { json: { name: '' } }));
  const adminToken = (await server.post('/login', { json: { name: 'root', password: 'toor' } })).json.token;

  console.log('--- authentication: who are you?');
  show('GET /public (anonymous)', await server.get('/public'));
  show('GET /public (logged in)', await server.get('/public', bearer(token)));
  let res = await server.get('/me');
  show('GET /me without token', res);
  console.log(' '.repeat(34), 'WWW-Authenticate:', res.headers.get('www-authenticate'));
  show('GET /me with token', await server.get('/me', bearer(token)));

  // Change "role":"user" to "role":"admin" inside the payload but keep the old signature.
  const forgedPayload = b64url(JSON.stringify({ ...JSON.parse(unb64url(p)), role: 'admin' }));
  show('forged payload, old signature', await server.get('/me', bearer(`${h}.${forgedPayload}.${token.split('.')[2]}`)));
  const noneToken = `${b64url('{"alg":"none","typ":"JWT"}')}.${forgedPayload}.`;
  show('"alg":"none" token', await server.get('/me', bearer(noneToken)));
  show('garbage token', await server.get('/me', bearer('not-a-token')));

  console.log('--- authorization: what may you do?');
  show('user -> /admin/stats', await server.get('/admin/stats', bearer(token)));
  show('admin -> /admin/stats', await server.get('/admin/stats', bearer(adminToken)));
  show('user 1 -> /users/1/profile', await server.get('/users/1/profile', bearer(token)));
  show('user 1 -> /users/2/profile', await server.get('/users/2/profile', bearer(token)));
  show('admin -> /users/1/profile', await server.get('/users/1/profile', bearer(adminToken)));

  console.log('--- validation');
  show('valid product', await server.post('/products', { ...bearer(token), json: { name: '  Keyboard ', price: '49', extra: 'dropped?' } }));
  show('invalid product', await server.post('/products', { ...bearer(token), json: { name: 7, price: -5, stock: 1.5 } }));
  show('no body at all', await server.post('/products', bearer(token)));
  show('GET /products?page=2&limit=5', await server.get('/products?page=2&limit=5'));
  show('GET /products (defaults)', await server.get('/products'));
  show('GET /products?page=zero&limit=500', await server.get('/products?page=zero&limit=500'));

  console.log('--- time passes: the token expires after 1 hour');
  clock.now += 2 * 60 * 60 * 1000;
  show('GET /me two hours later', await server.get('/me', bearer(token)));

  console.log('--- sanity check against the well-known jwt.io example token');
  const known =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  console.log('verified payload'.padEnd(34), JSON.stringify(verifyToken(known, 'your-256-bit-secret')));

  await server.close();
}

main();
