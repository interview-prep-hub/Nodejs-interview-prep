// Browser-facing defences: security headers, CORS (bad vs good), cookie flags, CSRF token
// Run: node lessons/20-security-and-crypto/examples/08-headers-cors-cookies-csrf.js
//
// Browsers enforce most of these rules. Node's fetch does not, so this example shows what the
// SERVER sends and checks, and says what a browser would do with it.

const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');

const APP_ORIGIN = 'https://app.example.com';
const sessions = new Map(); // session id -> { user, csrf }

// ---------- 1. Security headers, set by hand (this is what helmet does for you) ----------
function setSecurityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // browsers: HTTPS only, for one year
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff'); // do not guess the type of a response
  res.setHeader('X-Frame-Options', 'DENY'); // older way to forbid framing (clickjacking)
  res.setHeader('Referrer-Policy', 'no-referrer'); // do not leak URLs to other sites
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); // switch off browser features we do not use
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

// ---------- 2. CORS: a wrong version and a right version ----------
function badCors(req, res) {
  // WRONG: copies whatever origin asks, and allows cookies. Every website on earth can now read private data.
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

const ALLOWED_ORIGINS = new Set([APP_ORIGIN]);
function goodCors(req, res) {
  res.setHeader('Vary', 'Origin'); // the answer depends on the Origin header, so caches must keep one copy per origin
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // exactly one origin, taken from OUR list
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

// ---------- 3. Cookies: flags and sessions ----------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionCookie(id) {
  return [
    `__Host-sid=${id}`, // the __Host- prefix makes browsers require Secure, Path=/ and NO Domain attribute
    'HttpOnly', // JavaScript cannot read it, so an XSS bug cannot steal it
    'Secure', // sent over HTTPS only
    'SameSite=Lax', // not sent on cross-site POST requests or sub-requests
    'Path=/',
    'Max-Age=3600', // one hour
  ].join('; ');
}

// ---------- 4. CSRF: a secret token the attacker's page cannot know ----------
function tokensMatch(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function handler(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const session = sessions.get(parseCookies(req.headers.cookie)['__Host-sid']);

  if (url.pathname === '/api/good-cors') {
    goodCors(req, res);
    return res.end('private data');
  }
  if (url.pathname === '/api/bad-cors') {
    badCors(req, res);
    return res.end('private data');
  }
  if (url.pathname === '/login' && req.method === 'POST') {
    const id = crypto.randomBytes(32).toString('base64url'); // unguessable: 256 bits
    sessions.set(id, { user: 'ann', csrf: crypto.randomBytes(32).toString('base64url') });
    res.setHeader('Set-Cookie', sessionCookie(id));
    return res.end('logged in');
  }
  if (url.pathname === '/csrf-token' && session) {
    return res.end(session.csrf); // the page gets this with a normal request and sends it back in a header
  }
  if (url.pathname === '/transfer' && req.method === 'POST') {
    if (!session) {
      res.statusCode = 401;
      return res.end('not logged in');
    }
    const origin = req.headers.origin;
    if (origin && origin !== APP_ORIGIN) {
      res.statusCode = 403;
      return res.end('bad origin');
    }
    if (!tokensMatch(req.headers['x-csrf-token'], session.csrf)) {
      res.statusCode = 403;
      return res.end('missing or wrong CSRF token');
    }
    return res.end('transfer done');
  }
  res.statusCode = 404;
  res.end();
}

async function main() {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log('--- 1. security headers on every response ---');
  const home = await fetch(`${base}/`);
  for (const [name, value] of home.headers) {
    if (['date', 'connection', 'keep-alive', 'content-length'].includes(name)) continue;
    console.log(`${name}: ${value}`);
  }

  console.log('\n--- 2. CORS ---');
  for (const path of ['/api/bad-cors', '/api/good-cors']) {
    for (const origin of [APP_ORIGIN, 'https://evil.example']) {
      const res = await fetch(base + path, { headers: { Origin: origin } });
      await res.text();
      const allow = res.headers.get('access-control-allow-origin') ?? '(none)';
      console.log(`${path.padEnd(15)} from ${origin.padEnd(24)} -> Allow-Origin: ${allow}, credentials: ${res.headers.get('access-control-allow-credentials') ?? '-'}`);
    }
  }
  console.log('(a browser only gives the page the response when Allow-Origin matches its own origin)');

  console.log('\n--- 3. session cookie flags ---');
  const login = await fetch(`${base}/login`, { method: 'POST' });
  const setCookie = login.headers.get('set-cookie');
  console.log(setCookie.replace(/(__Host-sid=)[\w-]{10}[\w-]*/, '$1<43 random characters>'));
  const cookie = setCookie.split(';')[0]; // what the browser would send back

  console.log('\n--- 4. CSRF ---');
  const post = (headers) => fetch(`${base}/transfer`, { method: 'POST', headers: { Cookie: cookie, ...headers } });
  let res = await fetch(`${base}/transfer`, { method: 'POST' });
  console.log('no cookie                :', res.status, await res.text());
  res = await post({});
  console.log('cookie only (forged form):', res.status, await res.text());
  res = await post({ Origin: 'https://evil.example' });
  console.log('cookie, evil Origin      :', res.status, await res.text());
  const token = await (await fetch(`${base}/csrf-token`, { headers: { Cookie: cookie } })).text();
  res = await post({ 'X-CSRF-Token': token, Origin: APP_ORIGIN });
  console.log('cookie + token + Origin  :', res.status, await res.text());

  server.close();
  server.closeAllConnections();
}

main();
