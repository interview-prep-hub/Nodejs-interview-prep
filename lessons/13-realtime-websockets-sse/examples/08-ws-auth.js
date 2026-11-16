// WebSocket authentication: a one-time ticket sent in the FIRST message
// Run: node lessons/13-realtime-websockets-sse/examples/08-ws-auth.js
//
// Browsers cannot set an Authorization header on a WebSocket, and a secret in the URL
// ends up in logs. So: (1) the logged-in page asks a normal HTTP route for a short-lived,
// single-use ticket, (2) it opens the WebSocket, (3) the first message carries the ticket.
// Also shown: an Origin check on the upgrade, and a timeout for clients that never log in.

const http = require('node:http');
const crypto = require('node:crypto');
const { createWebSocketServer } = require('./_mini-ws');
const { connect } = require('./_test-client');

const ALLOWED_ORIGINS = new Set(['https://app.example.test']);
const TICKET_TTL_MS = 5000;
const settings = { authTimeoutMs: 5000 }; // how long a new socket may stay silent (a few seconds is typical)

// Created by your normal login code (not shown): session token -> user.
const sessions = new Map([['session-abc', 'alice']]);
const tickets = new Map(); // ticket -> { user, expires }

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/ws-ticket') {
    const user = sessions.get((req.headers.authorization || '').replace('Bearer ', ''));
    if (!user) {
      res.writeHead(401).end();
      return;
    }
    const ticket = crypto.randomUUID();
    tickets.set(ticket, { user, expires: Date.now() + TICKET_TTL_MS });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ticket }));
    return;
  }
  res.writeHead(404).end();
});

const wss = createWebSocketServer(server, {
  verifyClient(req) {
    // Browsers always send Origin. Refuse pages from other sites (Cross-Site WebSocket Hijacking).
    const origin = req.headers.origin;
    return !origin || ALLOWED_ORIGINS.has(origin) ? true : { status: 403 };
  },
});

wss.on('connection', (ws, req) => {
  console.log(`server: new connection ${req.method} ${req.url}`); // this line is what logs and proxies see
  ws.user = null;
  const timer = setTimeout(() => ws.close(4401, 'auth timeout'), settings.authTimeoutMs);
  ws.on('close', () => clearTimeout(timer));

  ws.on('message', (text) => {
    if (ws.user) {
      ws.send(JSON.stringify({ type: 'echo', user: ws.user, text }));
      return;
    }
    // Not logged in yet: the only thing we accept is a valid auth message.
    let msg = null;
    try {
      msg = JSON.parse(text);
    } catch {
      // not JSON: treated as unauthorized below
    }
    const entry = msg?.type === 'auth' ? tickets.get(msg.ticket) : undefined;
    if (msg?.type === 'auth') tickets.delete(msg.ticket); // single use, valid or not
    if (!entry || entry.expires < Date.now()) {
      ws.close(4401, 'unauthorized'); // 4000-4999 are free for applications to use
      return;
    }
    ws.user = entry.user;
    clearTimeout(timer);
    ws.send(JSON.stringify({ type: 'welcome', user: ws.user }));
  });
});

async function getTicket(base, session) {
  const res = await fetch(`${base}/ws-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${session}` } });
  return res.status === 200 ? (await res.json()).ticket : null;
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/`;

  console.log('1. ticket without a session:', await getTicket(base, 'wrong-session'));

  console.log('\n2. the good path');
  const ticket = await getTicket(base, 'session-abc');
  console.log('got a ticket, length', ticket.length);
  const good = await connect(wsUrl, { json: true });
  good.send({ type: 'auth', ticket });
  console.log('server says:', await good.waitFor());
  good.send('hello');
  console.log('server says:', await good.waitFor());
  await good.close();

  console.log('\n3. reuse the same ticket');
  const reuse = await connect(wsUrl, { json: true });
  reuse.send({ type: 'auth', ticket });
  console.log('closed with:', await reuse.closed);

  console.log('\n4. talk before logging in');
  const eager = await connect(wsUrl);
  eager.send('hello?');
  console.log('closed with:', await eager.closed);

  console.log('\n5. connect and stay silent');
  settings.authTimeoutMs = 100; // shortened so this demo does not wait 5 seconds
  const silent = await connect(wsUrl);
  console.log('closed with:', await silent.closed);

  console.log('\n6. a page from another site (bad Origin)');
  await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Origin: 'https://evil.example.test',
      },
    });
    req.on('response', (res) => {
      console.log('upgrade refused with HTTP status', res.statusCode);
      res.resume();
      res.on('close', resolve);
    });
    req.end();
  });

  console.log('\n7. why not put the secret in the URL');
  const leaky = await connect(`${wsUrl}?token=session-abc`);
  await leaky.close();

  server.close();
});
