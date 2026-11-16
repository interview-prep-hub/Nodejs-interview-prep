// The four stream types (Readable, Writable, Duplex, Transform) and where core modules use them
// Run: node lessons/11-streams/examples/02-four-types.js

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable, Writable, Duplex, Transform } = require('node:stream');

// Tell which of the four types an object is.
// Order matters: a Transform is also a Duplex, so check Transform first.
function typeOf(s) {
  if (s instanceof Transform) return 'Transform';
  if (s instanceof Duplex) return 'Duplex';
  if (s instanceof Readable) return 'Readable';
  if (s instanceof Writable) return 'Writable';
  // http responses and client requests are built on the old Stream class from before
  // Node 0.10. They are not Writable instances, but they have write() and end().
  if (typeof s.write === 'function' && typeof s.end === 'function') return 'Writable-like (old Stream)';
  return 'not a stream';
}

const rows = [];
function add(label, stream) {
  rows.push({ label, className: stream.constructor.name, type: typeOf(stream) });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-02-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'hello');

  // Files
  const fileRead = fs.createReadStream(file);
  const fileWrite = fs.createWriteStream(path.join(dir, 'b.txt'));
  add('fs.createReadStream()', fileRead);
  add('fs.createWriteStream()', fileWrite);

  // Process streams: the exact class depends on what they are connected to (a terminal,
  // a file or a pipe), so we do not print it. The documented types are Readable and Writable.
  rows.push({ label: 'process.stdin', className: '(varies)', type: 'Readable' });
  rows.push({ label: 'process.stdout', className: '(varies)', type: 'Writable' });

  // zlib and crypto: you write bytes in, you read changed bytes out
  add('zlib.createGzip()', zlib.createGzip());
  add('crypto.createHash()', crypto.createHash('sha256'));

  // A tiny HTTP server and client: request is Readable on the server, response is Writable
  await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      add('http server: req', req);
      add('http server: res', res);
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const clientReq = http.get({ port, host: '127.0.0.1' }, (clientRes) => {
        add('http client: request', clientReq);
        add('http client: response', clientRes);
        clientRes.resume(); // read and throw away the body so the connection can finish
        clientRes.on('end', () => {
          server.close(resolve);
        });
      });
    });
  });

  // A TCP socket is both: you can read from it and write to it independently
  await new Promise((resolve) => {
    const server = net.createServer((socket) => {
      add('net server: socket', socket);
      socket.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const client = net.connect(server.address().port, '127.0.0.1');
      add('net.connect()', client);
      client.on('close', () => server.close(resolve));
      client.resume();
    });
  });

  console.log('What you have'.padEnd(26), 'Class'.padEnd(18), 'Type');
  for (const row of rows) {
    console.log(row.label.padEnd(26), row.className.padEnd(18), row.type);
  }

  // The four types are related by inheritance, but Writable is special.
  console.log('\n--- how the types relate ---');
  console.log('Transform inherits from Duplex :', Object.getPrototypeOf(Transform) === Duplex);
  console.log('Duplex inherits from Readable  :', Object.getPrototypeOf(Duplex) === Readable);
  console.log('new Duplex() instanceof Writable:', new Duplex() instanceof Writable, '(Duplex fakes it)');

  // Clean up the files
  fileRead.destroy();
  fileWrite.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
}

main();
