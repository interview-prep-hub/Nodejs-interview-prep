// fetch, Headers, Request, Response, FormData, AbortSignal.timeout / any and structuredClone: all built in.
// Shows: what you used to install node-fetch, form-data, abort-controller and lodash.cloneDeep for,
// plus how one AbortSignal also cancels timers, events and file reads.
// Run: node lessons/22-modern-node-features/examples/02-fetch-abort-clone.js

const http = require('node:http');

// A tiny local server, so the example needs no internet. Port 0 lets the OS pick a free port.
const server = http.createServer(async (req, res) => {
  if (req.url === '/json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ hello: 'world' }));
  } else if (req.url === '/slow') {
    const timer = setTimeout(() => res.end('late'), 500);
    res.on('close', () => clearTimeout(timer)); // the client gave up, so stop waiting
  } else if (req.url === '/upload') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    // Response can parse a multipart body, so we do not need a library such as busboy for this demo.
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': req.headers['content-type'] },
    }).formData();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ note: form.get('note'), fileName: form.get('file').name, fileSize: form.get('file').size }));
  } else {
    res.statusCode = 404;
    res.end('nope');
  }
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log('1. fetch a JSON endpoint');
  const res = await fetch(`${base}/json`);
  console.log('  ok:', res.ok, '| status:', res.status, '| type:', res.headers.get('content-type'));
  console.log('  body:', await res.json());

  console.log('2. A 404 does NOT make fetch reject');
  const missing = await fetch(`${base}/missing`);
  console.log('  ok:', missing.ok, '| status:', missing.status, '| text:', await missing.text());

  console.log('3. A network failure DOES reject, with a vague message');
  const spare = http.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const deadPort = spare.address().port;
  await new Promise((resolve) => spare.close(resolve)); // now nobody listens on deadPort
  try {
    await fetch(`http://127.0.0.1:${deadPort}/`);
  } catch (err) {
    console.log('  name and message:', err.name, '-', err.message);
    console.log('  the real reason is in err.cause.code:', err.cause.code);
  }

  console.log('4. Headers, Response and Request are plain classes you can use alone');
  const headers = new Headers({ 'Content-Type': 'text/plain' });
  headers.append('X-Tag', 'a');
  headers.append('x-tag', 'b'); // header names are case-insensitive, values are joined
  console.log('  content-type:', headers.get('CONTENT-TYPE'), '| x-tag:', headers.get('x-tag'));
  const made = Response.json({ id: 7 }, { status: 201 });
  console.log('  Response.json:', made.status, made.headers.get('content-type'), await made.json());
  const request = new Request(`${base}/json`, { method: 'POST', body: 'hi' });
  console.log('  Request:', request.method, request.url.endsWith('/json'), await request.text());
  const once = new Response('read me once');
  await once.text();
  try {
    await once.text();
  } catch (err) {
    console.log('  reading a body twice:', err.name, '-', err.message);
  }

  console.log('5. FormData with a file uploads as multipart/form-data');
  const form = new FormData();
  form.append('note', 'hello');
  form.append('file', new Blob(['abcdef'], { type: 'text/plain' }), 'a.txt');
  const uploaded = await fetch(`${base}/upload`, { method: 'POST', body: form });
  console.log('  server saw:', await uploaded.json());

  console.log('6. AbortSignal.timeout and AbortSignal.any');
  try {
    await fetch(`${base}/slow`, { signal: AbortSignal.timeout(50) });
  } catch (err) {
    console.log('  timeout ->', err.name, '| code', err.code);
  }
  const plain = new AbortController();
  setTimeout(() => plain.abort(), 20); // abort() with no reason
  try {
    await fetch(`${base}/slow`, { signal: plain.signal });
  } catch (err) {
    console.log('  abort() ->', err.name, '| code', err.code);
  }
  const user = new AbortController();
  const combined = AbortSignal.any([user.signal, AbortSignal.timeout(2000)]); // the first signal to abort wins
  setTimeout(() => user.abort('user pressed cancel'), 20);
  try {
    await fetch(`${base}/slow`, { signal: combined });
  } catch (err) {
    console.log('  abort(reason) -> fetch rejects with the reason itself:', err);
  }

  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// The same AbortSignal works with many APIs, not only fetch. Each API decides how to report the abort.
async function signalDemo() {
  const { setTimeout: sleep } = require('node:timers/promises');
  const { once, EventEmitter } = require('node:events');
  const fs = require('node:fs');

  console.log('7. The same signal cancels more than fetch');
  // A normal timer keeps the program alive. Without it, waiting only on AbortSignal.timeout() would exit silently.
  const keepAlive = setTimeout(() => {}, 200);
  const first = new AbortController();
  setTimeout(() => first.abort(), 10);
  try {
    await sleep(5000, 'done', { signal: first.signal }); // a 5 second wait, cancelled after 10 ms
  } catch (err) {
    console.log('  timers/promises sleep:', err.name, '| code', err.code);
  }
  try {
    await once(new EventEmitter(), 'never-happens', { signal: AbortSignal.timeout(20) });
  } catch (err) {
    console.log('  events.once with a timeout signal:', err.name, '| the timeout is in err.cause:', err.cause.name);
  }
  const stopped = AbortSignal.abort(new Error('stopped on purpose')); // a signal that is already aborted
  try {
    stopped.throwIfAborted(); // throws signal.reason, handy at the top of a long loop
  } catch (err) {
    console.log('  throwIfAborted() throws the reason itself:', err.message);
  }
  try {
    await fs.promises.readFile(__filename, { signal: stopped });
  } catch (err) {
    console.log('  fs.promises.readFile with an aborted signal:', err.name, '| cause:', err.cause.message);
  }
  clearTimeout(keepAlive);
  console.log('  a 60 second AbortSignal.timeout() is created now. It does not keep the process alive, so the example ends at once.');
  AbortSignal.timeout(60_000);
}

function cloneDemo() {
  console.log('8. structuredClone is a built-in deep copy');
  const original = { when: new Date(0), tags: new Map([['a', 1]]), nested: { list: [1, 2, 3] } };
  original.self = original; // circular references are fine
  const copy = structuredClone(original);
  copy.nested.list.push(4);
  console.log('  original list:', original.nested.list, '| copy list:', copy.nested.list);
  console.log('  Date and Map survive:', copy.when instanceof Date, copy.tags instanceof Map, '| circular kept:', copy.self === copy);

  class User {
    constructor(name) {
      this.name = name;
    }
    hello() {
      return `hi ${this.name}`;
    }
  }
  const cloned = structuredClone(new User('Sam'));
  console.log('  class instance becomes a plain object:', cloned instanceof User, typeof cloned.hello);
  try {
    structuredClone({ run() {} });
  } catch (err) {
    console.log('  functions cannot be cloned:', err.name, '| code', err.code);
  }
}

main()
  .then(signalDemo)
  .then(cloneDemo)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
