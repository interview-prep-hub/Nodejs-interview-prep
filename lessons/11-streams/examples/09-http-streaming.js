// Streaming a big HTTP response with pipeline, compared with buffering it, plus what happens when the client leaves
// Run: node lessons/11-streams/examples/09-http-streaming.js

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline, Writable } = require('node:stream');

const MiB = 1024 * 1024;
const FILE_MIB = 32;

function makeBigFile(file, mib) {
  const block = Buffer.alloc(MiB, 'x');
  const fd = fs.openSync(file, 'w');
  for (let i = 0; i < mib; i++) fs.writeSync(fd, block);
  fs.closeSync(fd);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-09-'));
  const file = path.join(dir, 'big.bin');
  makeBigFile(file, FILE_MIB);

  // What the abort route reports, so main() can print it in a fixed order.
  let reportAbort;
  const abortReport = new Promise((resolve) => {
    reportAbort = resolve;
  });

  const server = http.createServer(async (req, res) => {
    try {
      const { size } = await fsp.stat(file); // do anything that can fail BEFORE sending headers

      if (req.url === '/buffered') {
        // Bad for big files: the whole file is in memory before the first byte is sent.
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'Content-Length': size });
        res.end(data);
      } else if (req.url === '/streamed') {
        // Good: bytes flow from disk to the socket in small chunks, with backpressure.
        res.writeHead(200, { 'Content-Length': size });
        pipeline(fs.createReadStream(file), res, (err) => {
          if (err) console.log('server: streamed pipeline error:', err.code);
        });
      } else if (req.url === '/gzip') {
        // Compress on the fly. The compressed size is not known in advance, so there is no
        // Content-Length: Node sends the body with Transfer-Encoding: chunked instead.
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        pipeline(fs.createReadStream(file), zlib.createGzip(), res, (err) => {
          if (err) console.log('server: gzip pipeline error:', err.code);
        });
      } else if (req.url === '/abort') {
        res.writeHead(200, { 'Content-Length': size });
        const source = fs.createReadStream(file);
        pipeline(source, res, (err) => {
          // The client left in the middle. pipeline reports it AND closes the file for us.
          reportAbort({ error: err && err.code, fileClosed: source.destroyed });
        });
      } else {
        res.writeHead(404).end();
      }
    } catch (err) {
      res.writeHead(500).end(); // safe: nothing was sent yet
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Download a URL, measure when the first bytes arrive and how many bytes we got in total.
  function download(urlPath) {
    return new Promise((resolve, reject) => {
      const start = process.hrtime.bigint();
      http
        .get({ host: '127.0.0.1', port, path: urlPath }, async (res) => {
          let firstByteMs = null;
          let bytes = 0;
          for await (const chunk of res) {
            if (firstByteMs === null) firstByteMs = Number(process.hrtime.bigint() - start) / 1e6;
            bytes += chunk.length;
          }
          resolve({ firstByteMs, bytes });
        })
        .on('error', reject);
    });
  }

  // Download the gzip route: look at the headers, then gunzip the body and count the bytes.
  function downloadGzip() {
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/gzip' }, (res) => {
          const headers = {
            encoding: res.headers['content-encoding'],
            transfer: res.headers['transfer-encoding'],
            length: res.headers['content-length'],
          };
          let bytes = 0;
          const counter = new Writable({
            write(chunk, encoding, callback) {
              bytes += chunk.length;
              callback();
            },
          });
          pipeline(res, zlib.createGunzip(), counter, (err) => (err ? reject(err) : resolve({ headers, bytes })));
        })
        .on('error', reject);
    });
  }

  try {
    for (const route of ['/buffered', '/streamed']) {
      const result = await download(route);
      console.log(`${route.padEnd(10)} first byte after ${result.firstByteMs.toFixed(0).padStart(3)} ms, received ${result.bytes / MiB} MiB`);
    }

    console.log('\n--- compress while streaming ---');
    const gz = await downloadGzip();
    console.log('Content-Encoding header :', gz.headers.encoding);
    console.log('Transfer-Encoding header:', gz.headers.transfer);
    console.log('Content-Length header   :', gz.headers.length === undefined ? 'none (size unknown in advance)' : gz.headers.length);
    console.log('bytes after gunzip      :', gz.bytes / MiB, 'MiB');

    console.log('\n--- the client leaves after the first chunk ---');
    await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/abort' }, (res) => {
        res.on('error', () => {}); // the connection was cut by us, ignore the error here
        res.once('data', () => {
          console.log('client: got the first chunk, hanging up');
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => {});
    });
    const report = await abortReport;
    console.log('server: pipeline ended with error code :', report.error);
    console.log('server: file stream was closed         :', report.fileClosed);
  } finally {
    server.close();
    server.closeAllConnections();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
