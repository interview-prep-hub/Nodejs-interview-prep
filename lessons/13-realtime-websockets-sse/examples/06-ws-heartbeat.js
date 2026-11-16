// Heartbeats: ping/pong and finding dead connections
// Run: node lessons/13-realtime-websockets-sse/examples/06-ws-heartbeat.js
//
// The server pings every client in a "sweep". A client that did not answer the PREVIOUS
// ping is dead (or hung) and is terminated. One client is healthy (the built-in
// WebSocket answers pings by itself). The other is a "zombie": it finished the
// handshake and then went silent, like a laptop that lost its Wi-Fi.
// In production the sweep runs on a timer: setInterval(sweep, 30_000).
// Here we call it by hand, so the output does not depend on timing.

const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { createWebSocketServer } = require('./_mini-ws');
const { connect } = require('./_test-client');

const server = http.createServer();
const wss = createWebSocketServer(server);

wss.on('connection', (ws, req) => {
  ws.name = req.url.slice(1); // '/good' -> 'good'
  ws.pongs = 0;
  ws.isAlive = true;
  console.log(`server: ${ws.name} connected`);
  ws.on('pong', () => {
    ws.isAlive = true; // it answered: alive until the next sweep
    ws.pongs++;
  });
  ws.on('close', (code) => console.log(`server: ${ws.name} is gone (close code ${code})`));
});

// One sweep for ALL clients (one timer, not one timer per client).
function sweep() {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      console.log(`server: ${ws.name} missed a ping, terminating it`);
      ws.terminate(); // no closing handshake: the other side is not listening anyway
      continue;
    }
    ws.isAlive = false; // it must answer before the next sweep
    ws.ping();
  }
}

// A client that completes the handshake and then never answers anything.
function connectZombie(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.write(
      'GET /zombie HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
      'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
    socket.once('data', () => resolve(socket)); // 101 received. From now on: silence.
  });
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const good = await connect(`ws://127.0.0.1:${port}/good`);
  const zombie = await connectZombie(port);
  const byName = (name) => [...wss.clients].find((ws) => ws.name === name);
  const goodOnServer = byName('good');
  const zombieOnServer = byName('zombie');

  console.log('\nsweep 1: both are asked to prove they are alive');
  let answered = once(goodOnServer, 'pong');
  sweep();
  await answered;

  console.log('sweep 2: the zombie never answered sweep 1');
  const closedOnServer = once(zombieOnServer, 'close');
  const closedOnClient = once(zombie, 'close'); // the zombie's own side of the TCP connection
  answered = once(goodOnServer, 'pong');
  sweep();
  await Promise.all([answered, closedOnServer, closedOnClient]);

  console.log('sweep 3: only the healthy client is left');
  answered = once(goodOnServer, 'pong');
  sweep();
  await answered;

  console.log('\nconnections the server still has:', [...wss.clients].map((ws) => ws.name));
  console.log('pongs from the good client:', goodOnServer.pongs);
  console.log('zombie TCP connection is closed:', zombie.destroyed);

  await good.close();
  server.close();
});
