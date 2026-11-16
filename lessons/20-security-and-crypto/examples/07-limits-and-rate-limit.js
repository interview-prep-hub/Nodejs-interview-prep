// Denial of service defences: body size limit, slow-request timeouts, and a rate limiter
// Run: node lessons/20-security-and-crypto/examples/07-limits-and-rate-limit.js
//
// One small server on 127.0.0.1 (port 0) and a few clients that misbehave on purpose.

const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

// ---------- 1. A rate limiter (fixed window, one counter per key) ----------
class RateLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now; // injectable clock: lets tests (and this demo) move time without sleeping
    this.hits = new Map(); // key -> { count, resetAt }
  }

  hit(key) {
    const time = this.now();
    let entry = this.hits.get(key);
    if (!entry || time >= entry.resetAt) {
      entry = { count: 0, resetAt: time + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSec: allowed ? 0 : Math.ceil((entry.resetAt - time) / 1000),
    };
  }

  sweep() {
    // Drop finished windows, or the Map grows forever (an attacker can use a new key per request).
    const time = this.now();
    for (const [key, entry] of this.hits) if (time >= entry.resetAt) this.hits.delete(key);
  }
}

// ---------- 2. Read a body, but never more than `limit` bytes ----------
class TooLarge extends Error {
  status = 413;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(new TooLarge('declared length is over the limit')); // cheap early exit
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new TooLarge('body is over the limit')); // chunked uploads have no length: count as we go
        req.removeAllListeners('data'); // stop buffering
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- 3. The server ----------
const pingLimiter = new RateLimiter({ limit: 3, windowMs: 10_000 });

function createApp() {
  return http.createServer(
    {
      headersTimeout: 300, // the whole header block must arrive within 300 ms (default is 60000)
      requestTimeout: 600, // the whole request must arrive within 600 ms (default is 300000)
      connectionsCheckingInterval: 50, // how often Node looks for timed-out connections (default 30000)
    },
    async (req, res) => {
      if (req.url === '/ping') {
        const verdict = pingLimiter.hit(req.socket.remoteAddress);
        res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
        if (!verdict.allowed) {
          res.writeHead(429, { 'Retry-After': String(verdict.retryAfterSec), Connection: 'close' });
          return res.end('slow down');
        }
        return res.end('pong');
      }
      if (req.url === '/echo' && req.method === 'POST') {
        try {
          const body = await readBody(req, 1024); // 1 KiB is plenty for this API
          return res.end(`got ${body.length} bytes`);
        } catch (err) {
          res.writeHead(err.status || 400, { Connection: 'close' }); // close the socket so the rest of a huge upload is dropped
          return res.end(err.message);
        }
      }
      res.writeHead(404).end();
    },
  );
}

// ---------- 4. Clients that misbehave ----------
function postChunked(port, chunkCount, chunkSize) {
  // No Content-Length: the size is unknown until the data arrives.
  return new Promise((resolve) => {
    const req = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/echo', headers: { 'Transfer-Encoding': 'chunked' } }, async (res) => {
      resolve(`${res.statusCode} ${(await res.toArray()).join('')}`);
    });
    req.on('error', () => resolve('connection reset by the server'));
    for (let i = 0; i < chunkCount; i++) req.write('x'.repeat(chunkSize));
    req.end();
  });
}

function slowHeaders(port) {
  // Send a request line and half a header, then go silent (a "slowloris" client).
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect(port, '127.0.0.1');
    socket.write('GET /ping HTTP/1.1\r\nHost: x\r\nX-Slow: ');
    let reply = '';
    socket.on('data', (d) => (reply += d));
    socket.on('close', () => resolve({ reply: reply.split('\r\n')[0], ms: Date.now() - started }));
  });
}

async function main() {
  const defaults = http.createServer();
  console.log('--- 1. Node default timeouts ---');
  console.log(`headersTimeout=${defaults.headersTimeout} requestTimeout=${defaults.requestTimeout} timeout=${defaults.timeout} keepAliveTimeout=${defaults.keepAliveTimeout} maxHeaderSize=${http.maxHeaderSize}`);

  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const { port } = server.address();

  console.log('\n--- 2. body size limit (1024 bytes) ---');
  const small = await fetch(`${base}/echo`, { method: 'POST', body: 'x'.repeat(100) });
  console.log('100 byte body       :', small.status, await small.text());
  const big = await fetch(`${base}/echo`, { method: 'POST', body: 'x'.repeat(5000) });
  console.log('5000 byte body      :', big.status, await big.text());
  console.log('chunked 4 x 512 B   :', await postChunked(port, 4, 512));

  console.log('\n--- 3. slow header attack ---');
  const slow = await slowHeaders(port);
  console.log('server answered     :', slow.reply);
  console.log('connection cut off  : in under 2 seconds =', slow.ms < 2000, '(not left open forever)');

  console.log('\n--- 4. rate limit (3 requests per 10 s per client) ---');
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${base}/ping`);
    console.log(`request ${i}: ${res.status} remaining=${res.headers.get('x-ratelimit-remaining')} retry-after=${res.headers.get('retry-after') ?? '-'}`);
    await res.text();
  }

  server.close();
  server.closeAllConnections();

  console.log('\n--- 5. limiter with a fake clock (no waiting) ---');
  let time = 0;
  const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => time });
  const show = (label) => console.log(label.padEnd(16), JSON.stringify(limiter.hit('client-A')));
  show('t=0 first');
  show('t=0 second');
  show('t=0 third');
  time = 1000;
  show('t=1000 new window');
  limiter.sweep();
}

main();
