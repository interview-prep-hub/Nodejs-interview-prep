// Client reconnection with exponential backoff
// Run: node lessons/13-realtime-websockets-sse/examples/09-ws-reconnect.js
//
// A browser WebSocket never reconnects by itself. This small class does: when the
// connection closes it waits, tries again, and doubles the wait after every failure
// (up to a maximum). The wait is reset to the start after a successful connection.

const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createWebSocketServer } = require('./_mini-ws');

// Delay before retry number `attempt` (0, 1, 2, ...): baseMs * 2^attempt, but never more than maxMs.
function backoffDelay(attempt, { baseMs, maxMs, jitter }) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  // "Full jitter": pick a random time between 0 and the ceiling, so that a thousand clients
  // that lost the server together do not all come back at the same millisecond.
  return jitter ? Math.random() * ceiling : ceiling;
}

class ReconnectingSocket extends EventEmitter {
  constructor(url, { baseMs = 500, maxMs = 15000, jitter = true } = {}) {
    super();
    this.url = url;
    this.options = { baseMs, maxMs, jitter };
    this.attempt = 0; // failures in a row
    this.stopped = false;
    this.ws = null;
    this.timer = null;
  }

  open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0; // success: the next failure starts the backoff from the beginning
      this.emit('open');
    });
    ws.addEventListener('message', (event) => this.emit('message', event.data));
    ws.addEventListener('error', () => {}); // the 'close' event follows, handle it there
    ws.addEventListener('close', (event) => {
      if (this.stopped) return this.emit('stopped');
      const delay = backoffDelay(this.attempt, this.options);
      this.emit('retry', { attempt: this.attempt + 1, delay, code: event.code });
      this.attempt++;
      this.timer = setTimeout(() => this.open(), delay);
      return undefined;
    });
  }

  send(data) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false; // not connected: caller decides what to do
    this.ws.send(data);
    return true;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
    else this.emit('stopped');
  }
}

// Part 1: the delays, with the jitter switched off so you can read them.
console.log('delays for base 500 ms, max 15000 ms:');
const delays = [0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, { baseMs: 500, maxMs: 15000, jitter: false }));
console.log(' ', delays.join(', '));

// Part 2: a server that refuses the first 3 attempts and later drops one connection.
let attempts = 0;
let dropped = false;
const server = http.createServer();
const wss = createWebSocketServer(server, {
  verifyClient() {
    attempts++;
    if (attempts <= 3) return { status: 503 }; // "come back later"
    return true;
  },
});
wss.on('connection', (ws) => {
  if (dropped) return;
  dropped = true;
  setTimeout(() => {
    console.log('server: dropping the connection (simulated network loss)');
    ws.terminate();
  }, 30);
});

server.listen(0, '127.0.0.1', () => {
  const client = new ReconnectingSocket(`ws://127.0.0.1:${server.address().port}/`, {
    baseMs: 20, maxMs: 100, jitter: false,
  });
  let opens = 0;
  client.on('retry', ({ attempt, delay, code }) => {
    console.log(`client: connection closed (code ${code}), retry ${attempt} in ${delay} ms`);
  });
  client.on('open', () => {
    opens++;
    console.log(`client: connected (open number ${opens})`);
    if (opens === 2) client.stop();
  });
  client.on('stopped', () => {
    console.log('client: stopped for good');
    server.close();
  });
  client.open();
});
