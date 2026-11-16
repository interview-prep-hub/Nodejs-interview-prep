// One thread, many connections
// Shows: a single JavaScript thread keeps 500 connections open at once, each waiting 1.5 seconds.
// Run: node lessons/08-event-loop/examples/12-many-connections.js

const net = require('node:net');

const CLIENTS = 500;
const BATCH = 25; // connect 25 clients, pause a moment, repeat (a huge burst can overflow the OS accept queue)
const WAIT_MS = 1500; // pretend each request waits for a database

let inFlight = 0; // requests the server has accepted but not yet answered
let peak = 0;

const server = net.createServer((socket) => {
  inFlight++;
  peak = Math.max(peak, inFlight);
  socket.on('error', () => {});
  socket.once('data', () => {
    // "Wait for the database". The wait costs no CPU, so the loop is free to do other things.
    setTimeout(() => {
      inFlight--;
      socket.end('done');
    }, WAIT_MS);
  });
});

function oneClient(port) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write('hello'));
      socket.once('data', () => resolve());
      socket.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') setTimeout(attempt, 20); // the OS accept queue was full, try again
        else reject(err);
      });
    };
    attempt();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

server.listen({ port: 0, host: '127.0.0.1' }, async () => {
  const { port } = server.address();
  console.log(`${CLIENTS} clients connect to ONE node process (one JavaScript thread).`);
  console.log(`Each request waits ${WAIT_MS} ms, like a slow database call.\n`);

  const start = performance.now();
  const replies = [];
  for (let sent = 0; sent < CLIENTS; sent += BATCH) {
    for (let i = 0; i < BATCH; i++) replies.push(oneClient(port));
    await sleep(20);
  }
  await Promise.all(replies);
  const took = Math.round(performance.now() - start);

  console.log(`all ${CLIENTS} requests answered`);
  console.log(`time taken, rounded to 100 ms: ${Math.round(took / 100) * 100} ms`);
  console.log(`time if the server did them one after another: ${CLIENTS * WAIT_MS} ms`);
  console.log(`most requests were waiting together (peak in flight above ${CLIENTS / 2}):`, peak > CLIENTS / 2);
  server.close();
});
