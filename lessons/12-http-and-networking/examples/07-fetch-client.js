// The global fetch client: reading bodies, POST, errors (res.ok), network failures, timeouts, streams
// Run: node lessons/12-http-and-networking/examples/07-fetch-client.js

const http = require('node:http');
const { once } = require('node:events');

// A small server with one endpoint for each thing we want to try.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/user') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Rate-Limit', '100');
    res.end(JSON.stringify({ id: 1, name: 'Ada' }));
  } else if (url.pathname === '/echo') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        method: req.method,
        contentType: req.headers['content-type'],
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  } else if (url.pathname === '/broken') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'database is down' }));
  } else if (url.pathname === '/slow') {
    setTimeout(() => res.end('finally'), 400);
  } else if (url.pathname === '/lines') {
    for (const word of ['one', 'two', 'three']) {
      res.write(word + '\n');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    res.end();
  } else {
    res.statusCode = 404;
    res.end('no such page');
  }
});

// The helper most projects write: turn "bad status" into a real error.
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000), ...options });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log('1. GET and read the body');
  let res = await fetch(base + '/user');
  console.log('  status:', res.status, res.statusText, '| ok:', res.ok);
  console.log('  content-type:', res.headers.get('content-type'), '| x-rate-limit:', res.headers.get('x-rate-limit'));
  console.log('  json():', await res.json());

  console.log('2. POST JSON (you must set the Content-Type yourself)');
  res = await fetch(base + '/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer my-token' },
    body: JSON.stringify({ hello: 'world' }),
  });
  console.log('  server saw:', JSON.stringify(await res.json()));

  console.log('3. A string body gets text/plain by default');
  res = await fetch(base + '/echo', { method: 'POST', body: 'just text' });
  console.log('  content-type the server saw:', (await res.json()).contentType);

  console.log('4. fetch does NOT reject on 404 or 500');
  res = await fetch(base + '/nothing');
  console.log('  404 ->', 'resolved, ok =', res.ok, ', status =', res.status, ', body =', await res.text());
  try {
    await fetchJson(base + '/broken');
  } catch (err) {
    console.log('  fetchJson turns it into an error:', err.message, '| body:', err.body);
  }

  console.log('5. fetch DOES reject when there is no response at all');
  const closed = http.createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const deadPort = closed.address().port;
  closed.close();
  await once(closed, 'close'); // nobody listens on deadPort now
  try {
    await fetch(`http://127.0.0.1:${deadPort}/`);
  } catch (err) {
    console.log('  error:', err.name + ':', err.message);
    console.log('  the real reason is in err.cause.code:', err.cause.code);
  }

  console.log('6. Timeouts and cancelling');
  try {
    await fetch(base + '/slow', { signal: AbortSignal.timeout(100) });
  } catch (err) {
    console.log('  AbortSignal.timeout ->', err.name, '|', err.message);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await fetch(base + '/slow', { signal: controller.signal });
  } catch (err) {
    console.log('  controller.abort()  ->', err.name, '|', err.message);
  }

  console.log('7. Read a body as a stream, piece by piece');
  res = await fetch(base + '/lines');
  const decoder = new TextDecoder();
  let received = '';
  for await (const chunk of res.body) {
    // res.body is a web ReadableStream of Uint8Array. Where the chunk borders fall is up to the network.
    received += decoder.decode(chunk, { stream: true });
  }
  console.log('  lines received:', received.split('\n').filter(Boolean));

  console.log('8. A body can be read only once');
  res = await fetch(base + '/user');
  await res.text();
  try {
    await res.text();
  } catch (err) {
    console.log('  second read:', err.name, '|', err.message);
  }
  res = await fetch(base + '/user');
  const copy = res.clone(); // clone BEFORE reading if you need two reads
  console.log('  clone works:', (await res.json()).name, '+', (await copy.text()).length, 'characters');

  console.log('9. A bad URL fails before any network call');
  try {
    await fetch('not a url');
  } catch (err) {
    console.log('  ', err.name + ':', err.message, '| cause code:', err.cause.code);
  }

  server.close();
  server.closeAllConnections();
}

main();
