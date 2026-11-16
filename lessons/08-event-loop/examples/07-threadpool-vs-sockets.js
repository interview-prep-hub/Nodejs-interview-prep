// What uses the thread pool and what does not
// Shows: when the pool is full, fs and dns.lookup must wait, but a TCP round trip is not affected.
// Run: node lessons/08-event-loop/examples/07-threadpool-vs-sockets.js

const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');

const POOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || 4; // 4 is the default
const start = performance.now();
const since = () => `${Math.round(performance.now() - start)} ms`;

// A tiny echo server on a free port. We use 127.0.0.1 (not "localhost"), because
// the name "localhost" would need dns.lookup, and that uses the thread pool.
const server = net.createServer((socket) => socket.pipe(socket));

server.listen(0, '127.0.0.1', () => {
  // 1. Fill every thread of the pool with a slow crypto job.
  let jobsLeft = POOL_SIZE;
  for (let i = 0; i < POOL_SIZE; i++) {
    crypto.pbkdf2('password', 'salt', 300000, 64, 'sha512', () => {
      if (--jobsLeft === 0) console.log(`all ${POOL_SIZE} crypto jobs done after ${since()}`);
    });
  }
  console.log(`${POOL_SIZE} crypto jobs started, the pool is full\n`);

  // 2. Three more operations, started at the same moment.
  fs.stat(__filename, () => console.log(`fs.stat finished after ${since()} (thread pool, had to wait)`));

  dns.lookup('localhost', () => console.log(`dns.lookup finished after ${since()} (thread pool, had to wait)`));

  const client = net.connect(server.address().port, '127.0.0.1', () => client.write('ping'));
  client.on('data', () => {
    console.log(`TCP round trip finished after ${since()} (no thread pool, not affected)`);
    client.destroy();
    server.close();
  });
});
