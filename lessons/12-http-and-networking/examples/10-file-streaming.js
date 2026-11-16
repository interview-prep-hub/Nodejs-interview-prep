// Serving files with streams: Content-Length vs chunked, Range requests, a safe path check
// Run: node lessons/12-http-and-networking/examples/10-file-streaming.js

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { once } = require('node:events');

// ---- set up a small "public" folder in the temp directory, plus a secret file OUTSIDE it ----
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-lesson-'));
const publicDir = path.join(tempRoot, 'public');
fs.mkdirSync(publicDir);
fs.writeFileSync(path.join(publicDir, 'alphabet.txt'), 'abcdefghijklmnopqrstuvwxyz'); // 26 bytes
fs.writeFileSync(path.join(publicDir, 'big.bin'), Buffer.alloc(200_000, 7)); // 200 000 bytes
fs.writeFileSync(path.join(tempRoot, 'secret.txt'), 'top secret');

// A small helper: a short text answer with an exact Content-Length.
function plain(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

const stats = { chunks: 0 }; // how many pieces the last file was read in

const TYPES = { '.txt': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream' };

// "bytes=0-9" -> { start: 0, end: 9 }. Also "bytes=20-" and "bytes=-5" (the last 5 bytes).
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null; // no Range or not understood: send everything
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2])); // suffix range
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

async function serveFile(req, res, urlPath) {
  // Safe path check. Decode first, then resolve against the public folder, then make sure
  // the result is still INSIDE the public folder.
  const relative = decodeURIComponent(urlPath.slice('/files/'.length));
  const filePath = path.resolve(publicDir, relative);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    plain(res, 403, 'Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    plain(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) {
    plain(res, 404, 'Not found');
    return;
  }

  const headers = {
    'Content-Type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes', // "you may ask me for a part of the file"
  };
  const range = parseRange(req.headers.range, stat.size);

  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 }).end();
    return;
  }

  const options = range ? { start: range.start, end: range.end } : {}; // both ends are inclusive
  const length = range ? range.end - range.start + 1 : stat.size;
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`, 'Content-Length': length });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': length }); // we know the size, so say it
  }

  const file = fs.createReadStream(filePath, options);
  stats.chunks = 0;
  file.on('data', () => stats.chunks++);
  try {
    // pipeline handles backpressure and destroys both streams if the client disconnects or the file fails.
    await pipeline(file, res);
  } catch (err) {
    console.log('  (server) stream ended early:', err.code);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/files/')) {
      await serveFile(req, res, url.pathname);
    } else if (url.pathname === '/generated') {
      // The size is NOT known in advance, so no Content-Length: Node uses "Transfer-Encoding: chunked".
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      async function* lines() {
        for (let i = 1; i <= 3; i++) yield `line ${i}\n`;
      }
      await pipeline(Readable.from(lines()), res);
    } else {
      plain(res, 404, 'Not found');
    }
  } catch (err) {
    console.log('  (server) unexpected error:', err.message);
    if (res.headersSent) res.destroy();
    else plain(res, 500, 'Internal Server Error');
  }
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function show(label, urlPath, headers) {
    const res = await fetch(base + urlPath, { headers });
    const body = await res.text();
    const shown = body.length > 30 ? `${body.length} characters` : JSON.stringify(body);
    const parts = ['content-length', 'transfer-encoding', 'content-range']
      .filter((name) => res.headers.has(name))
      .map((name) => `${name}: ${res.headers.get(name)}`);
    console.log(`${label}\n  -> ${res.status} ${parts.join(' | ')} | body: ${shown}`);
  }

  console.log('--- whole files');
  await show('small file, size known', '/files/alphabet.txt');
  await show('big file, streamed', '/files/big.bin');
  console.log(`  the server read it from disk in ${stats.chunks} chunks (fs.createReadStream reads 64 KiB at a time)`);
  await show('generated, size unknown', '/generated');

  console.log('--- Range requests (resume a download, seek in a video)');
  await show('first 10 bytes', '/files/alphabet.txt', { Range: 'bytes=0-9' });
  await show('from byte 20 to the end', '/files/alphabet.txt', { Range: 'bytes=20-' });
  await show('the last 5 bytes', '/files/alphabet.txt', { Range: 'bytes=-5' });
  await show('range past the end', '/files/alphabet.txt', { Range: 'bytes=500-600' });

  console.log('--- errors and attacks');
  await show('missing file', '/files/nope.txt');
  await show('path traversal (..%2f)', '/files/..%2fsecret.txt');

  server.close();
  server.closeAllConnections();
}

// Always remove the temp folder, even if something above failed.
main().finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
