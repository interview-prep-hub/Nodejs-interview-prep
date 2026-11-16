// http.createServer with no framework: req.method, req.url, headers, URL parsing, and the res API
// Run: node lessons/12-http-and-networking/examples/03-http-server-basics.js

const http = require('node:http');
const { once } = require('node:events');

const server = http.createServer((req, res) => {
  // req.url is only the path plus the query string, never the host.
  // To parse it, give URL a base. The base is a placeholder, only the path part matters.
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/hello') {
    const name = url.searchParams.get('name') ?? 'stranger'; // already percent-decoded
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Hello, ${name}!`);
    return;
  }

  if (url.pathname === '/inspect') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        pathname: url.pathname,
        search: url.search,
        tags: url.searchParams.getAll('tag'), // repeated keys
        asObject: Object.fromEntries(url.searchParams), // repeated keys: the last one wins
        httpVersion: req.httpVersion,
        userAgent: req.headers['user-agent'], // header names are lower-cased
        customHeader: req.headers['x-demo'],
      }),
    );
    return;
  }

  if (url.pathname === '/set-header-style') {
    res.statusCode = 201; // 1. set the status
    res.setHeader('X-Style', 'setHeader'); // 2. set headers one by one (any time before the first write)
    res.end('created'); // 3. send the body; Content-Length is added for us
    return;
  }

  if (url.pathname === '/write-head-style') {
    // writeHead sets status and headers in one call, and sends the header block right away.
    res.writeHead(201, { 'X-Style': 'writeHead', 'Content-Type': 'text/plain' });
    res.end('created'); // no Content-Length was given, so Node falls back to chunked
    return;
  }

  if (url.pathname === '/too-late') {
    res.write('first part. ');
    try {
      res.setHeader('X-Late', '1'); // headers are already on the wire
    } catch (err) {
      res.write(`setHeader failed with ${err.code}. `);
    }
    res.end('done');
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function show(label, path, options) {
    const res = await fetch(base + path, options);
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const body = isJson ? await res.json() : await res.text();
    const length = res.headers.get('content-length');
    const chunked = res.headers.get('transfer-encoding');
    console.log(`${label}\n  GET ${path}\n  -> ${res.status} content-length=${length} transfer-encoding=${chunked}`);
    if (typeof body === 'string') {
      console.log('  body:', body);
    } else {
      console.log('  body (JSON):'); // one key per line, easier to read
      for (const [key, value] of Object.entries(body)) console.log(`    ${key}: ${JSON.stringify(value)}`);
    }
  }

  console.log('Query strings and URL decoding');
  await show('hello with a name', '/hello?name=Ada%20Lovelace');
  await show('hello without a name', '/hello');

  console.log('\nWhat the server sees');
  await show('inspect', '/inspect?tag=a&tag=b&limit=10&limit=20', { headers: { 'X-Demo': 'yes' } });

  console.log('\nTwo ways to send a response');
  await show('statusCode + setHeader + end', '/set-header-style');
  await show('writeHead + end', '/write-head-style');

  console.log('\nHeaders after the first write');
  await show('too late', '/too-late');

  console.log('\nUnknown route');
  await show('404', '/nothing-here');

  server.close();
  server.closeAllConnections(); // do not wait for idle keep-alive connections
}

main();
