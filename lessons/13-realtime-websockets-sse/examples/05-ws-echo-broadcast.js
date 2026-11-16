// A WebSocket server in one small file, core modules only, tested with the built-in WebSocket client
// Run: node lessons/13-realtime-websockets-sse/examples/05-ws-echo-broadcast.js
//
// Everything in one file: the handshake on the 'upgrade' event, decoding masked client frames,
// encoding server frames, broadcast, ping/pong and the close frame.
// Shortcuts on purpose: the handshake headers are not checked, messages are limited to 65535
// bytes, and fragmented messages are not supported. The complete version, with all of that, is
// _mini-ws.js (used by examples 06-12). The clients use the global WebSocket (Node 22+).

const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { connect } = require('./_test-client');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // fixed value from RFC 6455
const OP = { TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

// ---- Encode: build one frame to send. Server frames are never masked. ------------------
function encode(opcode, payload) {
  const length = payload.length;
  if (length > 65535) throw new Error('this tiny server sends at most 65535 bytes per message');
  const header = length < 126
    ? Buffer.from([0x80 | opcode, length]) // 0x80 = FIN: the whole message is in this one frame
    : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]); // 126 = "length is in the next 2 bytes"
  return Buffer.concat([header, payload]);
}

// ---- Decode: read ONE client frame from the start of the buffer. ------------------------
// Returns null when the buffer holds only part of a frame (TCP may deliver it in pieces).
function decode(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f; // the top bit of byte 1 is the mask bit (always 1 from a client)
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    throw new Error('this tiny server does not accept messages above 65535 bytes');
  }
  if (buffer.length < offset + 4 + length) return null; // 4 = the masking key
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; // unmask
  return { opcode, payload, size: offset + 4 + length };
}

// ---- The server ---------------------------------------------------------------------------
const clients = new Set(); // the raw TCP sockets of all connected clients
const events = new EventEmitter(); // only so this demo can wait for server-side moments
let nextId = 1;

// Plain HTTP and WebSocket share one port: the 'upgrade' event gets the second kind.
const server = http.createServer((req, res) => {
  res.end('plain HTTP still works on the same port\n');
});

function broadcast(text) {
  const frame = encode(OP.TEXT, Buffer.from(text));
  for (const socket of clients) socket.write(frame); // the sender is included
}

server.on('upgrade', (req, socket, head) => {
  // 1. The handshake: answer 101 with the accept value computed from the client's key.
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const id = nextId++;
  let closedWith = 'no close frame, code 1006';
  clients.add(socket);
  console.log(`server: client ${id} connected to ${req.url} (${clients.size} connected)`);
  socket.write(encode(OP.TEXT, Buffer.from(`welcome, you are client ${id}`)));

  // 2. Frames: handle each complete frame that arrives.
  function onFrame({ opcode, payload }) {
    if (opcode === OP.TEXT) {
      const text = payload.toString();
      console.log(`server: client ${id} said ${text.length > 40 ? `${text.length} characters` : JSON.stringify(text)}`);
      broadcast(`client ${id}: ${text}`);
    } else if (opcode === OP.BINARY) {
      console.log(`server: client ${id} sent ${payload.length} binary bytes, echoing them`);
      socket.write(encode(OP.BINARY, payload));
    } else if (opcode === OP.PING) {
      socket.write(encode(OP.PONG, payload)); // answer with the same bytes
    } else if (opcode === OP.PONG) {
      events.emit('pong', id);
    } else if (opcode === OP.CLOSE) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; // 1005 = "no code was given"
      closedWith = `code ${code} ${JSON.stringify(payload.subarray(2).toString())}`;
      socket.end(encode(OP.CLOSE, payload)); // answer with a close frame, then finish our side
    }
  }

  // 3. TCP is a stream of bytes: keep what has arrived and cut complete frames off the front.
  let pending = Buffer.alloc(0);
  function onData(chunk) {
    pending = Buffer.concat([pending, chunk]);
    try {
      let frame;
      while ((frame = decode(pending))) {
        pending = pending.subarray(frame.size);
        onFrame(frame);
      }
    } catch {
      socket.destroy(); // a frame this tiny server cannot handle: drop the connection
    }
  }
  socket.on('data', onData);
  if (head.length) onData(head); // bytes that arrived together with the handshake (usually none)

  socket.on('end', () => socket.end()); // the client is done: finish our side too
  socket.on('error', () => {}); // an 'error' event with no listener would crash the process
  socket.on('close', () => {
    clients.delete(socket);
    console.log(`server: client ${id} closed with ${closedWith} (${clients.size} left)`);
    events.emit('gone');
  });
});

// ---- The demo: two clients, using the built-in WebSocket -----------------------------------
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;

  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  console.log('GET / ->', html.trim());

  const a = await connect(`ws://127.0.0.1:${port}/chat`);
  const b = await connect(`ws://127.0.0.1:${port}/chat`);
  console.log('A readyState:', a.ws.readyState, '(WebSocket.OPEN is', `${WebSocket.OPEN})`);
  console.log('A got:', await a.waitFor());
  console.log('B got:', await b.waitFor());

  a.send('hello everyone');
  console.log('A got:', await a.waitFor((m) => m.startsWith('client')));
  console.log('B got:', await b.waitFor((m) => m.startsWith('client')));

  // A message above 125 bytes needs the 2 byte length field in the frame header.
  a.send('x'.repeat(300));
  const long = await b.waitFor((m) => m.length > 100);
  console.log(`B got a long message: ${long.length} characters`);

  // The server pings everybody. The built-in client answers each ping with a pong by itself.
  const pongs = [];
  events.on('pong', (id) => pongs.push(id));
  const ping = encode(OP.PING, Buffer.from('are you there?'));
  for (const socket of clients) socket.write(ping);
  while (pongs.length < clients.size) await once(events, 'pong');
  console.log(`server: pinged everybody and got ${pongs.length} pongs back`);

  // Text arrives as a string. Binary arrives as a Blob unless you ask for an ArrayBuffer.
  a.ws.binaryType = 'arraybuffer';
  a.ws.send(new Uint8Array([1, 2, 3, 250]));
  const echoed = await a.waitFor((m) => typeof m !== 'string'); // skip the text broadcasts still in A's inbox
  console.log('A got binary:', echoed.constructor.name, new Uint8Array(echoed));

  let gone = once(events, 'gone');
  console.log('A closes with:', await a.close(1000, 'done'));
  await gone;
  gone = once(events, 'gone');
  console.log('B closes with:', await b.close());
  await gone;
  server.close();
});
