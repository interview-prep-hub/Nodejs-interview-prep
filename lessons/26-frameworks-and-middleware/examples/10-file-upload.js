// File uploads: multipart on the wire, parsing it with the built-in Request.formData(), and streaming a raw upload to disk
// Run: node lessons/26-frameworks-and-middleware/examples/10-file-upload.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createApp, httpError } = require('./_mini-express');
const { start, line } = require('./_mini-express/testing');

// Pass the chunks through, but fail as soon as more than maxBytes have arrived.
// This counts REAL bytes, so it also works when the Content-Length header is missing or wrong.
async function* limited(source, maxBytes) {
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, `Upload is larger than ${maxBytes} bytes`);
    yield chunk;
  }
}

// Middleware 1: read the WHOLE multipart body into memory and parse it with the platform's own parser.
// Fine for small forms and avatars. Not for videos: the memory use grows with the file size.
function multipartInMemory({ maxBytes }) {
  return async (req, res, next) => {
    const type = req.headers['content-type'] || '';
    if (!type.startsWith('multipart/form-data')) return next();
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': type }, // carries the boundary the parser needs
      body: Readable.toWeb(Readable.from(limited(req, maxBytes))),
      duplex: 'half', // required when the body is a stream
    });
    req.form = await request.formData(); // a FormData: strings and File objects
    next();
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-demo-'));
  try {
    const app = createApp({ silent: true });

    // Part 1: show the raw bytes of a multipart request
    app.post('/raw-look', async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'])[1];
      const text = Buffer.concat(chunks).toString('utf8').split(boundary).join('<boundary>');
      res.json({ lines: text.split('\r\n') });
    });

    // Part 2: parse in memory, then save every file under a name WE choose
    app.post('/profile', multipartInMemory({ maxBytes: 2000 }), async (req, res) => {
      const fields = {};
      const files = [];
      for (const [name, value] of req.form) {
        if (typeof value === 'string') {
          fields[name] = value;
          continue;
        }
        // value.name comes from the client. It can be "../../evil.txt". NEVER use it as a path.
        const safeName = `${crypto.randomUUID()}${path.extname(path.basename(value.name)).slice(0, 10)}`;
        await fs.promises.writeFile(path.join(dir, safeName), Buffer.from(await value.arrayBuffer()));
        files.push({ field: name, clientName: value.name, type: value.type, size: value.size, storedAs: safeName.replace(/^[0-9a-f-]{36}/, '<uuid>') });
      }
      res.status(201).json({ fields, files });
    });

    // Part 3: streaming. The raw body goes straight to disk, chunk by chunk. Memory use stays small
    // whatever the file size. pipeline() handles backpressure and cleans up when something fails.
    app.put('/raw', async (req, res) => {
      const target = path.join(dir, `${crypto.randomUUID()}.bin`);
      try {
        await pipeline(limited(req, 10_000), fs.createWriteStream(target));
      } catch (err) {
        await fs.promises.rm(target, { force: true }); // do not leave half a file behind
        throw err;
      }
      res.status(201).json({ savedBytes: (await fs.promises.stat(target)).size });
    });

    app.use((err, req, res, next) => {
      res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
    });

    const server = await start(app);

    console.log('=== Part 1: what multipart/form-data looks like');
    const form = new FormData();
    form.append('title', 'My notes');
    form.append('doc', new File(['hello file'], 'notes.txt', { type: 'text/plain' }));
    let res = await fetch(`${server.base}/raw-look`, { method: 'POST', body: form }); // fetch sets the header and the boundary
    for (const row of (await res.json()).lines) console.log(`| ${row}`.trimEnd());

    console.log('=== Part 2: parse in memory (Request.formData), store under our own name');
    const profile = new FormData();
    profile.append('name', 'Ada');
    profile.append('avatar', new File(['fake image bytes'], '../../evil.png', { type: 'image/png' }));
    res = await fetch(`${server.base}/profile`, { method: 'POST', body: profile });
    console.log('upload  :', res.status, JSON.stringify(await res.json()));
    console.log('on disk :', fs.readdirSync(dir).length, 'file, named by us, inside the upload directory only');

    const tooBig = new FormData();
    tooBig.append('avatar', new File([Buffer.alloc(5000, 'x')], 'big.png', { type: 'image/png' }));
    res = await fetch(`${server.base}/profile`, { method: 'POST', body: tooBig });
    console.log('too big :', res.status, JSON.stringify(await res.json()));

    console.log('=== Part 3: streaming a raw body to disk, with a limit of 10000 bytes');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    res = await server.request('PUT', '/raw', { body: Buffer.alloc(8000, 'a'), headers: { 'content-type': 'application/octet-stream' } });
    console.log('8000 bytes  :', line(res));
    res = await server.request('PUT', '/raw', { body: Buffer.alloc(50_000, 'a'), headers: { 'content-type': 'application/octet-stream' } });
    console.log('50000 bytes :', line(res));
    console.log('files left in the directory:', fs.readdirSync(dir).length, '(the rejected upload was deleted)');

    await server.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // always clean up
  }
}

main();
