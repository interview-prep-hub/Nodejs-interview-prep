// Cache-Control, ETag with 304, content negotiation (Accept, Accept-Encoding), and redirects
// Run: node lessons/12-http-and-networking/examples/06-caching-and-negotiation.js

const crypto = require('node:crypto');
const http = require('node:http');
const zlib = require('node:zlib');
const { once } = require('node:events');

let article = { title: 'HTTP caching', version: 1 };
const longText = 'Node.js makes network servers easy. '.repeat(60); // 2160 bytes, very compressible

// ---------- content negotiation: pick the best type from the Accept header ----------
function pickType(acceptHeader, available) {
  // "text/html;q=0.5, application/json" -> [{ type, q }, ...] best first
  const wanted = (acceptHeader || '*/*')
    .split(',')
    .map((part) => {
      const [type, ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { type: type.trim(), q: qParam ? Number(qParam.slice(2)) : 1 };
    })
    .filter((item) => item.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { type } of wanted) {
    const found = available.find((candidate) => {
      if (type === '*/*') return true;
      if (type.endsWith('/*')) return candidate.startsWith(type.slice(0, -1));
      return candidate === type;
    });
    if (found) return found;
  }
  return null; // nothing matches: the caller answers 406 Not Acceptable
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ----- 1. validation with ETag: "has it changed since my copy?" -----
  if (url.pathname === '/article') {
    const body = JSON.stringify(article);
    const etag = `"${crypto.createHash('sha256').update(body).digest('hex').slice(0, 12)}"`; // quotes are part of the format
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache'); // "you may store it, but ask me before you reuse it"
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304; // Not Modified: no body, the client reuses its copy
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(body);
    return;
  }

  // ----- 2. freshness with Cache-Control -----
  if (url.pathname === '/logo.svg') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // a fingerprinted file, cache for a year
    res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    return;
  }
  if (url.pathname === '/account') {
    res.setHeader('Cache-Control', 'private, no-store'); // personal data: no shared caches, never write to disk
    res.end('your balance');
    return;
  }

  // ----- 3. content negotiation by Accept -----
  if (url.pathname === '/report') {
    const type = pickType(req.headers.accept, ['application/json', 'text/html', 'text/plain']);
    res.setHeader('Vary', 'Accept'); // the body depends on the Accept header
    if (!type) {
      res.statusCode = 406;
      res.setHeader('Content-Type', 'text/plain');
      res.end('I can send application/json, text/html or text/plain');
      return;
    }
    res.setHeader('Content-Type', type);
    if (type === 'application/json') res.end(JSON.stringify({ report: 'ok' }));
    else if (type === 'text/html') res.end('<h1>report: ok</h1>');
    else res.end('report: ok');
    return;
  }

  // ----- 4. content negotiation by Accept-Encoding (compression) -----
  if (url.pathname === '/big') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(zlib.gzipSync(longText));
    } else {
      res.end(longText);
    }
    return;
  }

  // ----- 5. redirects -----
  if (url.pathname === '/old') {
    res.writeHead(301, { Location: '/new' }).end(); // moved for good
    return;
  }
  if (url.pathname === '/temp') {
    res.writeHead(307, { Location: '/new' }).end(); // temporary, and the client must repeat the SAME method
    return;
  }
  if (url.pathname === '/new') {
    res.end(`new page reached with ${req.method}`);
    return;
  }

  res.writeHead(404).end();
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const pick = (res, names) => names.filter((n) => res.headers.has(n)).map((n) => `${n}: ${res.headers.get(n)}`);

  console.log('--- ETag and 304');
  let res = await fetch(base + '/article');
  const etag = res.headers.get('etag');
  console.log('first request  ->', res.status, pick(res, ['etag', 'cache-control']), await res.text());

  res = await fetch(base + '/article', { headers: { 'If-None-Match': etag } });
  const body = await res.text();
  console.log('same ETag sent ->', res.status, 'body length:', body.length, '(client reuses its saved copy)');

  article = { title: 'HTTP caching', version: 2 }; // the data changes
  res = await fetch(base + '/article', { headers: { 'If-None-Match': etag } });
  console.log('after a change ->', res.status, pick(res, ['etag']), await res.text());

  console.log('--- Cache-Control values');
  for (const path of ['/logo.svg', '/account']) {
    res = await fetch(base + path);
    console.log(path.padEnd(10), pick(res, ['cache-control']));
    await res.arrayBuffer();
  }

  console.log('--- Accept');
  for (const accept of ['application/json', 'text/html', 'text/*;q=0.5, application/json', 'image/png', undefined]) {
    res = await fetch(base + '/report', { headers: accept ? { Accept: accept } : {} });
    console.log(`Accept: ${(accept ?? '(not set)').padEnd(32)} -> ${res.status} ${res.headers.get('content-type')} ${await res.text()}`);
  }

  console.log('--- Accept-Encoding');
  // fetch asks for gzip by itself and unpacks the body for us.
  res = await fetch(base + '/big');
  const text = await res.text();
  console.log('default fetch  ->', pick(res, ['content-encoding', 'content-length']), 'text length:', text.length);
  res = await fetch(base + '/big', { headers: { 'Accept-Encoding': 'identity' } });
  console.log('identity       ->', pick(res, ['content-encoding', 'content-length']), 'text length:', (await res.text()).length);

  console.log('--- redirects');
  res = await fetch(base + '/old', { redirect: 'manual' }); // do not follow, just show it
  console.log('/old manual    ->', res.status, pick(res, ['location']));
  res = await fetch(base + '/old');
  console.log('/old followed  ->', res.status, 'redirected:', res.redirected, await res.text());
  res = await fetch(base + '/temp', { method: 'POST', body: 'x' });
  console.log('POST /temp     ->', res.status, await res.text(), '(307 keeps the method)');

  server.close();
  server.closeAllConnections();
}

main();
