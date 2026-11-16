// Backpressure: do not send faster than the other side can read
// Run: node lessons/13-realtime-websockets-sse/examples/10-ws-backpressure.js
//
// Part 1 (client side): ws.bufferedAmount counts bytes you queued with send() that have
// not left the process yet. Pause when it is high.
// Part 2 (server side): a client that stops reading makes the server's buffer grow. The
// server checks the buffer and cuts the slow client off instead of running out of memory.

const http = require('node:http');
const net = require('node:net');
const { createWebSocketServer } = require('./_mini-ws');
const { connect, sleep } = require('./_test-client');

const KiB = 1024;
const MAX_BUFFERED = 1024 * KiB; // server: give up on a client with more than 1 MiB waiting
const MESSAGE_BYTES = 64 * KiB; // size of each firehose message
const results = { receivedBytes: 0, falseReturns: 0, maxBuffered: 0, cutOff: false };

const server = http.createServer();
const wss = createWebSocketServer(server);

wss.on('connection', (ws, req) => {
  if (req.url === '/upload') {
    ws.on('message', (data) => { results.receivedBytes += data.length; });
    return;
  }
  // '/firehose': push 64 KiB messages as fast as the loop can run.
  const message = Buffer.alloc(MESSAGE_BYTES);
  for (let i = 0; i < 2000; i++) {
    const accepted = ws.send(message); // false means: Node's write buffer is above its limit
    if (!accepted) results.falseReturns++;
    results.maxBuffered = Math.max(results.maxBuffered, ws.bufferedAmount);
    if (ws.bufferedAmount > MAX_BUFFERED) {
      results.cutOff = true;
      ws.terminate(); // a close frame would never be read by this client, so just drop it
      break;
    }
  }
});

// Send chunks, but wait while too much is still queued.
async function sendPaced(ws, chunks, highWater) {
  let maxSeen = 0;
  for (const chunk of chunks) {
    while (ws.bufferedAmount > highWater) await sleep(1);
    ws.send(chunk);
    maxSeen = Math.max(maxSeen, ws.bufferedAmount);
  }
  return maxSeen;
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;

  console.log('=== Part 1: client side, bufferedAmount ===');
  const upload = await connect(`ws://127.0.0.1:${port}/upload`);
  const chunk = 'x'.repeat(100 * KiB);

  for (let i = 0; i < 50; i++) upload.ws.send(chunk); // no pacing: everything is queued at once
  console.log('right after 50 sends, bufferedAmount > 0:', upload.ws.bufferedAmount > 0);
  while (upload.ws.bufferedAmount > 0) await sleep(1);
  console.log('a moment later it is back to:', upload.ws.bufferedAmount);

  const HIGH_WATER = 256 * KiB;
  const maxSeen = await sendPaced(upload.ws, Array(50).fill(chunk), HIGH_WATER);
  console.log(`paced sending stayed under the limit plus one chunk: ${maxSeen <= HIGH_WATER + chunk.length}`);
  while (results.receivedBytes < 100 * 100 * KiB) await sleep(5);
  console.log('server received', results.receivedBytes, 'bytes in total');
  await upload.close();

  console.log('\n=== Part 2: server side, a client that never reads ===');
  const stuck = net.connect(port, '127.0.0.1');
  stuck.write(
    'GET /firehose HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
    'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
  );
  stuck.pause(); // we never read: the TCP window closes and the server's buffer grows
  while (!results.cutOff) await sleep(5);
  console.log('send() returned false at least once:', results.falseReturns > 0);
  console.log('the slow client was cut off:', results.cutOff);
  console.log('buffer stayed under the limit plus one message:', results.maxBuffered <= MAX_BUFFERED + MESSAGE_BYTES + 16); // 16 = room for the frame header
  stuck.destroy();
  server.close();
});
