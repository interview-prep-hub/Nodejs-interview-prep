// The WebSocket protocol by hand: the handshake and the frames
// Run: node lessons/13-realtime-websockets-sse/examples/04-handshake-and-frames.js
//
// Part 1 computes Sec-WebSocket-Accept. Part 2 shows that a handshake is a normal
// HTTP request. Part 3 builds and reads frames byte by byte (examples from RFC 6455).

const http = require('node:http');
const crypto = require('node:crypto');
const { acceptKey, encodeFrame, decodeFrame, closePayload, OPCODES, GUID } = require('./_mini-ws');

const hex = (buffer) => [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// ---- Part 1: the accept key -------------------------------------------------

function part1() {
  console.log('=== Part 1: Sec-WebSocket-Accept ===');
  const key = 'dGhlIHNhbXBsZSBub25jZQ=='; // the sample key from RFC 6455
  const sha1 = crypto.createHash('sha1').update(key + GUID).digest();
  console.log('key + GUID  :', key + GUID);
  console.log('sha1 (hex)  :', sha1.toString('hex'));
  console.log('base64      :', sha1.toString('base64'));
  console.log('matches RFC :', acceptKey(key) === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
}

// ---- Part 2: a handshake is plain HTTP ---------------------------------------

function part2() {
  console.log('\n=== Part 2: the handshake over raw HTTP ===');
  return new Promise((resolve) => {
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
      console.log(`server saw: ${req.method} ${req.url} HTTP/${req.httpVersion}`);
      for (const name of ['connection', 'upgrade', 'sec-websocket-version', 'sec-websocket-key']) {
        console.log(`  ${name}: ${req.headers[name]}`);
      }
      const accept = acceptKey(req.headers['sec-websocket-key']);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on('end', () => socket.end()); // the client left: finish our side so 'close' fires
    });

    server.listen(0, '127.0.0.1', () => {
      // A real client makes a new key for every connection: crypto.randomBytes(16).toString('base64').
      // We use the fixed sample key from the RFC so this output is the same on every run.
      const key = 'dGhlIHNhbXBsZSBub25jZQ==';
      const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/chat',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      });
      req.on('upgrade', (res, socket) => {
        console.log(`client got: HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`);
        console.log('  sec-websocket-accept:', res.headers['sec-websocket-accept']);
        console.log('  accept value is correct:', res.headers['sec-websocket-accept'] === acceptKey(key));
        socket.destroy(); // from here on this socket would carry WebSocket frames
        server.close(resolve);
      });
      req.end();
    });
  });
}

// ---- Part 3: frames -----------------------------------------------------------

function describe(frame) {
  const name = Object.keys(OPCODES).find((k) => OPCODES[k] === frame.opcode);
  return `fin=${frame.fin ? 1 : 0} opcode=${name} masked=${frame.masked ? 1 : 0} payload=${JSON.stringify(frame.payload.toString())}`;
}

function part3() {
  console.log('\n=== Part 3: frames ===');

  // A server frame carrying "Hi": no mask.
  const hi = encodeFrame(OPCODES.TEXT, Buffer.from('Hi'));
  console.log('server text "Hi" :', hex(hi));
  console.log('  byte 0 = 0x81 = 1000 0001 -> fin=1, opcode=1 (text)');
  console.log('  byte 1 = 0x02 = 0000 0010 -> mask=0, length=2');

  // The masked example from the RFC: a client sends "Hello" with the mask key 37 fa 21 3d.
  const rfc = Buffer.from('818537fa213d7f9f4d5158', 'hex');
  console.log('\nclient text "Hello":', hex(rfc));
  console.log('  decoded         :', describe(decodeFrame(rfc)));
  const rebuilt = encodeFrame(OPCODES.TEXT, Buffer.from('Hello'), { mask: true, maskKey: Buffer.from('37fa213d', 'hex') });
  console.log('  rebuilt by us   :', hex(rebuilt), rebuilt.equals(rfc) ? '(identical)' : '(different)');

  // Masking is XOR with a repeating 4 byte key, so doing it twice gives the original back.
  const key = Buffer.from('37fa213d', 'hex');
  const once = Buffer.from('Hello').map((byte, i) => byte ^ key[i % 4]);
  const twice = once.map((byte, i) => byte ^ key[i % 4]);
  console.log('\nmasking "Hello" once :', hex(once));
  console.log('masking it again     :', hex(twice), `= "${twice.toString()}"`);

  // The length field has three sizes.
  console.log('\npayload size -> header bytes (server) / (client, with the 4 byte mask key)');
  for (const size of [5, 125, 126, 65535, 65536]) {
    const payload = Buffer.alloc(size);
    const server = encodeFrame(OPCODES.BINARY, payload).length - size;
    const client = encodeFrame(OPCODES.BINARY, payload, { mask: true }).length - size;
    console.log(`  ${String(size).padStart(5)} -> ${server} / ${client}`);
  }

  // Control frames.
  console.log('\nping "x"          :', hex(encodeFrame(OPCODES.PING, Buffer.from('x'))));
  console.log('pong "x"          :', hex(encodeFrame(OPCODES.PONG, Buffer.from('x'))));
  const close = encodeFrame(OPCODES.CLOSE, closePayload(1000, 'bye'));
  console.log('close 1000 "bye"  :', hex(close), '(03 e8 is 1000 in two bytes)');

  // One message in two frames: fin=0 first, then a continuation frame with fin=1.
  const part1 = encodeFrame(OPCODES.TEXT, Buffer.from('Hel'), { fin: false, mask: true });
  const part2 = encodeFrame(OPCODES.CONTINUATION, Buffer.from('lo'), { fin: true, mask: true });
  console.log('\nfragment 1:', describe(decodeFrame(part1)));
  console.log('fragment 2:', describe(decodeFrame(part2)));

  // TCP gives us a stream of bytes, not frames: half a frame means "wait for more".
  console.log('\nhalf a frame decodes to:', decodeFrame(rfc.subarray(0, 7)));
}

async function main() {
  part1();
  await part2();
  part3();
}

main();
