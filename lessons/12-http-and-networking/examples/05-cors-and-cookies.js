// CORS with a preflight handler, and cookies (parse, set, sign, clear), all written by hand
// Run: node lessons/12-http-and-networking/examples/05-cors-and-cookies.js
//
// CORS is enforced by BROWSERS. Node's fetch never blocks anything, so below we only look
// at the headers and say what a browser would do with them.

const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');

// ============================ CORS ============================

const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

// Returns true when the request was a preflight and is already answered.
function handleCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return false; // not a cross-origin browser call (curl, server to server, same-origin GET)

  res.setHeader('Vary', 'Origin'); // the answer depends on Origin, so caches must keep copies per origin
  const isPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'];

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // echo ONE origin; "*" cannot be used with cookies
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // let the page send and receive cookies
    if (isPreflight) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600'); // the browser may remember this answer for 10 minutes
    } else {
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id'); // headers JavaScript may read
    }
  }
  if (isPreflight) {
    res.writeHead(204).end(); // a preflight never reaches your normal route code
    return true;
  }
  return false;
}

// ============================ Cookies ============================

// Request header "Cookie: a=1; b=2" -> { a: '1', b: '2' }
function parseCookies(header = '') {
  const jar = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value if it is not valid percent-encoding
    }
    if (!(name in jar)) jar[name] = value; // the first one wins
  }
  return jar;
}

// Build the value of a Set-Cookie header.
function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly'); // JavaScript in the page cannot read it
  if (options.secure) parts.push('Secure'); // only sent over https
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`); // Strict, Lax or None
  return parts.join('; ');
}

// Signed cookies: "value.signature". Anyone can read the value, nobody can change it.
const SECRET = 'demo-secret-do-not-use-in-real-life';
const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
const signed = (value) => `${value}.${sign(value)}`;
function unsign(text = '') {
  const dot = text.lastIndexOf('.');
  if (dot === -1) return null;
  const value = text.slice(0, dot);
  const given = Buffer.from(text.slice(dot + 1));
  const expected = Buffer.from(sign(value));
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected); // constant-time compare
  return ok ? value : null;
}

const sessions = new Map(); // session id -> { name, visits }

// ============================ The server ============================

const server = http.createServer((req, res) => {
  if (handleCors(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const cookies = parseCookies(req.headers.cookie);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Request-Id', 'req-1');

  if (url.pathname === '/api/data') {
    res.end(JSON.stringify({ data: 42 }));
  } else if (url.pathname === '/login') {
    const id = crypto.randomUUID();
    sessions.set(id, { name: url.searchParams.get('name') ?? 'guest', visits: 0 });
    res.setHeader('Set-Cookie', [
      serializeCookie('sid', signed(id), { maxAge: 3600, path: '/', httpOnly: true, sameSite: 'Lax' }),
      serializeCookie('theme', 'dark mode', { maxAge: 86400, path: '/settings', secure: true, sameSite: 'Strict' }),
    ]); // several cookies = several Set-Cookie headers, so pass an array
    res.end(JSON.stringify({ loggedIn: true }));
  } else if (url.pathname === '/me') {
    const id = unsign(cookies.sid);
    const session = id && sessions.get(id);
    if (!session) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'not logged in' }));
      return;
    }
    session.visits++;
    res.end(JSON.stringify({ name: session.name, visits: session.visits }));
  } else if (url.pathname === '/logout') {
    res.setHeader('Set-Cookie', serializeCookie('sid', '', { maxAge: 0, path: '/' })); // Max-Age=0 deletes it
    res.end(JSON.stringify({ loggedIn: false }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

// ============================ The demo ============================

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  function printCorsHeaders(res) {
    const interesting = [...res.headers].filter(([name]) => name.startsWith('access-control') || name === 'vary');
    if (interesting.length === 0) console.log('    (no CORS headers)');
    for (const [name, value] of interesting) console.log(`    ${name}: ${value}`);
  }

  console.log('--- CORS');
  let res = await fetch(base + '/api/data');
  console.log('no Origin header (server to server):', res.status);
  printCorsHeaders(res);

  res = await fetch(base + '/api/data', { headers: { Origin: 'https://app.example.com' } });
  console.log('allowed origin:', res.status);
  printCorsHeaders(res);

  res = await fetch(base + '/api/data', { headers: { Origin: 'https://evil.example.org' } });
  console.log('other origin: status', res.status, 'but no Allow-Origin header, so a browser hides the body from JS');
  printCorsHeaders(res);

  res = await fetch(base + '/api/data', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  console.log('preflight from the allowed origin:', res.status);
  printCorsHeaders(res);

  console.log('--- cookies');
  let cookie = ''; // Node has no cookie jar, so we keep one cookie by hand
  async function call(path) {
    res = await fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
    console.log(`${path} -> ${res.status} ${await res.text()}`);
    for (const setCookie of res.headers.getSetCookie()) {
      console.log('    Set-Cookie:', setCookie.replace(/sid=[^;.]+\.[^;]+/, 'sid=<id>.<signature>'));
      const [pair, ...attributes] = setCookie.split('; ');
      if (pair.startsWith('sid=')) cookie = attributes.includes('Max-Age=0') ? '' : pair; // update our one-cookie jar
    }
  }

  await call('/me');
  await call('/login?name=Ada');
  await call('/me');
  await call('/me');

  const tampered = cookie.slice(0, -2) + 'xx'; // change the signature
  const real = cookie;
  cookie = tampered;
  console.log('now sending a tampered cookie:');
  await call('/me');
  cookie = real;

  await call('/logout');
  await call('/me');

  console.log('--- the parser on its own');
  console.log({ ...parseCookies('a=1; b=hello%20world; a=ignored; broken') });

  server.close();
  server.closeAllConnections();
}

main();
