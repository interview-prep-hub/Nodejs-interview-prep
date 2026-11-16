// Timeouts: the server's defence against slow clients, and your defence against slow servers
// Run: node lessons/24-production-and-deployment/examples/13-server-timeouts.js
//
// Part 1 prints the real defaults. Parts 2 to 4 shrink the timeouts to a few hundred milliseconds so the demo is quick.
// Part 5 is the other direction: a call to someone else that never answers must have a timeout too.
'use strict';
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

// A raw TCP client, so we decide exactly which bytes to send and when to stop.
// It resolves when the server closes the connection and tells us what the server said before that.
function rawClient(port, bytes) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const started = Date.now();
    let received = '';
    socket.on('data', (chunk) => (received += chunk));
    socket.on('error', () => {}); // a reset is fine here, 'close' always follows
    socket.on('close', () => resolve({ received, ms: Date.now() - started }));
    socket.write(bytes);
  });
}

const firstLine = (text) => text.split('\r\n')[0] || '(nothing)';

async function main() {
  console.log('1. The defaults of an http.Server (milliseconds)');
  const plain = http.createServer();
  const names = ['keepAliveTimeout', 'keepAliveTimeoutBuffer', 'headersTimeout', 'requestTimeout', 'timeout', 'connectionsCheckingInterval'];
  for (const name of names) console.log(`   ${name.padEnd(28)}: ${plain[name]}`);

  // The same kind of server, but with tiny timeouts so the demo is quick.
  // connectionsCheckingInterval is how often Node looks for late requests (30 seconds by default, so the
  // real timeouts are only enforced that often).
  const server = http.createServer(
    { headersTimeout: 200, requestTimeout: 400, connectionsCheckingInterval: 25, keepAliveTimeout: 1000, keepAliveTimeoutBuffer: 0 },
    (req, res) => {
      if (req.url === '/hang') return; // a handler that never answers
      req.resume(); // read (and ignore) the body
      req.on('end', () => res.end('ok'));
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  console.log('2. A client that sends its headers too slowly (the "slowloris" attack)');
  const slowHeaders = await rawClient(port, 'GET / HTTP/1.1\r\nHost: x\r\nX-Slow: '); // never finishes the header block
  console.log('   server answered       :', firstLine(slowHeaders.received));
  console.log('   waited at least 200 ms:', slowHeaders.ms >= 190, '(headersTimeout)');

  console.log('3. A client that promises 100 bytes of body, sends 3, and stops');
  const slowBody = await rawClient(port, 'POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nabc');
  console.log('   server answered       :', firstLine(slowBody.received));
  console.log('   waited at least 400 ms:', slowBody.ms >= 390, '(requestTimeout)');

  console.log('4. An honest client that is idle after a normal request (keep-alive)');
  const idle = await rawClient(port, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  console.log('   first line            :', firstLine(idle.received));
  console.log('   Keep-Alive header     :', idle.received.match(/Keep-Alive: (.*)\r\n/i)?.[1], '(the server announces how long it waits)');
  console.log('   hung up after about 1 s of silence:', idle.ms >= 900 && idle.ms < 3000);

  console.log('5. The other direction: calling a server that never answers');
  // The handler of /hang never replies and Node does not time out a request it has fully received
  // (server.timeout is 0). Without our own timeout this fetch would wait forever.
  const started = Date.now();
  try {
    await fetch(`http://127.0.0.1:${port}/hang`, { signal: AbortSignal.timeout(150) });
  } catch (err) {
    console.log('   the call failed with  :', err.name);
    console.log('   it gave up in time    :', Date.now() - started < 1000);
  }

  server.closeAllConnections(); // the hanging request is still open on the server side
  server.close();
}

main();
