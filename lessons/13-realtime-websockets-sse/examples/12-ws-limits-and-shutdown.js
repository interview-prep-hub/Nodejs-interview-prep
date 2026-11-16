// Limits and graceful shutdown for a WebSocket server
// Run: node lessons/13-realtime-websockets-sse/examples/12-ws-limits-and-shutdown.js
//
// A: cap the number of connections (every connection costs a file descriptor and memory).
// B: cap the size of one message (a client must not be able to send you 10 GB).
// C: shut down politely: close frame 1001 "going away", so clients know to reconnect.

const http = require('node:http');
const { createWebSocketServer } = require('./_mini-ws');
const { connect } = require('./_test-client');

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

async function partA() {
  console.log('=== A: maxConnections ===');
  const server = http.createServer();
  const wss = createWebSocketServer(server);
  server.maxConnections = 2; // a net.Server setting: new sockets beyond this are destroyed at once
  server.on('drop', () => console.log('server: dropped a connection, limit is', server.maxConnections));
  const port = await listen(server);

  const one = await connect(`ws://127.0.0.1:${port}/`);
  const two = await connect(`ws://127.0.0.1:${port}/`);
  console.log('connected clients:', wss.clients.size);
  try {
    await connect(`ws://127.0.0.1:${port}/`);
    console.log('third client connected (unexpected)');
  } catch (err) {
    console.log('third client failed, close code', err.code);
  }
  await Promise.all([one.close(), two.close()]);
  server.close();
}

async function partB() {
  console.log('\n=== B: maxPayload ===');
  const server = http.createServer();
  createWebSocketServer(server, { maxPayload: 1024 }); // allow messages up to 1 KiB
  const port = await listen(server);

  const client = await connect(`ws://127.0.0.1:${port}/`);
  client.send('x'.repeat(500));
  console.log('500 bytes: connection still open:', client.ws.readyState === WebSocket.OPEN);
  client.send('x'.repeat(2000));
  console.log('2000 bytes: closed with', await client.closed);
  server.close();
}

async function partC() {
  console.log('\n=== C: graceful shutdown ===');
  const server = http.createServer();
  const wss = createWebSocketServer(server);
  const port = await listen(server);

  const clients = await Promise.all([1, 2, 3].map(() => connect(`ws://127.0.0.1:${port}/`)));
  console.log('clients connected:', wss.clients.size);

  // What a SIGTERM handler would do:
  const fullyClosed = new Promise((resolve) => server.close(resolve)); // stop accepting new connections
  for (const ws of wss.clients) ws.close(1001, 'server restarting'); // 1001 = going away

  const results = await Promise.all(clients.map((client) => client.closed));
  console.log('every client saw:', results[0]);
  console.log('all three got the same code:', results.every((r) => r.code === 1001));
  await fullyClosed; // resolves when the last connection is gone
  console.log('server: fully closed, the process can exit');
}

async function main() {
  await partA();
  await partB();
  await partC();
}

main();
