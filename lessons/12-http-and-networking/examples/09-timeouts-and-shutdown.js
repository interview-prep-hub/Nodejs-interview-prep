// Server timeouts (headers, request, keep-alive, socket) and a graceful shutdown that does not hang
// Run: node lessons/12-http-and-networking/examples/09-timeouts-and-shutdown.js
//
// To keep the demo fast we use tiny timeouts (about 100 to 300 ms). The real defaults are printed first.
// Note: server.keepAliveTimeoutBuffer exists since Node 24.6.0; on older releases it prints as undefined and is ignored.

const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

// Talk to the server with a raw socket: send some text, collect everything it answers until it hangs up.
async function raw(port, text) {
  const socket = net.connect({ host: '127.0.0.1', port });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => (received += chunk));
  socket.on('error', () => {});
  socket.write(text);
  await once(socket, 'close');
  return received;
}

const firstLine = (text) => (text.split('\r\n')[0] || '(nothing, the server just closed the connection)');

async function timeoutsDemo() {
  console.log('A. The defaults of http.createServer() on this Node version');
  const defaults = http.createServer();
  const names = [
    'headersTimeout',
    'requestTimeout',
    'keepAliveTimeout',
    'keepAliveTimeoutBuffer',
    'timeout',
    'maxRequestsPerSocket',
    'connectionsCheckingInterval',
  ];
  for (const name of names) console.log(`   server.${name.padEnd(27)} = ${defaults[name]}`);
  console.log(`   http.${'maxHeaderSize'.padEnd(29)} = ${http.maxHeaderSize} bytes`);

  // connectionsCheckingInterval: how often the server looks for expired headers/request timeouts.
  // The default is 30 s, so we shrink it to see the timeouts quickly.
  const fast = { connectionsCheckingInterval: 20 };

  console.log('B. headersTimeout: the client sends only part of the headers');
  let server = http.createServer({ ...fast, headersTimeout: 150, requestTimeout: 300 }, (req, res) => res.end('ok'));
  let port = await listen(server);
  let answer = await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\n'); // no empty line, so the headers never finish
  console.log('   server answered:', firstLine(answer));
  server.close();

  console.log('C. requestTimeout: headers arrive, but the body stops halfway');
  server = http.createServer({ ...fast, headersTimeout: 100, requestTimeout: 250 }, async (req, res) => {
    try {
      for await (const chunk of req); // wait for the whole body
      res.end('ok');
    } catch {
      // the connection was cut while we waited
    }
  });
  port = await listen(server);
  answer = await raw(port, 'POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nonly 9 of 100 bytes');
  console.log('   server answered:', firstLine(answer));
  server.close();

  console.log('D. keepAliveTimeout: a client keeps a connection open and then says nothing');
  server = http.createServer((req, res) => res.end('ok'));
  server.keepAliveTimeout = 150;
  server.keepAliveTimeoutBuffer = 50; // extra grace time added on top before the server hangs up
  port = await listen(server);
  answer = await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n'); // keep-alive is the default in HTTP/1.1
  console.log('   first line of the answer:', firstLine(answer));
  console.log('   then the server closed the idle connection by itself');
  server.close();

  console.log('E. server.timeout: no bytes at all for a while (a handler that never answers)');
  server = http.createServer(() => {});
  server.timeout = 150;
  port = await listen(server);
  answer = await raw(port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  console.log('   server answered:', firstLine(answer));
  server.close();
}

// ---------- graceful shutdown ----------

// 1. tell clients to stop reusing connections, 2. stop listening, 3. close idle sockets,
// 4. wait for running requests, 5. after a deadline, cut whatever is left.
function gracefulShutdown(server, state, forceAfterMs) {
  state.shuttingDown = true;
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      state.forced = true;
      server.closeAllConnections();
    }, forceAfterMs);
    server.close(() => {
      clearTimeout(forceTimer);
      resolve();
    });
    server.closeIdleConnections();
  });
}

function makeServer(state) {
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return; // never answers
    setTimeout(() => {
      if (state.shuttingDown) res.setHeader('Connection', 'close'); // "do not reuse this connection"
      res.end('done');
    }, 300);
  });
  server.keepAliveTimeout = 800; // small, so the "slow" shutdown below only costs about a second
  server.keepAliveTimeoutBuffer = 200;
  return server;
}

// A lazy client: it sends one request and then keeps the connection open, the way a browser,
// a load balancer or an http.Agent with keepAlive does. It never hangs up by itself.
function lazyClient(port, path) {
  const socket = net.connect({ host: '127.0.0.1', port });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => (received += chunk));
  socket.on('error', () => {});
  socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`);
  const closed = once(socket, 'close').then(() => {
    const body = received.split('\r\n\r\n')[1];
    return body ? `answer "${body}"` : 'no answer, the server cut the connection';
  });
  return { closed };
}

async function shutdownDemo() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log('F. Plain server.close(): the idle keep-alive connection keeps it waiting');
  let state = { shuttingDown: false };
  let server = makeServer(state);
  let port = await listen(server);
  let client = lazyClient(port, '/work');
  await sleep(50);
  let started = Date.now();
  await new Promise((resolve) => server.close(resolve)); // just close(), nothing else
  let took = Date.now() - started;
  console.log('   the running request got:', await client.closed);
  console.log('   close() waited for the idle timer (more than 700 ms):', took > 700);

  console.log('G. gracefulShutdown(): Connection: close + closeIdleConnections()');
  state = { shuttingDown: false };
  server = makeServer(state);
  port = await listen(server);
  client = lazyClient(port, '/work');
  await sleep(50);
  started = Date.now();
  await gracefulShutdown(server, state, 5000);
  took = Date.now() - started;
  console.log('   the running request got:', await client.closed);
  console.log('   shutdown was quick (less than 600 ms):', took < 600, '| forced:', Boolean(state.forced));

  console.log('H. A request that never ends is cut after the deadline');
  state = { shuttingDown: false };
  server = makeServer(state);
  port = await listen(server);
  client = lazyClient(port, '/hang');
  await sleep(50);
  await gracefulShutdown(server, state, 200); // wait at most 200 ms, then closeAllConnections()
  console.log('   the stuck client got:', await client.closed, '| forced:', Boolean(state.forced));
}

async function main() {
  await timeoutsDemo();
  await shutdownDemo();
}

main();
