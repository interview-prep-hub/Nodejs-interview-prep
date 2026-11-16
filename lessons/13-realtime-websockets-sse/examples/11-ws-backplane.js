// Scaling out: why two servers need a pub/sub backplane
// Run: node lessons/13-realtime-websockets-sse/examples/11-ws-backplane.js
//
// A WebSocket connection lives in the memory of ONE server process. If a load balancer
// puts Ann on server A and Ben on server B, A cannot write to Ben's socket. The fix is
// a backplane: every server publishes messages to a shared channel and every server
// delivers what it hears to its own clients. In production the channel is Redis
// pub/sub (see the README). Here a tiny in-process class stands in for Redis.

const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createWebSocketServer } = require('./_mini-ws');
const { connect } = require('./_test-client');

// Resolve with the promise's value, or with null if it takes longer than `ms`.
async function orNothing(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer); // do not keep the process alive for a timer nobody needs
  }
}

// Stand-in for Redis PUBLISH / SUBSCRIBE (real Redis delivers over the network, so we do it later).
class FakeRedis {
  constructor() { this.bus = new EventEmitter(); }
  subscribe(channel, handler) { this.bus.on(channel, handler); }
  publish(channel, message) { setImmediate(() => this.bus.emit(channel, message)); }
}

// One "server instance". With a backplane it publishes; without one it only knows its own clients.
function startInstance(name, redis) {
  const server = http.createServer();
  const wss = createWebSocketServer(server);
  const deliverToMyClients = (text) => {
    for (const ws of wss.clients) ws.send(text);
  };

  if (redis) redis.subscribe('chat', deliverToMyClients); // hear everything, from every instance

  wss.on('connection', (ws) => {
    ws.on('message', (text) => {
      const line = `[from server ${name}] ${text}`;
      if (redis) redis.publish('chat', line); // one code path: the subscription delivers it, even to us
      else deliverToMyClients(line);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ name, server, wss, port: server.address().port }));
  });
}

async function scenario(title, redis) {
  console.log(`=== ${title} ===`);
  const a = await startInstance('A', redis);
  const b = await startInstance('B', redis);

  // The load balancer sent Ann to server A and Ben to server B.
  const ann = await connect(`ws://127.0.0.1:${a.port}/`);
  const ben = await connect(`ws://127.0.0.1:${b.port}/`);
  console.log(`server A has ${a.wss.clients.size} client, server B has ${b.wss.clients.size} client`);

  ann.send('hello from Ann');
  console.log('Ann received:', await ann.waitFor());
  // Wait a short time for "nothing" to be sure, a long time for a message that should come.
  const benGot = await orNothing(ben.waitFor(), redis ? 3000 : 100);
  console.log('Ben received:', benGot ?? 'nothing');

  await Promise.all([ann.close(), ben.close()]);
  a.server.close();
  b.server.close();
  console.log();
}

async function main() {
  await scenario('Without a backplane', null);
  await scenario('With a backplane (pub/sub channel)', new FakeRedis());
}

main();
