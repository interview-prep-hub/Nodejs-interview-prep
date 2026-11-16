// The built-in WebSocket client (global since Node 22, same API as in a browser).
// Shows: open / message / close events, and what a failed connection looks like.
// Node has a WebSocket CLIENT but no server, so this file includes a tiny hand-made server (about 25 lines).
// Run: node lessons/22-modern-node-features/examples/04-websocket-client.js

const http = require('node:http');
const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // fixed value from the WebSocket standard (RFC 6455)

// One unmasked text frame, short payloads only (under 126 bytes). Servers never mask frames.
function textFrame(text) {
  const body = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
}

// A minimal server: handshake, say hello, echo each text message, answer a close frame.
const server = http.createServer();
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.write(textFrame('welcome'));
  socket.on('error', () => {});
  socket.on('data', (frame) => {
    if ((frame[0] & 0x0f) === 0x8) return void socket.end(Buffer.from([0x88, 0x00])); // close frame
    const length = frame[1] & 0x7f; // client frames are always masked: 4 mask bytes, then the payload
    const mask = frame.subarray(2, 6);
    const text = Buffer.from(frame.subarray(6, 6 + length)).map((byte, i) => byte ^ mask[i % 4]);
    socket.write(textFrame(`echo: ${text}`));
  });
});

function once(target, type) {
  return new Promise((resolve) => target.addEventListener(type, resolve, { once: true }));
}

// Collect messages from the moment the socket is created, so a message that arrives early is never lost.
function inboxOf(ws) {
  const waiting = [];
  const queue = [];
  ws.addEventListener('message', (event) => (waiting.length ? waiting.shift()(event.data) : queue.push(event.data)));
  return () => new Promise((resolve) => (queue.length ? resolve(queue.shift()) : waiting.push(resolve)));
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  console.log('1. Connect, send, receive, close');
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const nextMessage = inboxOf(ws);
  console.log('  readyState right after new WebSocket():', ws.readyState, '(0 = CONNECTING)');
  await once(ws, 'open');
  console.log('  open event, readyState:', ws.readyState, '(1 = OPEN)');
  console.log('  first message:', await nextMessage());
  ws.send('ping');
  console.log('  second message:', await nextMessage());
  ws.close();
  console.log('  after close(), readyState:', ws.readyState, '(2 = CLOSING)');
  const closed = await once(ws, 'close');
  console.log('  close event, readyState:', ws.readyState, '(3 = CLOSED) | wasClean:', closed.wasClean);

  await new Promise((resolve) => server.close(resolve));

  console.log('2. A failed connection fires "error", then "close"');
  const dead = new WebSocket(`ws://127.0.0.1:${port}`); // the server is closed now, so nobody listens here
  const seen = [];
  dead.addEventListener('error', (event) => seen.push(`error (${event.constructor.name})`));
  const after = await once(dead, 'close');
  seen.push(`close (code ${after.code}, wasClean ${after.wasClean})`);
  console.log('  events in order:', seen.join(' then '));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
